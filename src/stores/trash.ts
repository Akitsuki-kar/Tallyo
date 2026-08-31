/**
 * 回收站 store（0.1.2）
 *
 * 在此之前，删除只是把一个 isDeleted 墓碑写进库里——用户看不到删过什么，
 * 删错了只能靠 5 秒撤销那条窄缝抢救，墓碑还会随同步在设备间永久堆积。
 *
 * 本 store 补齐两件事：
 *   1. **回收站**：把散落在 5 个 object store 里的墓碑汇总成统一视图，可恢复、可永久删除。
 *   2. **数据自清洗**：一次跑完「正确性核对 → 修复 → 重算 → 清理过期墓碑」，
 *      并可配置为每周 / 每月自动执行（见 utils/cleanup.ts 的规则说明）。
 *
 * 恢复语义按 store 分别处理，因为「恢复一条读数」和「恢复一处房源」的连带影响完全不同：
 * 读数要重链接、房源要连带拉回它的单价与预算、账单要重算。
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Reading, Bill, TrashStoreName, CleanupFrequency } from '@/types';
import * as readingRepo from '@/db/repositories/readingRepo';
import * as billRepo from '@/db/repositories/billRepo';
import * as premiseRepo from '@/db/repositories/premiseRepo';
import * as priceRepo from '@/db/repositories/priceRepo';
import * as budgetRepo from '@/db/repositories/budgetRepo';
import { purgeKeyOf } from '@/db/repositories/purgeRepo';
import { purgeEntities } from '@/sync/purge';
import {
  findDuplicateBillGroups,
  findOrphanBills,
  findOrphanPremiseRecords,
  findExpiredTombstones,
  daysSince,
  isCleanupDue,
  DEFAULT_RETENTION_DAYS,
} from '@/utils/cleanup';
import { useReadingsStore } from './readings';
import { useBillsStore } from './bills';
import { usePremisesStore } from './premises';
import { usePricesStore } from './prices';
import { useBudgetsStore } from './budgets';
import { useSettingsStore } from './settings';
import { monthKeyFromDate, formatMonthLabel } from '@/utils/dayjs';
import { formatCurrency, formatNumber } from '@/utils/format';
import { eventBus, EVENTS } from '@/utils/eventBus';
import { logger } from '@/utils/logger';

/** 回收站条目（5 类墓碑的统一视图模型，供 UI 直接渲染） */
export interface TrashItem {
  /** 主键：${store}:${id}，与 PurgeMarker.key 同构 */
  key: string;
  store: TrashStoreName;
  id: string;
  typeLabel: string;
  icon: string;
  title: string;
  subtitle: string;
  premiseId: string;
  premiseName: string;
  /** 墓碑写入时刻（即删除发生的时刻） */
  deletedAt: string;
  /** 距自动清理到期还剩几天；<= 0 表示已到期 */
  expiresInDays: number;
}

/** 一次自清洗的回执：UI 用它告诉用户「到底动了什么」 */
export interface CleanupReport {
  at: string;
  durationMs: number;
  /** 清理前回收站里的条目数 */
  tombstoneCount: number;
  /** 本次被永久删除的条目数 */
  purgedCount: number;
  /** 发现的「一房一月多张账单」组数 */
  duplicateGroups: number;
  /** 因重复而被墓碑的账单数 */
  billsMerged: number;
  /** 清理掉的空壳账单（该月已无读数且金额为 0）数 */
  orphanBills: number;
  /** 清除的「房源孤儿」记录数（premiseId 为空或指向不存在的房源：读数 / 账单 / 单价 / 预算） */
  premiseOrphans: number;
  /** 修复的读数链条数 */
  relinked: number;
  /** 重算的账单月份数 */
  recomputed: number;
}

const TYPE_META: Record<TrashStoreName, { typeLabel: string; icon: string }> = {
  readings: { typeLabel: '读数', icon: '📝' },
  bills: { typeLabel: '账单', icon: '🧾' },
  premises: { typeLabel: '房源', icon: '🏠' },
  prices: { typeLabel: '单价', icon: '💧' },
  budgets: { typeLabel: '预算', icon: '🎯' },
};

export const useTrashStore = defineStore('trash', () => {
  const items = ref<TrashItem[]>([]);
  const loading = ref(false);
  /** 上一次自清洗的回执（本次会话内保留，供页面展示结果卡） */
  const lastReport = ref<CleanupReport | null>(null);

  const count = computed(() => items.value.length);
  /** 已超过保留期、下次清理会被永久删除的条目数 */
  const expiringCount = computed(() => items.value.filter((i) => i.expiresInDays <= 0).length);

  /** 按类型分组计数（UI 筛选 chips 上的小角标） */
  const countByStore = computed<Record<TrashStoreName, number>>(() => {
    const map: Record<TrashStoreName, number> = {
      readings: 0,
      bills: 0,
      premises: 0,
      prices: 0,
      budgets: 0,
    };
    for (const i of items.value) map[i.store]++;
    return map;
  });

  function nowIso(): string {
    return new Date().toISOString();
  }

  async function load(): Promise<void> {
    loading.value = true;
    try {
      const retention = useSettingsStore().trashRetentionDays || DEFAULT_RETENTION_DAYS;
      const now = new Date();
      const [readings, bills, premises, prices, budgets] = await Promise.all([
        readingRepo.getAllReadings(),
        billRepo.getAllBills(),
        premiseRepo.getAllPremises(),
        priceRepo.getAllPrices(),
        budgetRepo.getAllBudgets(),
      ]);

      // 房源名查表用**全量** premises（含墓碑）：读数/账单可能属于一个已被删除的房源，
      // 用只含活房源的 premises.list 会把它们统统显示成「未知房源」。
      const premiseName = (id: string): string =>
        premises.find((p) => p.id === id)?.name ?? '（已删除的房源）';

      const out: TrashItem[] = [];

      for (const r of readings) {
        if (!r.isDeleted) continue;
        out.push({
          key: purgeKeyOf('readings', r.id),
          store: 'readings',
          id: r.id,
          typeLabel: r.type === 'electricity' ? '电表读数' : '水表读数',
          icon: r.type === 'electricity' ? '⚡' : '💧',
          title: `${r.date} · 表值 ${formatNumber(r.reading)}`,
          subtitle: `${formatMonthLabel(monthKeyFromDate(r.date))}${r.note ? ` · ${r.note}` : ''}`,
          premiseId: r.premiseId,
          premiseName: premiseName(r.premiseId),
          deletedAt: r.updatedAt,
          expiresInDays: retention - daysSince(r.updatedAt, now),
        });
      }

      for (const b of bills) {
        if (!b.isDeleted) continue;
        out.push({
          key: purgeKeyOf('bills', b.id),
          store: 'bills',
          id: b.id,
          typeLabel: '月度账单',
          icon: '🧾',
          title: `${formatMonthLabel(b.yearMonth)} · ${formatCurrency(b.totalCost)}`,
          subtitle: `电 ${formatNumber(b.electricityUsage)} 度 / 水 ${formatNumber(b.waterUsage)} 吨`,
          premiseId: b.premiseId,
          premiseName: premiseName(b.premiseId),
          deletedAt: b.updatedAt,
          expiresInDays: retention - daysSince(b.updatedAt, now),
        });
      }

      for (const p of premises) {
        if (!p.isDeleted) continue;
        out.push({
          key: purgeKeyOf('premises', p.id),
          store: 'premises',
          id: p.id,
          typeLabel: '房源',
          icon: '🏠',
          title: p.name,
          subtitle: p.note || '删除房源不会删掉它的读数与账单',
          premiseId: p.id,
          premiseName: p.name,
          deletedAt: p.updatedAt,
          expiresInDays: retention - daysSince(p.updatedAt, now),
        });
      }

      for (const pr of prices) {
        if (!pr.isDeleted) continue;
        const c = pr.config;
        out.push({
          key: purgeKeyOf('prices', pr.premiseId),
          store: 'prices',
          id: pr.premiseId,
          typeLabel: '单价配置',
          icon: '💧',
          title: `${premiseName(pr.premiseId)} 的单价`,
          subtitle:
            c.mode === 'flat'
              ? `固定：电 ${formatNumber(c.flat.electricity)} / 水 ${formatNumber(c.flat.water)}`
              : `阶梯：电 ${c.tiers.electricity.length} 档 / 水 ${c.tiers.water.length} 档`,
          premiseId: pr.premiseId,
          premiseName: premiseName(pr.premiseId),
          deletedAt: pr.updatedAt,
          expiresInDays: retention - daysSince(pr.updatedAt, now),
        });
      }

      for (const bg of budgets) {
        if (!bg.isDeleted) continue;
        out.push({
          key: purgeKeyOf('budgets', bg.premiseId),
          store: 'budgets',
          id: bg.premiseId,
          typeLabel: '预算配置',
          icon: '🎯',
          title: `${premiseName(bg.premiseId)} 的预算`,
          subtitle: `${bg.mode === 'amount' ? '按金额' : '按用量'}：电 ${formatNumber(bg.electricityLimit)} / 水 ${formatNumber(bg.waterLimit)}`,
          premiseId: bg.premiseId,
          premiseName: premiseName(bg.premiseId),
          deletedAt: bg.updatedAt,
          expiresInDays: retention - daysSince(bg.updatedAt, now),
        });
      }

      // 删除时间倒序：最近删的排在最前，符合「刚删错赶紧找回」的使用场景
      out.sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1));
      items.value = out;
    } catch (err) {
      logger.error('store:trash', '加载回收站失败', {
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      loading.value = false;
    }
  }

  /** 恢复后刷新对应实体 store 的内存（各 store 对墓碑的过滤策略不同，统一重装载最省心） */
  async function reloadStore(store: TrashStoreName): Promise<void> {
    if (store === 'readings') await useReadingsStore().load();
    else if (store === 'bills') await useBillsStore().load();
    else if (store === 'premises') await usePremisesStore().load();
    else if (store === 'prices') await usePricesStore().load();
    else await useBudgetsStore().load();
  }

  /**
   * 恢复一条墓碑。
   *
   * 各类型的连带处理：
   * - 读数：必须重链并重算账单。它一恢复，前后读数链的 previousReading 与相邻月份的
   *   计费基准都变了，只把 isDeleted 翻回来会留下一条「用量列显示旧链错值」的脏记录。
   * - 账单：直接翻回即可，内容是删除那一刻的快照，不重算（重算反而会用今天的单价改写历史）。
   * - 房源：连带恢复它的单价与预算——删除房源时这两项是级联软删的，只还原房源不还原配置
   *   等于恢复了一个「打开设置页发现单价归零」的残缺房源。
   * - 单价 / 预算：恢复后该房源全部历史账单的金额都会变，需要整房重算。
   */
  async function restore(key: string): Promise<boolean> {
    const item = items.value.find((i) => i.key === key);
    if (!item) return false;
    const now = nowIso();

    try {
      switch (item.store) {
        case 'readings': {
          const store = useReadingsStore();
          const rec = store.items.find((r) => r.id === item.id);
          if (!rec) return false;
          const restored: Reading = {
            ...rec,
            isDeleted: false,
            updatedAt: now,
            syncVersion: (rec.syncVersion ?? 0) + 1,
          };
          await readingRepo.putReading(restored);
          Object.assign(rec, restored);
          eventBus.emit(EVENTS.READING_CHANGED, restored);
          // 重链 + 重算：见上方注释
          await store.relinkAndRecompute(restored.premiseId, restored.type, [
            monthKeyFromDate(restored.date),
          ]);
          break;
        }
        case 'bills': {
          const rec = await billRepo.getBill(item.id);
          if (!rec) return false;
          const restored: Bill = {
            ...rec,
            isDeleted: false,
            updatedAt: now,
            syncVersion: (rec.syncVersion ?? 0) + 1,
          };
          await billRepo.putBill(restored);
          await useBillsStore().load();
          eventBus.emit(EVENTS.BILL_RECALCULATED, restored);
          break;
        }
        case 'premises': {
          const store = usePremisesStore();
          const rec = store.items.find((p) => p.id === item.id);
          if (!rec) return false;
          await store.updatePremise(item.id, { isDeleted: false });
          // 级联恢复：与 removePremise 的级联清理严格对称
          await usePricesStore().restorePriceForPremise(item.id);
          await useBudgetsStore().restoreBudgetForPremise(item.id);
          break;
        }
        case 'prices': {
          await usePricesStore().restorePriceForPremise(item.id);
          // 单价是账单的计算输入，恢复后该房源所有历史月份都要按新单价重算
          await useBillsStore().recomputePremise(item.id);
          break;
        }
        case 'budgets': {
          await useBudgetsStore().restoreBudgetForPremise(item.id);
          // 预算只回写账单的 budgetStatus（金额不变），全房重算一遍即可刷新状态
          await useBillsStore().recomputePremise(item.id);
          break;
        }
      }
      items.value = items.value.filter((i) => i.key !== key);
      return true;
    } catch (err) {
      logger.error('store:trash', '恢复回收站条目失败', {
        key,
        message: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  /**
   * 永久删除（单条）：物理删除记录 + 落一枚永久删除标记。
   *
   * 标记是必须的：没有它，下一轮同步会判定「远端有墓碑、本地没有」= 远端胜出，
   * 把刚删掉的东西原样拉回来（详见 sync/purge.ts 头注释）。
   *
   * 发一次对应实体的变更事件，让自动同步尽快把这个删除意图推上去。
   */
  async function purge(key: string): Promise<boolean> {
    const item = items.value.find((i) => i.key === key);
    if (!item) return false;
    try {
      await purgeEntities([{ store: item.store, id: item.id }]);
      await reloadStore(item.store);
      items.value = items.value.filter((i) => i.key !== key);
      emitStoreEvent(item.store, item.id);
      return true;
    } catch (err) {
      logger.error('store:trash', '永久删除失败', {
        key,
        message: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  /** 清空回收站：整批永久删除。共用一个 purgedAt，让「清空」在协议上是一个原子意图 */
  async function purgeAll(): Promise<number> {
    const list = [...items.value];
    if (list.length === 0) return 0;
    try {
      await purgeEntities(list.map((i) => ({ store: i.store, id: i.id })));
      // 各 store 都可能受影响，统一重装载
      await Promise.all([
        useReadingsStore().load(),
        useBillsStore().load(),
        usePremisesStore().load(),
        usePricesStore().load(),
        useBudgetsStore().load(),
      ]);
      items.value = [];
      for (const store of new Set(list.map((i) => i.store))) emitStoreEvent(store);
      return list.length;
    } catch (err) {
      logger.error('store:trash', '清空回收站失败', {
        message: err instanceof Error ? err.message : String(err),
      });
      return 0;
    }
  }

  /**
   * 数据自清洗。按「先核对修复 → 再重算 → 最后清理过期墓碑」的顺序执行。
   *
   * 顺序有讲究：
   * · 先去重再重算，否则重算会把重复的那张也算一遍，白做功；
   * · 过期墓碑放最后，因为前面两步会新产生墓碑（重复账单、空壳账单），
   *   它们的 updatedAt 是「现在」，不会被本轮清掉 —— 用户还有整个保留期的时间反悔。
   *
   * @param retentionDays 墓碑保留天数，缺省取设置项
   */
  async function runCleanup(retentionDays?: number): Promise<CleanupReport> {
    const startedAt = Date.now();
    const now = new Date();
    const settings = useSettingsStore();
    const days =
      typeof retentionDays === 'number' && retentionDays > 0
        ? retentionDays
        : settings.trashRetentionDays || DEFAULT_RETENTION_DAYS;

    const readingsStore = useReadingsStore();
    const billsStore = useBillsStore();
    const premisesStore = usePremisesStore();
    const pricesStore = usePricesStore();
    const budgetsStore = useBudgetsStore();

    await Promise.all([
      readingsStore.load(),
      premisesStore.load(),
      pricesStore.load(),
      budgetsStore.load(),
    ]);
    await billsStore.load();
    await load();

    const tombstoneCount = items.value.length;
    const touchedIds = new Set<string>();
    let billsMerged = 0;
    let orphanBills = 0;
    let premiseOrphans = 0;
    let relinked = 0;
    let recomputed = 0;

    // ── 步骤 1：核对账单唯一性（一房一月只应有一张）──
    const allBills = await billRepo.getAllBills();
    const duplicates = findDuplicateBillGroups(allBills);
    const dedupMonths = new Map<string, Set<string>>();
    for (const g of duplicates) {
      for (const drop of g.drop) {
        await billRepo.putBill({
          ...drop,
          isDeleted: true,
          updatedAt: nowIso(),
          syncVersion: (drop.syncVersion ?? 0) + 1,
        });
        touchedIds.add(drop.id);
        billsMerged++;
      }
      const months = dedupMonths.get(g.premiseId) ?? new Set<string>();
      months.add(g.yearMonth);
      dedupMonths.set(g.premiseId, months);
    }
    // 保留的那张必须重算：它可能是被旧数据覆盖过的那张，金额未必对
    for (const [premiseId, months] of dedupMonths) {
      recomputed += await billsStore.recomputeMonths(premiseId, [...months].sort());
    }

    // ── 步骤 2：清理空壳账单（该月已无读数且金额为 0）──
    const liveBills = allBills.filter((b) => !b.isDeleted && !touchedIds.has(b.id));
    const allReadings = await readingRepo.getAllReadings();
    const activePremiseIds = new Set(premisesStore.list.map((p) => p.id));
    const orphans = findOrphanBills(liveBills, allReadings, activePremiseIds);
    for (const b of orphans) {
      await billRepo.putBill({
        ...b,
        isDeleted: true,
        updatedAt: nowIso(),
        syncVersion: (b.syncVersion ?? 0) + 1,
      });
      touchedIds.add(b.id);
      orphanBills++;
    }

    // ── 步骤 2.5：清理房源孤儿记录（premiseId 为空串或指向不存在的房源）──
    // 这些记录在任何 UI 里都显示不出来、也编辑不了，是彻底的脏数据（典型成因：录入时未选中
    // 房源就保存了读数，账单生成又顺带为这个不存在的房源造了张全 0 影子账单）。
    // 判定基准用**全量**房源集合（含软删）：删房源 ≠ 删账本，归属「存在但已软删」房源的记录
    // 不算孤儿；只有 premiseId 为空串或全量集合里查不到才算。
    //
    // ⚠️ 关键：这些孤儿是「活记录」(isDeleted:false)。绝不能调 purgeEntities（物理删+PurgeMarker），
    // 因为 PurgeMarker 协议只挡 isDeleted 墓碑、挡不住活记录——云端若还存着活副本，同步 pull 会把它
    // 原样拉回，造成「清了又回来」的死循环。正确做法：与步骤 2 的孤儿账单同构，先「软删」成墓碑
    // (isDeleted:true)，让它随既有 tombstone→保留期→purge 管线安全消亡；findOrphanPremiseRecords 会
    // 跳过 isDeleted，下一轮清洗不会再命中它，循环在此断开。buildLocalSnapshot 读 repo，软删会自然同步。
    // prices / budgets 的仓库以 premiseId 为键、没有 .items 数组，这里直接取仓库实体数组
    // （形态与步骤 5 的 pr2 / bu2 一致，均含 premiseId + isDeleted）。
    const allPremiseIds = new Set(premisesStore.items.map((p) => p.id));
    const allPrices = await priceRepo.getAllPrices();
    const allBudgets = await budgetRepo.getAllBudgets();
    const softDelNow = nowIso();
    const bump = (e: { syncVersion?: number }): number => (e.syncVersion ?? 0) + 1;
    const orphanReadings = findOrphanPremiseRecords(allReadings, allPremiseIds);
    const orphanBillList = findOrphanPremiseRecords(liveBills, allPremiseIds);
    const orphanPrices = findOrphanPremiseRecords(allPrices, allPremiseIds);
    const orphanBudgets = findOrphanPremiseRecords(allBudgets, allPremiseIds);
    const softDeleteTasks: Promise<unknown>[] = [
      ...orphanReadings.map((r) =>
        readingRepo.putReading({ ...r, isDeleted: true, updatedAt: softDelNow, syncVersion: bump(r) }),
      ),
      ...orphanBillList.map((b) =>
        billRepo.putBill({ ...b, isDeleted: true, updatedAt: softDelNow, syncVersion: bump(b) }),
      ),
      ...orphanPrices.map((p) =>
        priceRepo.putPrice({ ...p, isDeleted: true, updatedAt: softDelNow, syncVersion: bump(p) }),
      ),
      ...orphanBudgets.map((bg) =>
        budgetRepo.putBudget({ ...bg, isDeleted: true, updatedAt: softDelNow, syncVersion: bump(bg) }),
      ),
    ];
    if (softDeleteTasks.length > 0) {
      await Promise.all(softDeleteTasks);
      const touchedStores = new Set<TrashStoreName>([
        ...orphanReadings.map(() => 'readings' as const),
        ...orphanBillList.map(() => 'bills' as const),
        ...orphanPrices.map(() => 'prices' as const),
        ...orphanBudgets.map(() => 'budgets' as const),
      ]);
      for (const store of touchedStores) emitStoreEvent(store);
    }
    premiseOrphans = softDeleteTasks.length;

    // ── 步骤 3：修复读数链（previousReading 与按日期链路不一致）──
    relinked = await readingsStore.relinkChains();

    // ── 步骤 4：全量重算自愈（账单是派生数据，这里兜住任何口径漂移）──
    recomputed += await billsStore.recomputeAll();

    // ── 步骤 5：清理超过保留期的墓碑 ──
    // 重新读一遍：步骤 1~2 刚产生的墓碑 updatedAt 是「现在」，天然不在此列。
    const [r2, b2, p2, pr2, bu2] = await Promise.all([
      readingRepo.getAllReadings(),
      billRepo.getAllBills(),
      premiseRepo.getAllPremises(),
      priceRepo.getAllPrices(),
      budgetRepo.getAllBudgets(),
    ]);
    const expired: Array<{ store: TrashStoreName; id: string }> = [
      ...findExpiredTombstones(r2, days, now).map((e) => ({ store: 'readings' as const, id: e.id })),
      ...findExpiredTombstones(b2, days, now).map((e) => ({ store: 'bills' as const, id: e.id })),
      ...findExpiredTombstones(p2, days, now).map((e) => ({ store: 'premises' as const, id: e.id })),
      ...findExpiredTombstones(pr2, days, now).map((e) => ({
        store: 'prices' as const,
        id: e.premiseId,
      })),
      ...findExpiredTombstones(bu2, days, now).map((e) => ({
        store: 'budgets' as const,
        id: e.premiseId,
      })),
    ];
    await purgeEntities(expired);

    // ── 收尾：刷新内存与设置 ──
    if (expired.length > 0) {
      await Promise.all([
        readingsStore.load(),
        billsStore.load(),
        premisesStore.load(),
        pricesStore.load(),
        budgetsStore.load(),
      ]);
      for (const store of new Set(expired.map((e) => e.store))) emitStoreEvent(store);
    }
    await load();
    await settings.update({ lastCleanedAt: nowIso() });

    const report: CleanupReport = {
      at: nowIso(),
      durationMs: Date.now() - startedAt,
      tombstoneCount,
      purgedCount: expired.length,
      duplicateGroups: duplicates.length,
      billsMerged,
      orphanBills,
      premiseOrphans,
      relinked,
      recomputed,
    };
    lastReport.value = report;
    logger.info('[SDB:cleanup]', '数据自清洗完成', { ...report });
    return report;
  }

  /**
   * 启动时的自动清理（周清 / 月清）。未到期或用户未开启时直接返回 null，不写任何数据。
   *
   * 刻意放在同步之前执行（见 main.ts）：清理产生的删除要先落到本地，
   * 再随启动那轮同步一起推上去，避免「删了但没推」的窗口。
   */
  async function runAutoCleanupIfDue(): Promise<CleanupReport | null> {
    const settings = useSettingsStore();
    const frequency: CleanupFrequency = settings.trashAutoClean ?? 'off';
    if (!isCleanupDue(settings.lastCleanedAt, frequency, new Date())) return null;
    try {
      return await runCleanup();
    } catch (err) {
      logger.error('store:trash', '自动清理失败', {
        message: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  return {
    items,
    loading,
    lastReport,
    count,
    expiringCount,
    countByStore,
    load,
    restore,
    purge,
    purgeAll,
    runCleanup,
    runAutoCleanupIfDue,
  };
});

/** 按 store 发对应的变更事件，触发自动同步把删除/恢复推上去 */
function emitStoreEvent(store: TrashStoreName, id?: string): void {
  switch (store) {
    case 'readings':
      eventBus.emit(EVENTS.READING_CHANGED, id ? { id } : undefined);
      break;
    case 'bills':
      eventBus.emit(EVENTS.BILL_RECALCULATED, undefined);
      break;
    case 'premises':
      eventBus.emit(EVENTS.PREMISE_CHANGED, id ? { id } : undefined);
      break;
    case 'prices':
      eventBus.emit(EVENTS.PRICE_CHANGED, id ? { premiseId: id } : undefined);
      break;
    case 'budgets':
      eventBus.emit(EVENTS.BUDGET_CHANGED, id ? { premiseId: id } : undefined);
      break;
  }
}

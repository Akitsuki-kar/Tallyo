/**
 * 读数 store（读数状态 + 用量计算 + 账单联动）
 * 写入读数后：重建该 (房源, 类型) 的读数链 → 批量写回 IndexedDB → 重算受影响月份账单。
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Reading, ReadingType } from '@/types';
import * as readingRepo from '@/db/repositories/readingRepo';
import { usePremisesStore } from './premises';
import { useBillsStore } from './bills';
import { genId } from '@/utils/id';
import { monthKeyFromDate } from '@/utils/dayjs';
import { findPreviousReading, relinkChain } from '@/utils/readingChain';
import { eventBus, EVENTS } from '@/utils/eventBus';
import { logger } from '@/utils/logger';
import { useUndo } from '@/composables/useUndo';

export type ReadingSortKey = 'date' | 'reading' | 'createdAt';

export type ReadingFilter = {
  premiseId?: string;
  type?: ReadingType;
  month?: string;
};

export type ReadingPayload = Omit<
  Reading,
  'id' | 'createdAt' | 'updatedAt' | 'syncVersion' | 'isDeleted' | 'previousReading'
>;

/** 编辑读数后的回执：billsChanged = 本次改动实际改变了几个月的账单金额 */
export interface UpdateReadingResult {
  billsChanged: number;
}

export const useReadingsStore = defineStore('readings', () => {
  const items = ref<Reading[]>([]);
  const loading = ref(false);
  const filter = ref<ReadingFilter>({});
  const sortBy = ref<ReadingSortKey>('date');
  const sortDesc = ref(true);

  /** 列表按 premiseId 过滤：显式 filter.premiseId 优先，否则回落当前房源 */
  const sortedReadings = computed<Reading[]>(() => {
    const pid = filter.value.premiseId || usePremisesStore().currentPremiseId || '';
    let result = items.value.filter(
      (r) => !r.isDeleted && (pid === '' || r.premiseId === pid),
    );
    if (filter.value.type) result = result.filter((r) => r.type === filter.value.type);
    if (filter.value.month)
      result = result.filter((r) => r.date.startsWith(filter.value.month as string));
    const dir = sortDesc.value ? -1 : 1;
    const key = sortBy.value;
    result = [...result].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return result;
  });

  /**
   * 取某房源某类型「最近一条」（供预览等只读场景）。
   * 注意：仅用于展示「上期读数」等只读预览，账单/用量计算一律走 readingChain 的按日期链路。
   */
  function latestByType(premiseId: string, type: ReadingType): Reading | undefined {
    return items.value
      .filter((r) => !r.isDeleted && r.premiseId === premiseId && r.type === type)
      .sort((a, b) =>
        a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1,
      )[0];
  }

  function usageOf(reading: Reading): number {
    return reading.previousReading != null ? reading.reading - reading.previousReading : 0;
  }

  async function load(): Promise<void> {
    loading.value = true;
    try {
      items.value = await readingRepo.getAllReadings();
    } catch (err) {
      logger.error('store:readings', '加载读数失败', {
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      loading.value = false;
    }
  }

  /**
   * 重算某 (房源, 类型) 的读数链：把 relinkChain 返回的变更记录批量写回 IndexedDB，
   * 并同步内存；随后重算受影响月份的账单。
   *
   * ⚠️ 受影响月份 ≠ 「被改动记录所在的月份」。
   * 月度用量 monthlyUsage = 该月末读数 − 该月首条之前的那条读数，
   * 也就是说**每个月的计费基准是上个月的月末读数**。
   * 补录一条历史读数，改变的不只是它自己所在的月份，还有它之后所有月份的基准链
   * —— 这正是「补录之前的电表/水表记录后旧账单不重算」的根因（0.1.0 只重算了改动月本身）。
   *
   * 修复口径：取所有改动月份中最早的一个，把该房源**不早于它**且确实有读数的月份全部重算。
   * · 为什么不只算「下一个月」：月份可能有空档（3 月补录，4 月没读数，5 月的基准其实来自 3 月），
   *   单步级联会漏掉跨空档的月份。
   * · 为什么按「有读数的月份」筛：避免给空月凭空造出一张全 0 的账单。
   * · extraMonths 无条件保留：删除某月最后一条读数后该月已无读数，但它的旧账单必须被清零。
   * · 重算是幂等的（isSameBillValue 短路），金额没变的月份不会产生写入与同步事件，
   *   所以「多算几个月」在正确性与同步开销上都是安全的。
   *
   * @returns 金额实际发生变化的账单月份数（透传自 recomputeMonths）
   */
  async function relinkAndRecompute(
    premiseId: string,
    type: ReadingType,
    extraMonths: string[] = [],
  ): Promise<number> {
    const changed = relinkChain(items.value, premiseId, type);
    for (const rec of changed) {
      const updated: Reading = {
        ...rec,
        updatedAt: new Date().toISOString(),
        syncVersion: (rec.syncVersion ?? 0) + 1,
      };
      await readingRepo.putReading(updated);
      const mem = items.value.find((r) => r.id === updated.id);
      if (mem) Object.assign(mem, updated);
    }

    const months = new Set<string>(extraMonths);
    for (const rec of changed) {
      months.add(monthKeyFromDate(rec.date));
    }
    if (months.size === 0) return 0; // 链未变且无显式月份：无账单需要重算

    // YYYY-MM 定长字符串，字典序即时间序，可直接比较
    const earliest = [...months].sort()[0];
    for (const r of items.value) {
      if (r.isDeleted || r.premiseId !== premiseId) continue;
      const m = monthKeyFromDate(r.date);
      if (m >= earliest) months.add(m);
    }

    // 按月份升序重算：先算早月再算晚月，日志/事件顺序符合直觉
    return useBillsStore().recomputeMonths(premiseId, [...months].sort());
  }

  /**
   * 重建读数链并落库（只修 previousReading，不触发账单重算）。
   *
   * 存在意义：同步 / 导入的合并是「按实体逐个 LWW 取胜者」写入的，
   * 中途插入的读数会让既有记录的 previousReading 失效——链变了，字段却没跟着更新。
   * 账单金额不受影响（monthlyUsage 是按日期现算的派生值），
   * 但读数列表的「用量」列读的正是 previousReading，会一直显示旧链的错值，
   * 直到用户手动编辑某条读数才被顺带修正。
   *
   * relinkChain 是确定性纯函数（仅写「值确实变了」的记录），故两端各自重链结果一致，
   * 收敛后不再产生写入与事件，不会与同步形成乒乓。
   *
   * @param premiseIds 限定房源；省略则重链全部房源
   * @param emitEvent  是否广播 READING_CHANGED。同步上传前调用时应传 false：
   *                   修正结果马上就要进本轮上传的快照，再广播只会让自动同步
   *                   在结束时补推一轮「其实已经推上去了」的重复同步。
   * @returns 实际被修正的读数条数
   */
  async function relinkChains(premiseIds?: string[], emitEvent = true): Promise<number> {
    const pairs = new Set<string>();
    for (const r of items.value) {
      if (r.isDeleted) continue;
      if (premiseIds && !premiseIds.includes(r.premiseId)) continue;
      pairs.add(`${r.premiseId}\u0000${r.type}`); // \u0000 分隔，防 id 内含冒号碰撞
    }

    let changedCount = 0;
    for (const pair of pairs) {
      const [premiseId, type] = pair.split('\u0000') as [string, ReadingType];
      const changed = relinkChain(items.value, premiseId, type);
      for (const rec of changed) {
        const updated: Reading = {
          ...rec,
          updatedAt: new Date().toISOString(),
          syncVersion: (rec.syncVersion ?? 0) + 1,
        };
        await readingRepo.putReading(updated);
        const mem = items.value.find((r) => r.id === updated.id);
        if (mem) Object.assign(mem, updated);
        changedCount++;
      }
    }

    // 仅在确有修正时发事件：既让自动同步把修正后的链推上去，
    // 也保证收敛后不会每轮同步都白跑一次。
    if (changedCount > 0 && emitEvent) {
      eventBus.emit(EVENTS.READING_CHANGED, undefined);
    }
    return changedCount;
  }

  async function addReading(payload: ReadingPayload): Promise<Reading> {
    // A2：改用按日期严格早于的 findPreviousReading，而非 latestByType
    const prev = findPreviousReading(items.value, payload.premiseId, payload.type, payload.date);
    const now = new Date().toISOString();
    const reading: Reading = {
      ...payload,
      id: genId(),
      previousReading: prev ? prev.reading : null,
      createdAt: now,
      updatedAt: now,
      syncVersion: 1,
      isDeleted: false,
    };
    await readingRepo.putReading(reading);
    items.value.push(reading);
    eventBus.emit(EVENTS.READING_CHANGED, reading);

    // A3：插入可能改变后续记录的链，重算受影响月份
    await relinkAndRecompute(payload.premiseId, payload.type, [
      monthKeyFromDate(reading.date),
    ]);
    return reading;
  }

  async function updateReading(
    id: string,
    patch: Partial<Omit<Reading, 'id'>>,
  ): Promise<UpdateReadingResult> {
    const existing = items.value.find((r) => r.id === id);
    if (!existing) return { billsChanged: 0 };
    // 在写回内存前留存旧的链身份（房源 / 类型 / 日期）。
    // 说明：编辑表单（ReadingForm）已锁定 premiseId / type 不可改，正常 UI 路径不会触发链迁移；
    // 但本 store 是数据层，仍需对「读数被迁到另一条链」保持正确 —— 数据导入、WebDAV 同步合并
    // 等入口可能下发含 premiseId / type 的 patch，此时「旧链」与「新链」都必须重建。
    const oldDate = existing.date;
    const oldPremiseId = existing.premiseId;
    const oldType = existing.type;
    const updated: Reading = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
      syncVersion: existing.syncVersion + 1,
    };
    await readingRepo.putReading(updated);
    Object.assign(existing, updated);
    eventBus.emit(EVENTS.READING_CHANGED, updated);

    // 记录是否被迁移到了另一条链（换房源或换水电类型）
    const chainMoved = updated.premiseId !== oldPremiseId || updated.type !== oldType;
    // A3：patch 涉及 date / reading 会改变前驱后继；迁移链同样需要重建两侧
    const needsRelink = patch.date !== undefined || patch.reading !== undefined || chainMoved;
    if (needsRelink) {
      let changed = 0;
      // 先修旧链：本条离开后，原链上它的后继需要重新挂到更早的一条上，
      // 且旧房源当月账单必须重算（否则残留已迁走读数产生的用量）。
      if (chainMoved) {
        changed += await relinkAndRecompute(oldPremiseId, oldType, [monthKeyFromDate(oldDate)]);
      }
      // 再修新链：覆盖旧日期与新日期所在月份（跨月编辑时旧月份账单同样要刷新）。
      const extra = new Set<string>([monthKeyFromDate(oldDate), monthKeyFromDate(updated.date)]);
      changed += await relinkAndRecompute(updated.premiseId, updated.type, [...extra]);
      return { billsChanged: changed };
    }
    // 未触及 date / reading（例如只改备注）：账单输入没变，正常情况重算会被幂等短路掉
    return {
      billsChanged: await useBillsStore().recomputeMonths(updated.premiseId, [
        monthKeyFromDate(updated.date),
      ]),
    };
  }

  async function removeReading(id: string): Promise<void> {
    const existing = items.value.find((r) => r.id === id);
    if (!existing) return;
    // 捕获删除前的真实记录，供撤销时完整恢复（含 previousReading 等）
    const original: Reading = { ...existing };
    const oldDate = existing.date;
    const tombstone: Reading = {
      ...existing,
      isDeleted: true,
      updatedAt: new Date().toISOString(),
      syncVersion: existing.syncVersion + 1,
    };
    await readingRepo.putReading(tombstone);
    Object.assign(existing, tombstone);
    eventBus.emit(EVENTS.READING_CHANGED, tombstone);

    // A3：删除后其后继的前驱改变，重算受影响月份
    await relinkAndRecompute(existing.premiseId, existing.type, [
      monthKeyFromDate(oldDate),
    ]);

    // 体验⑫：提供 5 秒撤销，恢复该读数并重建链路
    const undo = useUndo();
    undo.offer('已删除读数', async () => {
      const restored: Reading = {
        ...original,
        isDeleted: false,
        updatedAt: new Date().toISOString(),
        syncVersion: existing.syncVersion + 1, // existing 已被置为墓碑，+1 保证严格更新
      };
      await readingRepo.putReading(restored);
      const mem = items.value.find((r) => r.id === id);
      if (mem) Object.assign(mem, restored);
      eventBus.emit(EVENTS.READING_CHANGED, restored);
      await relinkAndRecompute(restored.premiseId, restored.type, [
        monthKeyFromDate(restored.date),
      ]);
    });
  }

  function setFilter(patch: Partial<ReadingFilter>): void {
    filter.value = { ...filter.value, ...patch };
  }

  function setSort(key: ReadingSortKey, desc = true): void {
    sortBy.value = key;
    sortDesc.value = desc;
  }

  return {
    items,
    loading,
    filter,
    sortBy,
    sortDesc,
    sortedReadings,
    latestByType,
    usageOf,
    load,
    relinkChains,
    addReading,
    updateReading,
    removeReading,
    setFilter,
    setSort,
  };
});

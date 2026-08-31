/**
 * 账单 store（聚合该房源该月读数 → 用量 × 单价 → 写 Bill；预算状态回写 D8）
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Bill, Reading } from '@/types';
import * as billRepo from '@/db/repositories/billRepo';
import * as readingRepo from '@/db/repositories/readingRepo';
import * as priceRepo from '@/db/repositories/priceRepo';
import * as premiseRepo from '@/db/repositories/premiseRepo';
import { useBudgetsStore } from './budgets';
import { calcCost, applySettlement } from '@/utils/pricing';
import { round2 } from '@/utils/format';
import { monthKeyFromDate } from '@/utils/dayjs';
import { monthlyUsage } from '@/utils/billing';
import { eventBus, EVENTS } from '@/utils/eventBus';
import { logger } from '@/utils/logger';

// 月度用量计算已抽离到纯函数 src/utils/billing.ts（monthlyUsage），便于单测。

export const useBillsStore = defineStore('bills', () => {
  const bills = ref<Record<string, Bill>>({});
  const currentMonth = ref<string>('');
  /**
   * 是否已从 IndexedDB 装载过。
   *
   * 存在的意义：computeBill 用内存里的 bills.value[id] 作为「旧账单」来
   * (a) 判断业务值是否变化（幂等短路）与 (b) 递增 syncVersion。
   * 若重算发生在装载之前，existing 为 undefined，新账单会从 syncVersion 1 重新起步，
   * 直接覆盖库里原本更高的版本号 —— 后果有两重：
   *   ① 增量同步按「syncVersion > 上次同步点」扫描，版本被打回后这次改动永远扫不到，传不上去；
   *   ② 下一轮拉取时远端的高版本旧账单会按 LWW 胜出，把本地刚算出来的值覆盖回去，
   *      表现就是「改了读数，账单过一会儿又变回原样」。
   * 因此任何重算入口都必须先确保账单已装载。
   */
  let loaded = false;

  const billList = computed(() => Object.values(bills.value).filter((b) => !b.isDeleted));

  function billForMonth(month: string, premiseId?: string): Bill | undefined {
    if (premiseId) return bills.value[`${premiseId}:${month}`];
    return Object.values(bills.value).find((b) => b.yearMonth === month && !b.isDeleted);
  }

  function recentMonths(n: number): Bill[] {
    return billList.value
      .slice()
      .sort((a, b) => (a.yearMonth < b.yearMonth ? 1 : -1))
      .slice(0, n);
  }

  function totalOf(month: string): number {
    const list = billList.value.filter((b) => b.yearMonth === month);
    return round2(list.reduce((sum, b) => sum + b.totalCost, 0));
  }

  async function load(): Promise<void> {
    try {
      const all = await billRepo.getAllBills();
      const map: Record<string, Bill> = {};
      for (const b of all) {
        if (!b.isDeleted) map[b.id] = b;
      }
      bills.value = map;
      loaded = true;
    } catch (err) {
      logger.error('store:bills', '加载账单失败', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * 比较两张账单的「业务值」是否一致（忽略 generatedAt / updatedAt / syncVersion 等元字段）。
   *
   * 存在意义：账单是由「读数 + 单价 + 预算」派生出的计算结果，重算是幂等操作。
   * 若每次重算都无条件自增 syncVersion，会与 WebDAV 同步形成自触发死循环：
   *   applySnapshot → recomputeAll → 版本 +1 → 被判定为本地更新并推送
   *   → 对端拉取后同样重算 +1 → 推回本机 → 无限乒乓（且会打爆服务端限流）。
   * 因此业务值未变时必须视为「无变化」，不写库、不自增版本、不发事件。
   */
  function isSameBillValue(a: Bill, b: Bill): boolean {
    return (
      a.electricityUsage === b.electricityUsage &&
      a.electricityCost === b.electricityCost &&
      a.waterUsage === b.waterUsage &&
      a.waterCost === b.waterCost &&
      // 房租参与判等：改了房租/显示开关必须产生新版本，否则同步端看不到变化
      (a.rent ?? 0) === (b.rent ?? 0) &&
      (a.rentVisible ?? false) === (b.rentVisible ?? false) &&
      a.totalCost === b.totalCost &&
      a.budgetStatus === b.budgetStatus &&
      a.isDeleted === b.isDeleted
    );
  }

  /** 首次重算前把库里的账单装载进内存（详见 loaded 的注释） */
  async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    await load();
  }

  async function recompute(premiseId: string, yearMonth: string): Promise<Bill> {
    await ensureLoaded();
    const allReadings = await readingRepo.getAllReadings();
    return computeBill(premiseId, yearMonth, allReadings);
  }

  /**
   * 核心账单计算（纯派生，幂等）。
   * 月度用量改用 monthlyUsage：取该月净用量（月末 − 月初基准），
   * 月内录多条读数也不会少计（修复此前只取末条单差导致少计的问题）。
   * 详见 src/utils/billing.ts。
   *
   * 0.1.1 起在「用量 × 单价」之后追加两步房源级折算：
   *   ① 结算模式（applySettlement）：电、水各自独立取整，落库值即最终收费；
   *   ② 房租：勾选「计入账单」时按填写金额全额加进总额（不参与水电取整）。
   */
  async function computeBill(premiseId: string, yearMonth: string, allReadings: Reading[]): Promise<Bill> {
    const eleUsage = monthlyUsage(allReadings, premiseId, 'electricity', yearMonth);
    const waterUsage = monthlyUsage(allReadings, premiseId, 'water', yearMonth);
    const price = await priceRepo.getPrice(premiseId);
    // 读 repo 而非 premises store：computeBill 也会在同步 applySnapshot 阶段被调用，
    // 那时内存 store 可能还没刷新，直接读库拿到的才是刚合并落地的最新配置。
    const premise = await premiseRepo.getPremise(premiseId);
    const settlement = premise?.settlement;
    const eleCost = applySettlement(
      calcCost('electricity', eleUsage, price),
      settlement?.electricity,
    );
    const waterCost = applySettlement(calcCost('water', waterUsage, price), settlement?.water);
    // 房租：未勾选显示 → 完全不体现（rent 记 0），勾选 → 全额计入
    const rentVisible = premise?.rentVisible === true;
    const rentAmount = Number(premise?.rent);
    const rent = rentVisible && Number.isFinite(rentAmount) ? round2(Math.max(0, rentAmount)) : 0;
    const total = round2(eleCost + waterCost + rent);

    const billId = `${premiseId}:${yearMonth}`;
    const now = new Date().toISOString();
    const existing = bills.value[billId];

    const bill: Bill = {
      id: billId,
      premiseId,
      yearMonth,
      electricityUsage: round2(eleUsage),
      electricityCost: round2(eleCost),
      waterUsage: round2(waterUsage),
      waterCost: round2(waterCost),
      rent,
      rentVisible,
      totalCost: total,
      budgetStatus: 'ok',
      generatedAt: now,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      syncVersion: (existing?.syncVersion ?? 0) + 1,
      isDeleted: false,
    };

    // 预算状态由 budget store 计算回写（D8）
    const budgetStore = useBudgetsStore();
    bill.budgetStatus = budgetStore.statusForBill(bill);

    // 幂等短路：业务值与既有账单完全一致时不产生新版本（详见 isSameBillValue 的说明）
    if (existing && isSameBillValue(existing, bill)) {
      return existing;
    }

    await billRepo.putBill(bill);
    bills.value[billId] = bill;
    eventBus.emit(EVENTS.BILL_RECALCULATED, bill);
    return bill;
  }

  /**
   * 批量重算某房源的多个月份。
   * 相比循环调用 recompute()，全量读数只从 IndexedDB 取一次 ——
   * 补录历史读数会级联重算数十个月，逐月全表扫描的开销是不可接受的。
   *
   * @returns 金额实际发生变化的月份数（幂等短路的月份不计入）。
   *          调用方据此判断「这次编辑到底有没有影响账单」，用于给用户明确回执：
   *          累计表按「月末读数 − 月初基准」计费，改动月内中间的抄表记录
   *          在数学上就不该改变月账单，没有回执用户只会以为「重算没触发」。
   */
  async function recomputeMonths(premiseId: string, months: string[]): Promise<number> {
    if (!premiseId || months.length === 0) return 0;
    await ensureLoaded();
    const all = await readingRepo.getAllReadings();
    let changed = 0;
    for (const m of months) {
      const before = bills.value[`${premiseId}:${m}`]?.syncVersion;
      const after = await computeBill(premiseId, m, all);
      // 幂等短路时 computeBill 原样返回旧账单对象，syncVersion 不变
      if (after.syncVersion !== before) changed++;
    }
    return changed;
  }

  /**
   * 重算某房源的**全部**历史月份账单。
   * 用于「房源级配置变更」——结算模式、房租、单价 —— 这类改动影响该房源所有月份的金额。
   * 只遍历确实有读数的月份，不会凭空造出空账单。
   */
  async function recomputePremise(premiseId: string): Promise<void> {
    if (!premiseId) return;
    await ensureLoaded();
    const all = await readingRepo.getAllReadings();
    const months = new Set<string>();
    for (const r of all) {
      if (r.isDeleted || r.premiseId !== premiseId) continue;
      months.add(monthKeyFromDate(r.date));
    }
    for (const m of [...months].sort()) {
      await computeBill(premiseId, m, all);
    }
  }

  /**
   * @returns 金额实际发生变化的月份数（幂等短路的月份不计入），
   *          供回收站自清洗生成「重算了 N 个月」的回执。原有调用方忽略返回值即可。
   */
  async function recomputeAll(): Promise<number> {
    await ensureLoaded();
    // 按 (premiseId, monthKey) 组合去重，避免遍历不存在的 premise×month 组合。
    // 全量读数只取一次，按月分组后复用，避免每条 month 重复扫描 IndexedDB。
    const all = await readingRepo.getAllReadings();
    const pairs = new Set<string>();
    for (const r of all) {
      if (r.isDeleted || !r.premiseId) continue;
      pairs.add(`${r.premiseId}\u0000${monthKeyFromDate(r.date)}`); // \u0000 作分隔符防碰撞
    }
    let changed = 0;
    for (const pair of pairs) {
      const [premiseId, yearMonth] = pair.split('\u0000');
      const before = bills.value[`${premiseId}:${yearMonth}`]?.syncVersion;
      const after = await computeBill(premiseId, yearMonth, all);
      if (after.syncVersion !== before) changed++;
    }
    return changed;
  }

  return {
    bills,
    currentMonth,
    billList,
    billForMonth,
    recentMonths,
    totalOf,
    load,
    recompute,
    recomputeMonths,
    recomputePremise,
    recomputeAll,
  };
});

/**
 * 账单 store（聚合该房源该月读数 → 用量 × 单价 → 写 Bill；预算状态回写 D8）
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Bill, Reading } from '@/types';
import * as billRepo from '@/db/repositories/billRepo';
import * as readingRepo from '@/db/repositories/readingRepo';
import * as priceRepo from '@/db/repositories/priceRepo';
import { useBudgetsStore } from './budgets';
import { calcCost } from '@/utils/pricing';
import { round2 } from '@/utils/format';
import { monthKeyFromDate } from '@/utils/dayjs';
import { monthlyUsage } from '@/utils/billing';
import { eventBus, EVENTS } from '@/utils/eventBus';
import { logger } from '@/utils/logger';

// 月度用量计算已抽离到纯函数 src/utils/billing.ts（monthlyUsage），便于单测。

export const useBillsStore = defineStore('bills', () => {
  const bills = ref<Record<string, Bill>>({});
  const currentMonth = ref<string>('');

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
      a.totalCost === b.totalCost &&
      a.budgetStatus === b.budgetStatus &&
      a.isDeleted === b.isDeleted
    );
  }

  async function recompute(premiseId: string, yearMonth: string): Promise<Bill> {
    const allReadings = await readingRepo.getAllReadings();
    return computeBill(premiseId, yearMonth, allReadings);
  }

  /**
   * 核心账单计算（纯派生，幂等）。
   * 月度用量改用 monthlyUsage：取该月净用量（月末 − 月初基准），
   * 月内录多条读数也不会少计（修复此前只取末条单差导致少计的问题）。
   * 详见 src/utils/billing.ts。
   */
  async function computeBill(premiseId: string, yearMonth: string, allReadings: Reading[]): Promise<Bill> {
    const eleUsage = monthlyUsage(allReadings, premiseId, 'electricity', yearMonth);
    const waterUsage = monthlyUsage(allReadings, premiseId, 'water', yearMonth);
    const price = await priceRepo.getPrice(premiseId);
    const eleCost = calcCost('electricity', eleUsage, price);
    const waterCost = calcCost('water', waterUsage, price);
    const total = round2(eleCost + waterCost);

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

  async function recomputeAll(): Promise<void> {
    // 按 (premiseId, monthKey) 组合去重，避免遍历不存在的 premise×month 组合。
    // 全量读数只取一次，按月分组后复用，避免每条 month 重复扫描 IndexedDB。
    const all = await readingRepo.getAllReadings();
    const pairs = new Set<string>();
    for (const r of all) {
      if (r.isDeleted) continue;
      pairs.add(`${r.premiseId}\u0000${monthKeyFromDate(r.date)}`); // \u0000 作分隔符防碰撞
    }
    for (const pair of pairs) {
      const [premiseId, yearMonth] = pair.split('\u0000');
      await computeBill(premiseId, yearMonth, all);
    }
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
    recomputeAll,
  };
});

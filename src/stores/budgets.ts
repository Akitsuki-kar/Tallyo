/**
 * 预算 store（D3：按房源独立；UI 在 Phase 5，此处先实现计算逻辑）
 * 支持「按金额(amount)」与「按用量(usage)」两种口径，80%/100% 预警。
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Bill, Budget, BudgetStatus } from '@/types';
import * as budgetRepo from '@/db/repositories/budgetRepo';
import { eventBus, EVENTS } from '@/utils/eventBus';
import { logger } from '@/utils/logger';

export const useBudgetsStore = defineStore('budgets', () => {
  const records = ref<Record<string, Budget>>({});

  async function load(): Promise<void> {
    try {
      const all = await budgetRepo.getAllBudgets();
      const map: Record<string, Budget> = {};
      for (const b of all) {
        if (!b.isDeleted) map[b.premiseId] = b;
      }
      records.value = map;
    } catch (err) {
      logger.error('store:budgets', '加载预算失败', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function getBudget(premiseId: string): Budget | undefined {
    return records.value[premiseId];
  }

  function ensureDefault(premiseId: string): void {
    if (records.value[premiseId]) return;
    records.value[premiseId] = {
      id: '',
      premiseId,
      mode: 'amount',
      electricityLimit: 0,
      waterLimit: 0,
      createdAt: '',
      updatedAt: '',
      syncVersion: 0,
      isDeleted: false,
    };
  }

  async function setBudget(
    premiseId: string,
    patch: Partial<Pick<Budget, 'mode' | 'electricityLimit' | 'waterLimit'>>,
  ): Promise<void> {
    const existing = records.value[premiseId];
    const now = new Date().toISOString();
    const merged: Budget = {
      id: existing?.id ?? '',
      premiseId,
      mode: patch.mode ?? existing?.mode ?? 'amount',
      electricityLimit: patch.electricityLimit ?? existing?.electricityLimit ?? 0,
      waterLimit: patch.waterLimit ?? existing?.waterLimit ?? 0,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      syncVersion: (existing?.syncVersion ?? 0) + 1,
      isDeleted: false,
    };
    await budgetRepo.putBudget(merged);
    records.value[premiseId] = merged;
    // 通知 UI 刷新 & 触发自动同步推送
    eventBus.emit(EVENTS.BUDGET_CHANGED, { premiseId });
  }

  /**
   * 房源删除时清理预算（软删墓碑，需随同步传播到对端）。
   * 与 prices.removePriceForPremise 对称，由 premises.removePremise 级联调用。
   */
  async function removeBudgetForPremise(premiseId: string): Promise<void> {
    const existing = await budgetRepo.getBudgetRecord(premiseId);
    if (!existing || existing.isDeleted) return;
    const tombstone: Budget = {
      ...existing,
      isDeleted: true,
      updatedAt: new Date().toISOString(),
      syncVersion: existing.syncVersion + 1,
    };
    await budgetRepo.putBudget(tombstone);
    delete records.value[premiseId];
    eventBus.emit(EVENTS.BUDGET_CHANGED, { premiseId });
  }

  /**
   * 撤销删除房源时恢复其预算配置（removeBudgetForPremise 的逆操作）。
   * 仅在存在墓碑记录时生效，避免给从未设过预算的房源凭空造出一条记录。
   */
  async function restoreBudgetForPremise(premiseId: string): Promise<void> {
    const existing = await budgetRepo.getBudgetRecord(premiseId);
    if (!existing || !existing.isDeleted) return;
    const restored: Budget = {
      ...existing,
      isDeleted: false,
      updatedAt: new Date().toISOString(),
      syncVersion: existing.syncVersion + 1,
    };
    await budgetRepo.putBudget(restored);
    records.value[premiseId] = restored;
    eventBus.emit(EVENTS.BUDGET_CHANGED, { premiseId });
  }

  /** 计算某账单相对其房源预算的状态（80%/100% 预警，按 mode 维度） */
  function statusForBill(bill: Bill): BudgetStatus {
    const budget = records.value[bill.premiseId];
    if (!budget) return 'ok';
    const checks: Array<{ actual: number; limit: number }> = [];
    if (budget.mode === 'amount') {
      checks.push({ actual: bill.electricityCost, limit: budget.electricityLimit });
      checks.push({ actual: bill.waterCost, limit: budget.waterLimit });
    } else {
      checks.push({ actual: bill.electricityUsage, limit: budget.electricityLimit });
      checks.push({ actual: bill.waterUsage, limit: budget.waterLimit });
    }
    let status: BudgetStatus = 'ok';
    for (const c of checks) {
      if (c.limit > 0 && c.actual >= c.limit) {
        status = 'exceeded';
        break;
      }
      if (c.limit > 0 && c.actual >= c.limit * 0.8) {
        status = 'warning';
      }
    }
    return status;
  }

  /** 计算某维度（电/水）相对预算的使用率 */
  function ratioFor(type: 'electricity' | 'water', bill: Bill): number {
    const budget = records.value[bill.premiseId];
    if (!budget) return 0;
    const limit = type === 'electricity' ? budget.electricityLimit : budget.waterLimit;
    if (limit <= 0) return 0;
    const actual =
      budget.mode === 'amount'
        ? type === 'electricity'
          ? bill.electricityCost
          : bill.waterCost
        : type === 'electricity'
          ? bill.electricityUsage
          : bill.waterUsage;
    return actual / limit;
  }

  /** 触发预警的维度列表（80%/100%） */
  function warnings(bill: Bill): Array<{ type: 'electricity' | 'water'; level: 'warning' | 'exceeded' }> {
    const result: Array<{ type: 'electricity' | 'water'; level: 'warning' | 'exceeded' }> = [];
    const ratioE = ratioFor('electricity', bill);
    const ratioW = ratioFor('water', bill);
    if (ratioE >= 1) result.push({ type: 'electricity', level: 'exceeded' });
    else if (ratioE >= 0.8) result.push({ type: 'electricity', level: 'warning' });
    if (ratioW >= 1) result.push({ type: 'water', level: 'exceeded' });
    else if (ratioW >= 0.8) result.push({ type: 'water', level: 'warning' });
    return result;
  }

  /** 计算并回写账单预算状态（D8：由 budget store 回写） */
  async function evaluate(bill: Bill): Promise<BudgetStatus> {
    const status = statusForBill(bill);
    if (bill.budgetStatus !== status) {
      bill.budgetStatus = status;
    }
    return status;
  }

  return {
    records,
    load,
    getBudget,
    ensureDefault,
    setBudget,
    removeBudgetForPremise,
    restoreBudgetForPremise,
    statusForBill,
    ratioFor,
    warnings,
    evaluate,
  };
});

/**
 * 预算 Repository（D3，按房源存于 budgets store，key=premiseId）
 */
import { getDB } from '../database';
import { safePut } from '../guard';
import type { Budget } from '@/types';
import { toPlain } from '@/utils/clone';
import { logger } from '@/utils/logger';
import { ERROR_CODES } from '@/utils/errorCodes';

const DEFAULT_BUDGET: Omit<Budget, 'premiseId'> = {
  id: '',
  mode: 'amount',
  electricityLimit: 0,
  waterLimit: 0,
  createdAt: '',
  updatedAt: '',
  syncVersion: 0,
  isDeleted: false,
};

export async function putBudget(b: Budget): Promise<void> {
  try {
    const db = await getDB();
    // 剥离 Vue reactive proxy，防止 IndexedDB structured clone 失败
    await safePut(db, 'budgets', toPlain(b));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('db:budget', '写入预算失败', { code: ERROR_CODES.SDB_DB_WRITE_FAIL, message });
    throw err;
  }
}

export async function getBudgetRecord(premiseId: string): Promise<Budget | undefined> {
  const db = await getDB();
  return db.get('budgets', premiseId);
}

/** 取某房源预算；缺失时返回默认（限额 0 表示不约束） */
export async function getBudget(premiseId: string): Promise<Budget> {
  const rec = await getBudgetRecord(premiseId);
  if (rec && !rec.isDeleted) return rec;
  return { ...DEFAULT_BUDGET, premiseId };
}

export async function getAllBudgets(): Promise<Budget[]> {
  const db = await getDB();
  return db.getAll('budgets');
}

/**
 * 增量扫描：返回 syncVersion 大于 since 的记录。
 * 使用 syncVersion 索引 + IDBKeyRange.upperBound 直接在索引层过滤。
 */
export async function getDirtyBudgetsSince(since: number): Promise<Budget[]> {
  const db = await getDB();
  // lowerBound(since, true) → syncVersion > since（exclusive）
  // 注意：不可用 upperBound——那取到的是「syncVersion < since」的反向集合。
  const range = IDBKeyRange.lowerBound(since, true);
  return db.getAllFromIndex('budgets', 'syncVersion', range);
}

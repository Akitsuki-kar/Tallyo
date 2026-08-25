/**
 * 账单 Repository（含软删与增量扫描接口）
 */
import { getDB } from '../database';
import { safePut, safeDelete } from '../guard';
import type { Bill } from '@/types';
import { toPlain } from '@/utils/clone';
import { logger } from '@/utils/logger';
import { ERROR_CODES } from '@/utils/errorCodes';

export async function putBill(bill: Bill): Promise<void> {
  try {
    const db = await getDB();
    // 剥离 Vue reactive proxy，防止 IndexedDB structured clone 失败
    await safePut(db, 'bills', toPlain(bill));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('db:bill', '写入账单失败', { code: ERROR_CODES.SDB_DB_WRITE_FAIL, message });
    throw err;
  }
}

export async function getBill(id: string): Promise<Bill | undefined> {
  const db = await getDB();
  return db.get('bills', id);
}

export async function getAllBills(): Promise<Bill[]> {
  const db = await getDB();
  return db.getAll('bills');
}

export async function getBillsByPremise(premiseId: string): Promise<Bill[]> {
  const db = await getDB();
  return db.getAllFromIndex('bills', 'premiseId', premiseId);
}

/**
 * 增量扫描：返回 syncVersion 大于 since 的记录（含软删墓碑）。
 * 使用 syncVersion 索引 + IDBKeyRange.upperBound 直接在索引层过滤，
 * 避免 getAll 全量加载再 JS filter。
 */
export async function getDirtyBillsSince(since: number): Promise<Bill[]> {
  const db = await getDB();
  const range = IDBKeyRange.upperBound(since, true); // exclusive → syncVersion > since
  return db.getAllFromIndex('bills', 'syncVersion', range);
}

export async function deleteBillHard(id: string): Promise<void> {
  const db = await getDB();
  await safeDelete(db, 'bills', id);
}

/**
 * 房源 Repository（D1）
 */
import { getDB } from '../database';
import { safePut } from '../guard';
import type { Premise } from '@/types';
import { toPlain } from '@/utils/clone';
import { logger } from '@/utils/logger';
import { ERROR_CODES } from '@/utils/errorCodes';

export async function putPremise(p: Premise): Promise<void> {
  try {
    const db = await getDB();
    // 剥离 Vue reactive proxy，防止 IndexedDB structured clone 失败
    await safePut(db, 'premises', toPlain(p));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('db:premise', '写入房源失败', { code: ERROR_CODES.SDB_DB_WRITE_FAIL, message });
    throw err;
  }
}

export async function getPremise(id: string): Promise<Premise | undefined> {
  const db = await getDB();
  return db.get('premises', id);
}

export async function getAllPremises(): Promise<Premise[]> {
  const db = await getDB();
  return db.getAll('premises');
}

/**
 * 增量扫描：返回 syncVersion 大于 since 的记录（含软删墓碑）。
 * 使用 syncVersion 索引 + IDBKeyRange.upperBound 直接在索引层过滤。
 */
export async function getDirtyPremisesSince(since: number): Promise<Premise[]> {
  const db = await getDB();
  // lowerBound(since, true) → syncVersion > since（exclusive）
  // 注意：不可用 upperBound——那取到的是「syncVersion < since」的反向集合。
  const range = IDBKeyRange.lowerBound(since, true);
  return db.getAllFromIndex('premises', 'syncVersion', range);
}

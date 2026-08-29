/**
 * 读数 Repository（含软删与增量扫描接口）
 *
 * 索引使用策略：
 * - getReadingsByPremiseMonth：用复合索引 [premiseId, date] 范围查询（v2 新增）
 * - getDirtyReadingsSince：用 syncVersion 索引 + IDBKeyRange.upperBound 排除已扫描记录
 */
import { getDB } from '../database';
import { safePut } from '../guard';
import type { Reading, ReadingType } from '@/types';
import { toPlain } from '@/utils/clone';
import { logger } from '@/utils/logger';
import { ERROR_CODES } from '@/utils/errorCodes';

export async function putReading(reading: Reading): Promise<void> {
  try {
    const db = await getDB();
    // toPlain：剥离 Vue reactive proxy，避免 IndexedDB structured clone 抛
    // "could not be cloned" 错误（参见 utils/clone.ts 注释）。
    await safePut(db, 'readings', toPlain(reading));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('db:reading', '写入读数失败', { code: ERROR_CODES.SDB_DB_WRITE_FAIL, message });
    throw err;
  }
}

export async function getReading(id: string): Promise<Reading | undefined> {
  const db = await getDB();
  return db.get('readings', id);
}

export async function getAllReadings(): Promise<Reading[]> {
  const db = await getDB();
  return db.getAll('readings');
}

export async function getReadingsByPremise(premiseId: string): Promise<Reading[]> {
  const db = await getDB();
  return db.getAllFromIndex('readings', 'premiseId', premiseId);
}

/**
 * 取某房源某月（YYYY-MM）的全部读数（排除软删）。
 *
 * 使用复合索引 [premiseId, date] 做 IDBKeyRange 范围查询，
 * 仅拉取该房源该月的记录，避免全量取再 JS filter。
 * 软删记录在 JS 侧排除（复合索引不含 isDeleted，且业务上月度读数量很小）。
 */
export async function getReadingsByPremiseMonth(premiseId: string, yearMonth: string): Promise<Reading[]> {
  const db = await getDB();
  // date 格式为 'YYYY-MM-DD'，用 '-00' / '-99' 做边界确保覆盖该月所有日期
  const range = IDBKeyRange.bound(
    [premiseId, `${yearMonth}-00`],
    [premiseId, `${yearMonth}-99`],
  );
  const all = await db.getAllFromIndex('readings', 'premiseId_date', range);
  return all.filter((r) => !r.isDeleted);
}

/** 取某房源某类型最近一次读数（排除软删） */
export async function getLatestReading(premiseId: string, type: ReadingType): Promise<Reading | undefined> {
  const all = await getReadingsByPremise(premiseId);
  return all
    .filter((r) => !r.isDeleted && r.type === type)
    .sort((a, b) =>
      a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1,
    )[0];
}

/**
 * 增量扫描：返回 syncVersion 大于 since 的记录（含软删墓碑），用于 Phase 3 同步。
 * 使用 syncVersion 索引 + IDBKeyRange.upperBound(since, true) 直接在索引层过滤，
 * 避免 getAll 全量加载再 JS filter。
 */
export async function getDirtyReadingsSince(since: number): Promise<Reading[]> {
  const db = await getDB();
  // lowerBound(since, true) → syncVersion > since（exclusive）
  // 注意：不可用 upperBound——那取到的是「syncVersion < since」的反向集合，
  // 会让增量扫描恰好漏掉所有待同步的新变更。
  const range = IDBKeyRange.lowerBound(since, true);
  return db.getAllFromIndex('readings', 'syncVersion', range);
}

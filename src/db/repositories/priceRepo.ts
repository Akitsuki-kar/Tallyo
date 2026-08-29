/**
 * 单价 Repository（D2，按房源存于 prices store，key=premiseId）
 */
import { getDB } from '../database';
import { safePut } from '../guard';
import type { PriceConfig, PriceRecord } from '@/types';
import { defaultPriceConfig } from '@/utils/pricing';
import { logger } from '@/utils/logger';
import { ERROR_CODES } from '@/utils/errorCodes';
import { toPlain } from '@/utils/clone';

export async function putPrice(record: PriceRecord): Promise<void> {
  try {
    const db = await getDB();
    // 剥离 Vue reactive proxy，防止 IndexedDB structured clone 失败
    await safePut(db, 'prices', toPlain(record));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('db:price', '写入单价失败', { code: ERROR_CODES.SDB_DB_WRITE_FAIL, message });
    throw err;
  }
}

export async function getPriceRecord(premiseId: string): Promise<PriceRecord | undefined> {
  const db = await getDB();
  return db.get('prices', premiseId);
}

/** 取某房源单价；缺失时返回默认配置（不写入，由 store 负责 seed） */
export async function getPrice(premiseId: string): Promise<PriceConfig> {
  const rec = await getPriceRecord(premiseId);
  return rec && !rec.isDeleted ? rec.config : defaultPriceConfig();
}

export async function getAllPrices(): Promise<PriceRecord[]> {
  const db = await getDB();
  return db.getAll('prices');
}

/**
 * 增量扫描：返回 syncVersion 大于 since 的记录。
 * 使用 syncVersion 索引 + IDBKeyRange.upperBound 直接在索引层过滤。
 */
export async function getDirtyPricesSince(since: number): Promise<PriceRecord[]> {
  const db = await getDB();
  // lowerBound(since, true) → syncVersion > since（exclusive）
  // 注意：不可用 upperBound——那取到的是「syncVersion < since」的反向集合。
  const range = IDBKeyRange.lowerBound(since, true);
  return db.getAllFromIndex('prices', 'syncVersion', range);
}

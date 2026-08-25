/**
 * KV Repository（存 settings / syncConfig 等单条记录，key=key）
 */
import { getDB } from '../database';
import { safePut } from '../guard';
import type { KvRecord } from '@/types';
import { toPlain } from '@/utils/clone';
import { logger } from '@/utils/logger';
import { ERROR_CODES } from '@/utils/errorCodes';

export async function putKv<T>(record: KvRecord<T>): Promise<void> {
  try {
    const db = await getDB();
    // 剥离 Vue reactive proxy，防止 IndexedDB structured clone 失败
    await safePut(db, 'kv', toPlain(record) as KvRecord);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('db:kv', '写入 KV 失败', { code: ERROR_CODES.SDB_DB_WRITE_FAIL, message });
    throw err;
  }
}

export async function getKv<T>(key: string): Promise<KvRecord<T> | undefined> {
  const db = await getDB();
  return db.get('kv', key) as Promise<KvRecord<T> | undefined>;
}

export async function getAllKv(): Promise<KvRecord[]> {
  const db = await getDB();
  return db.getAll('kv');
}

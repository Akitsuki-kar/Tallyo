/**
 * 永久删除标记 Repository（purges store）
 *
 * 存储「已被永久删除」的实体主键。它是墓碑之上的第二层：
 * 墓碑表达「这条记录被删了」，标记表达「连墓碑也一并抹掉」。
 * 没有它，本地物理删除会在下一轮全量快照合并时被远端墓碑复活
 * （详见 types/models.ts PurgeMarker 的说明）。
 */
import { getDB } from '../database';
import { safePut } from '../guard';
import type { PurgeMarker, TrashStoreName } from '@/types';
import { toPlain } from '@/utils/clone';
import { logger } from '@/utils/logger';
import { ERROR_CODES } from '@/utils/errorCodes';

/** 标记主键：${store}:${id}。用 \u0000 之外的冒号是安全的——store 名与 id 都不含冒号 */
export function purgeKeyOf(store: TrashStoreName, id: string): string {
  return `${store}:${id}`;
}

export function makePurgeMarker(
  store: TrashStoreName,
  id: string,
  purgedAt: string = new Date().toISOString(),
): PurgeMarker {
  return { key: purgeKeyOf(store, id), store, id, purgedAt };
}

export async function putPurge(marker: PurgeMarker): Promise<void> {
  try {
    const db = await getDB();
    await safePut(db, 'purges', toPlain(marker));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('db:purge', '写入永久删除标记失败', { code: ERROR_CODES.SDB_DB_WRITE_FAIL, message });
    throw err;
  }
}

export async function getAllPurges(): Promise<PurgeMarker[]> {
  const db = await getDB();
  return db.getAll('purges');
}

/** 批量删除标记（标记已完成使命或已作废时回收，避免 purges 自身无限增长） */
export async function deletePurges(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const db = await getDB();
  const tx = db.transaction('purges', 'readwrite');
  await Promise.all(keys.map((k) => tx.store.delete(k)));
  await tx.done;
}

/** 按实体主键批量写标记（回收站「永久删除」/ 自清洗批量清理用） */
export async function putPurgeBatch(markers: PurgeMarker[]): Promise<void> {
  if (markers.length === 0) return;
  const db = await getDB();
  const tx = db.transaction('purges', 'readwrite');
  await Promise.all(markers.map((m) => tx.store.put(toPlain(m))));
  await tx.done;
}

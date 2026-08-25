/**
 * IndexedDB 写入守卫（高优②）。
 * 统一在 db.put / db.delete 外层捕获 QuotaExceededError，
 * 转为携带错误码 SDB_DB_QUOTA 的 SdbError，便于上层（store / UI）给出
 * 「存储空间不足，请导出备份」的可操作提示，而非抛未处理异常导致静默失败。
 *
 * 仅包裹写操作；读操作（get / getAll）不涉及配额写入，无需包裹。
 */
import type { IDBPDatabase, StoreNames } from 'idb';
import type { SdbDBSchema } from './schema';
import { SdbError } from '@/sync/errors';
import { ERROR_CODES } from '@/utils/errorCodes';

/** 判断错误是否为「存储配额不足」（兼容各浏览器命名） */
export function isQuotaError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const name = err.name;
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') return true;
  // 旧版 Firefox 用数值 code 表示
  const code = (err as { code?: number }).code;
  return code === 22 || code === 1014;
}

export async function safePut(
  db: IDBPDatabase<SdbDBSchema>,
  store: StoreNames<SdbDBSchema>,
  value: unknown,
): Promise<void> {
  try {
    await db.put(store, value as never);
  } catch (err) {
    if (isQuotaError(err)) {
      throw new SdbError(
        ERROR_CODES.SDB_DB_QUOTA,
        'storage',
        '本地存储空间不足，保存失败。请导出数据备份或清理浏览器数据后重试。',
      );
    }
    throw err;
  }
}

export async function safeDelete(
  db: IDBPDatabase<SdbDBSchema>,
  store: StoreNames<SdbDBSchema>,
  key: string,
): Promise<void> {
  try {
    await db.delete(store, key);
  } catch (err) {
    if (isQuotaError(err)) {
      throw new SdbError(
        ERROR_CODES.SDB_DB_QUOTA,
        'storage',
        '本地存储空间不足，操作失败。请导出数据备份或清理浏览器数据后重试。',
      );
    }
    throw err;
  }
}

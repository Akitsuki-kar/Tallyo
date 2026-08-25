/**
 * IndexedDB 连接管理（单例 + 缓存，architecture.md §3）
 *
 * 升级流程：openDB 在检测到本地版本低于 DB_VERSION 时触发 upgrade 回调，
 * 回调内调用 createStores(db, oldVersion, transaction) 逐版本迁移。
 */
import { openDB, type IDBPDatabase } from 'idb';
import { DB_NAME, DB_VERSION, createStores, type SdbDBSchema } from './schema';
import { logger } from '@/utils/logger';
import { ERROR_CODES } from '@/utils/errorCodes';

let dbPromise: Promise<IDBPDatabase<SdbDBSchema>> | null = null;

/** 获取（并缓存）IndexedDB 连接单例 */
export function getDB(): Promise<IDBPDatabase<SdbDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<SdbDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, newVersion, transaction) {
        logger.info('db', '数据库升级', { from: oldVersion, to: newVersion });
        createStores(db, oldVersion, transaction);
      },
    }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('db', '打开数据库失败', { code: ERROR_CODES.SDB_DB_OPEN_FAIL, message });
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

/** 重置连接（用于迁移或测试预留） */
export function resetDBConnection(): void {
  dbPromise = null;
}

/** 持久化授权状态（navigator.storage.persist 的返回语义） */
export type StoragePersistenceStatus = 'granted' | 'denied' | 'prompt' | 'unsupported' | 'unknown';

/**
 * 申请 IndexedDB 持久化存储权限（高优①）。
 * 本地优先账本若被浏览器在存储压力下静默清除将造成数据丢失，
 * 故启动时应主动申请「持久化」以显著降低被回收概率。
 * - granted：已授权（最安全）
 * - prompt：未授权，用户可在浏览器设置中手动开启（返回 false）
 * - denied：申请过程异常
 * - unsupported：当前环境不支持（如隐私模式 / 旧浏览器）
 */
export async function requestPersistentStorage(): Promise<StoragePersistenceStatus> {
  try {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    if (!nav || !nav.storage || typeof nav.storage.persist !== 'function') {
      return 'unsupported';
    }
    const granted = await nav.storage.persist();
    return granted ? 'granted' : 'prompt';
  } catch {
    return 'denied';
  }
}

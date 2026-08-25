/**
 * IndexedDB Schema 定义（architecture.md §3.2，扩展 D1–D3 多房源/单价/预算）
 *
 * 版本历史：
 * v1 — 初始版本，创建全部 object store 与基础索引。
 * v2 — 新增 readings 复合索引 [premiseId, date]（优化月度查询，避免全量扫描再 JS filter）。
 */
import type { DBSchema, IDBPDatabase, IDBPTransaction, StoreNames } from 'idb';
import type { Reading, Bill, Premise, PriceRecord, Budget, KvRecord } from '@/types';

export const DB_NAME = 'shuidian-dongzhang';
export const DB_VERSION = 2;

export interface SdbDBSchema extends DBSchema {
  readings: {
    key: string;
    value: Reading;
    indexes: {
      premiseId: string;
      type: string;
      date: string;
      createdAt: string;
      syncVersion: number;
      isDeleted: number;
      /** 复合索引：[premiseId, date]，用于按房源+月份高效查询（v2 新增） */
      'premiseId_date': [string, string];
    };
  };
  bills: {
    key: string;
    value: Bill;
    indexes: {
      premiseId: string;
      yearMonth: string;
      syncVersion: number;
      isDeleted: number;
    };
  };
  premises: {
    key: string;
    value: Premise;
    indexes: {
      createdAt: string;
      syncVersion: number;
      isDeleted: number;
    };
  };
  prices: {
    key: string;
    value: PriceRecord;
    indexes: {
      updatedAt: string;
      syncVersion: number;
      isDeleted: number;
    };
  };
  budgets: {
    key: string;
    value: Budget;
    indexes: {
      updatedAt: string;
      syncVersion: number;
      isDeleted: number;
    };
  };
  kv: {
    key: string;
    value: KvRecord;
    indexes: {
      updatedAt: string;
      syncVersion: number;
      isDeleted: number;
    };
  };
}

/** versionchange 事务类型（升级回调中操作已有 store 时使用） */
type UpgradeTransaction = IDBPTransaction<SdbDBSchema, StoreNames<SdbDBSchema>[], 'versionchange'>;

/**
 * 创建 / 迁移各 object store 与索引。
 *
 * 采用「逐版本递进」模式：每个 if (oldVersion < N) 块只做该版本引入的变更，
 * 全新建库时会从 v0 依次执行所有块，保证最终状态一致。
 *
 * @param db           数据库实例
 * @param oldVersion   用户当前数据库版本（0 = 全新安装）
 * @param transaction  版本升级事务（用于访问已有 store）
 */
export function createStores(
  db: IDBPDatabase<SdbDBSchema>,
  oldVersion: number,
  transaction: UpgradeTransaction,
): void {
  // ── v1：创建全部 object store 与基础索引 ──
  if (oldVersion < 1) {
    if (!db.objectStoreNames.contains('readings')) {
      const s = db.createObjectStore('readings', { keyPath: 'id' });
      s.createIndex('premiseId', 'premiseId');
      s.createIndex('type', 'type');
      s.createIndex('date', 'date');
      s.createIndex('createdAt', 'createdAt');
      s.createIndex('syncVersion', 'syncVersion');
      s.createIndex('isDeleted', 'isDeleted');
    }
    if (!db.objectStoreNames.contains('bills')) {
      const s = db.createObjectStore('bills', { keyPath: 'id' });
      s.createIndex('premiseId', 'premiseId');
      s.createIndex('yearMonth', 'yearMonth');
      s.createIndex('syncVersion', 'syncVersion');
      s.createIndex('isDeleted', 'isDeleted');
    }
    if (!db.objectStoreNames.contains('premises')) {
      const s = db.createObjectStore('premises', { keyPath: 'id' });
      s.createIndex('createdAt', 'createdAt');
      s.createIndex('syncVersion', 'syncVersion');
      s.createIndex('isDeleted', 'isDeleted');
    }
    if (!db.objectStoreNames.contains('prices')) {
      const s = db.createObjectStore('prices', { keyPath: 'premiseId' });
      s.createIndex('updatedAt', 'updatedAt');
      s.createIndex('syncVersion', 'syncVersion');
      s.createIndex('isDeleted', 'isDeleted');
    }
    if (!db.objectStoreNames.contains('budgets')) {
      const s = db.createObjectStore('budgets', { keyPath: 'premiseId' });
      s.createIndex('updatedAt', 'updatedAt');
      s.createIndex('syncVersion', 'syncVersion');
      s.createIndex('isDeleted', 'isDeleted');
    }
    if (!db.objectStoreNames.contains('kv')) {
      const s = db.createObjectStore('kv', { keyPath: 'key' });
      s.createIndex('updatedAt', 'updatedAt');
      s.createIndex('syncVersion', 'syncVersion');
      s.createIndex('isDeleted', 'isDeleted');
    }
  }

  // ── v2：为 readings store 新增复合索引 [premiseId, date] ──
  // 优化 getReadingsByPremiseMonth：避免全量取再 JS filter，直接用索引范围查询。
  if (oldVersion < 2) {
    if (db.objectStoreNames.contains('readings')) {
      const store = transaction.objectStore('readings');
      if (!store.indexNames.contains('premiseId_date')) {
        // 复合索引：键为 [premiseId, date] 数组，支持按房源+日期范围高效查询
        store.createIndex('premiseId_date', ['premiseId', 'date']);
      }
    }
  }

  // ── 后续版本迁移示例（预留骨架） ──
  // if (oldVersion < 3) {
  //   // v3 变更...
  // }
}

/**
 * 同步合并核心（纯函数、零依赖，仅导入类型）。
 * 可被 esbuild 单独编译后在 node 中跑断言（V1 验证）。
 *
 * LWW 规则（严格按架构蓝图 §5.4 / 决策 D7）：
 *   1. 一方 isDeleted=true 另一方有值 → syncVersion 高者胜；相等则墓碑(删除)胜（保守删除）。
 *   2. syncVersion 高者胜。
 *   3. syncVersion 相等 → updatedAt（ISO 字符串字典序）较新者胜。
 *   4. 全等 → 'equal'，跳过。
 */
import type {
  Reading,
  Bill,
  Premise,
  PriceRecord,
  Budget,
  Settings,
  PurgeMarker,
} from '@/types';
import { mergePurgeMarkers } from '@/sync/purge';

/** 远端 data.json 的内容结构（绝不包含 syncConfig / passwordEnc） */
export interface SyncSnapshot {
  schemaVersion: number; // 当前 1
  exportedAt: string; // ISO
  readings: Reading[];
  bills: Bill[];
  premises: Premise[];
  prices: PriceRecord[];
  budgets: Budget[];
  settings?: Settings; // 应用偏好（用户已同意跨设备同步）
  /**
   * 永久删除标记（0.1.2 新增，可选字段）。
   * 保持可选且**不提升 schemaVersion**：老客户端只读取已知字段，遇到它会直接忽略；
   * 老客户端上传的快照没有这个字段，新客户端按空数组处理。双向兼容，无需断代升级。
   */
  purges?: PurgeMarker[];
}

/** 合并统计（供 UI 汇总提示） */
export interface MergeStats {
  pulled: number; // 远端胜（需写入本地）
  pushed: number; // 本地胜（需上传）
  conflicts: number; // 需要裁决的冲突数（双方都有且不等）
}

/** 参与 LWW 的实体最小形状 */
type LwwEntity = {
  syncVersion: number;
  updatedAt: string;
  isDeleted?: boolean;
};

/**
 * 按 LWW 裁决同键两侧记录，返回 'local' | 'remote' | 'equal'。
 */
export function resolveLWW<T extends LwwEntity>(local: T, remote: T): 'local' | 'remote' | 'equal' {
  const lDel = !!local.isDeleted;
  const rDel = !!remote.isDeleted;

  // 规则 1：一方删除、一方有值
  if (lDel !== rDel) {
    if (local.syncVersion !== remote.syncVersion) {
      return local.syncVersion > remote.syncVersion ? 'local' : 'remote';
    }
    // syncVersion 相等 → 墓碑胜（保守删除）
    return lDel ? 'local' : 'remote';
  }

  // 规则 2：syncVersion 高者胜
  if (local.syncVersion !== remote.syncVersion) {
    return local.syncVersion > remote.syncVersion ? 'local' : 'remote';
  }

  // 规则 3：syncVersion 相等 → updatedAt 较新者胜
  if (local.updatedAt !== remote.updatedAt) {
    return local.updatedAt > remote.updatedAt ? 'local' : 'remote';
  }

  // 规则 4：全等
  return 'equal';
}

/**
 * 按主键合并两侧实体数组。
 * getKey 可配置（默认取 id；prices/budgets 用 premiseId 作主键，避免用错主键互相覆盖）。
 * 返回合并结果与统计：merged=去重后的双方并集(每键取胜者)；pulled=远端胜；pushed=本地胜。
 */
export function mergeEntities<T extends LwwEntity>(
  local: T[],
  remote: T[],
  getKey: (item: T) => string = (item: T) => (item as unknown as { id: string }).id,
): { merged: T[]; pulled: T[]; pushed: T[]; conflicts: number } {
  const merged: T[] = [];
  const pulled: T[] = [];
  const pushed: T[] = [];
  let conflicts = 0;

  const localMap = new Map<string, T>();
  for (const l of local) localMap.set(getKey(l), l);
  const remoteMap = new Map<string, T>();
  for (const r of remote) remoteMap.set(getKey(r), r);

  const allKeys = new Set<string>([...localMap.keys(), ...remoteMap.keys()]);
  for (const key of allKeys) {
    const l = localMap.get(key);
    const r = remoteMap.get(key);
    if (l && !r) {
      merged.push(l);
      pushed.push(l);
    } else if (!l && r) {
      merged.push(r);
      pulled.push(r);
    } else if (l && r) {
      const res = resolveLWW(l, r);
      if (res === 'equal') {
        merged.push(l);
      } else {
        conflicts++;
        if (res === 'local') {
          merged.push(l);
          pushed.push(l);
        } else {
          merged.push(r);
          pulled.push(r);
        }
      }
    }
  }
  return { merged, pulled, pushed, conflicts };
}

/** Settings 单条对象合并（无 syncVersion，按 updatedAt 比较） */
function mergeSettings(
  local?: Settings,
  remote?: Settings,
): { merged?: Settings; pulled?: Settings; pushed?: Settings; conflicts: number } {
  if (local && !remote) return { merged: local, pushed: local, conflicts: 0 };
  if (!local && remote) return { merged: remote, pulled: remote, conflicts: 0 };
  if (!local && !remote) return { conflicts: 0 };
  // 双方都有
  if (local!.updatedAt === remote!.updatedAt) return { merged: local, conflicts: 0 };
  if (local!.updatedAt > remote!.updatedAt) {
    return { merged: local, pushed: local, conflicts: 1 };
  }
  return { merged: remote, pulled: remote, conflicts: 1 };
}

/** 合并整个快照（公开签名，供上层使用） */
export function mergeSnapshot(
  local: SyncSnapshot,
  remote: SyncSnapshot,
): { merged: SyncSnapshot; stats: MergeStats } {
  const d = mergeSnapshotDetailed(local, remote);
  return { merged: d.merged, stats: d.stats };
}

/**
 * 合并整个快照（带 pulled 明细，供 sync 流程 applySnapshot 使用）。
 * 注意：prices / budgets 主键为 premiseId；readings/bills/premises 主键为 id。
 */
export function mergeSnapshotDetailed(
  local: SyncSnapshot,
  remote: SyncSnapshot,
): { merged: SyncSnapshot; pulled: Partial<SyncSnapshot>; stats: MergeStats } {
  const readings = mergeEntities(local.readings, remote.readings);
  const bills = mergeEntities(local.bills, remote.bills);
  const premises = mergeEntities(local.premises, remote.premises);
  const prices = mergeEntities(local.prices, remote.prices, (p: PriceRecord) => p.premiseId);
  const budgets = mergeEntities(local.budgets, remote.budgets, (b: Budget) => b.premiseId);
  const settings = mergeSettings(local.settings, remote.settings);
  const purges = mergePurgeMarkers(local.purges ?? [], remote.purges ?? []);

  const merged: SyncSnapshot = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    readings: readings.merged,
    bills: bills.merged,
    premises: premises.merged,
    prices: prices.merged,
    budgets: budgets.merged,
    ...(settings.merged ? { settings: settings.merged } : {}),
    purges: purges.merged,
  };

  const pulled: Partial<SyncSnapshot> = {
    readings: readings.pulled,
    bills: bills.pulled,
    premises: premises.pulled,
    prices: prices.pulled,
    budgets: budgets.pulled,
    ...(settings.pulled ? { settings: settings.pulled } : {}),
    purges: purges.pulled,
  };

  // 统计只数「业务实体」，永久删除标记不计入：
  // 它们是同步协议的元数据，混进拉取/推送条数会让 UI 的「N 项改动」与用户感知对不上。
  const stats: MergeStats = {
    pulled:
      readings.pulled.length +
      bills.pulled.length +
      premises.pulled.length +
      prices.pulled.length +
      budgets.pulled.length +
      (settings.pulled ? 1 : 0),
    pushed:
      readings.pushed.length +
      bills.pushed.length +
      premises.pushed.length +
      prices.pushed.length +
      budgets.pushed.length +
      (settings.pushed ? 1 : 0),
    conflicts:
      readings.conflicts +
      bills.conflicts +
      premises.conflicts +
      prices.conflicts +
      budgets.conflicts +
      settings.conflicts,
  };

  return { merged, pulled, stats };
}

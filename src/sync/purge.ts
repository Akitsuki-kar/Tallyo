/**
 * 墓碑回收协议（0.1.2 新增）
 *
 * ## 为什么需要它
 *
 * 同步是「两侧全量快照按主键 LWW 合并」（见 sync/merge.ts）。合并规则里
 * 「本地没有、远端有」= 远端胜出，会被拉回本地。这意味着：
 *
 *   本地物理删除一条软删墓碑 → 下一轮合并发现「本地无此键、远端有墓碑」
 *   → 判定远端胜 → 墓碑被拉回本地 → 用户刚清空的回收站又长回来了。
 *
 * 换言之：**在纯全量快照同步下，删除只能靠墓碑表达，无法靠「缺席」表达**。
 * 墓碑本身也因此永远不能被物理删除——除非引入比墓碑更高一级的「我就是要抹掉它」信号。
 *
 * 本模块实现的就是这个信号：PurgeMarker。它不是实体，只是一枚极小的
 * 「已永久删除」标记（key + 时间戳），随快照在设备间传播。
 *
 * ## 四步协议
 *
 *   ① 永久删除：本地物理删除墓碑，并在 purges store 落一枚标记（trash store 的 purge 动作）。
 *   ② 剔除上传：构建待上传快照时，把「命中标记且仍是墓碑」的实体从快照里摘掉，
 *      于是远端 data.json 里这条记录真正消失。
 *   ③ 拒绝复活：合并结果的 pulled 里若出现命中标记的墓碑，直接丢弃，不写回本地。
 *   ④ 标记回收（settlePurgeMarkers）：下一轮拉取时发现远端已无该实体 → 使命完成，删标记；
 *      若本地出现了 updatedAt 晚于 purgedAt 的实体（对端在我们删除后又恢复/改动过）→ 标记作废。
 *
 * 步骤 ②③ 都只针对 **isDeleted 的墓碑**：活着的实体永远不被标记误伤。
 * 这样「A 清空回收站 / B 同时恢复了其中一条」的并发场景里，恢复一定赢。
 */
import type { Reading, Bill, Premise, PriceRecord, Budget, PurgeMarker, TrashStoreName } from '@/types';
import type { SyncSnapshot } from '@/sync/merge';
import { getDB } from '@/db/database';
import { getAllPurges, deletePurges, putPurgeBatch, purgeKeyOf } from '@/db/repositories/purgeRepo';
import { logger } from '@/utils/logger';

/** 各 store 的实体主键字段（prices / budgets 以 premiseId 为主键，与其余三者不同） */
const ID_FIELD: Record<TrashStoreName, 'id' | 'premiseId'> = {
  readings: 'id',
  bills: 'id',
  premises: 'id',
  prices: 'premiseId',
  budgets: 'premiseId',
};

export function entityKeyOf(store: TrashStoreName, entity: unknown): string {
  const field = ID_FIELD[store];
  const id = (entity as Record<string, unknown>)?.[field];
  return purgeKeyOf(store, typeof id === 'string' ? id : '');
}

/** 快照里出现过的全部实体主键（用于判断「远端是否还有这条记录」） */
export function snapshotEntityKeys(snap: SyncSnapshot): Set<string> {
  const keys = new Set<string>();
  const push = (store: TrashStoreName, list: unknown[] | undefined): void => {
    for (const e of list ?? []) keys.add(entityKeyOf(store, e));
  };
  push('readings', snap.readings);
  push('bills', snap.bills);
  push('premises', snap.premises);
  push('prices', snap.prices);
  push('budgets', snap.budgets);
  return keys;
}

/** 读某条实体的 updatedAt（不存在返回 undefined），用于判定标记是否已被更新的改动推翻 */
async function readUpdatedAt(store: TrashStoreName, id: string): Promise<string | undefined> {
  const db = await getDB();
  // store 是联合类型，idb 的泛型推导会退化成 never，此处集中做一次窄化
  const rec = (await db.get(store, id as never)) as { updatedAt?: unknown } | undefined;
  return typeof rec?.updatedAt === 'string' ? rec.updatedAt : undefined;
}

/**
 * 落地一批永久删除标记：物理删除本地对应记录，并把标记存进 purges store。
 *
 * 「只删墓碑不删活数据」的判断放在调用方（filterPurgedEntities），
 * 这里额外用 purgedAt 兜底：若本地记录的 updatedAt 晚于 purgedAt，
 * 说明对端在我们删除之后又改过这条记录，此时删除会让新数据凭空消失，必须让路。
 *
 * @returns 实际被物理删除的条数
 */
export async function applyPurgeMarkers(markers: PurgeMarker[]): Promise<number> {
  if (markers.length === 0) return 0;
  const db = await getDB();
  const keep: PurgeMarker[] = [];
  let removed = 0;
  for (const m of markers) {
    const updatedAt = await readUpdatedAt(m.store, m.id);
    if (updatedAt !== undefined && updatedAt > m.purgedAt) continue; // 被更新的改动推翻，标记作废
    if (updatedAt !== undefined) {
      await db.delete(m.store, m.id as never);
      removed++;
    }
    keep.push(m);
  }
  await putPurgeBatch(keep);
  return removed;
}

/**
 * 标记结算：回收已完成使命或已作废的标记，返回仍需生效的标记。
 *
 * 丢弃条件（任一成立即丢）：
 *   · 本地存在 updatedAt 晚于 purgedAt 的实体 —— 对端在我们删除之后又动过它，删除意图已被推翻；
 *   · 远端快照里已经查不到这个键 —— 上一轮推送已把它从远端抹掉，标记无需再保留。
 *
 * 保留条件：远端仍有该实体，说明还需要继续在上传时剔除它（通常再过一轮即可收敛）。
 *
 * @param remoteSnap 本轮拉取到的远端快照（用于「远端是否还有」的判定）
 */
export async function settlePurgeMarkers(remoteSnap: SyncSnapshot): Promise<PurgeMarker[]> {
  const markers = await getAllPurges();
  if (markers.length === 0) return [];
  const remoteKeys = snapshotEntityKeys(remoteSnap);

  const keep: PurgeMarker[] = [];
  const drop: string[] = [];
  for (const m of markers) {
    const updatedAt = await readUpdatedAt(m.store, m.id);
    if (updatedAt !== undefined && updatedAt > m.purgedAt) {
      drop.push(m.key);
      continue;
    }
    if (!remoteKeys.has(m.key)) {
      drop.push(m.key);
      continue;
    }
    keep.push(m);
  }
  if (drop.length > 0) await deletePurges(drop);
  return keep;
}

/**
 * 从待落地的合并结果里剔除「已被永久删除」的墓碑，防止它们被写回本地。
 *
 * 只剔除 isDeleted 的墓碑：活着的实体说明对端在我们删除之后又恢复了它，
 * 恢复的语义优先于删除（删错了还能再删，恢复错了数据就真没了）。
 */
export function filterPurgedEntities<T extends Partial<SyncSnapshot>>(
  pulled: T,
  markers: PurgeMarker[],
): T {
  if (markers.length === 0) return pulled;
  const keys = new Set(markers.map((m) => m.key));
  const out: T = { ...pulled };
  const drop = <E extends { isDeleted: boolean }>(list: E[] | undefined, store: TrashStoreName): E[] | undefined =>
    list?.filter((e) => !(e.isDeleted && keys.has(entityKeyOf(store, e))));

  if (out.readings) out.readings = drop<Reading>(out.readings, 'readings');
  if (out.bills) out.bills = drop<Bill>(out.bills, 'bills');
  if (out.premises) out.premises = drop<Premise>(out.premises, 'premises');
  if (out.prices) out.prices = drop<PriceRecord>(out.prices, 'prices');
  if (out.budgets) out.budgets = drop<Budget>(out.budgets, 'budgets');
  return out;
}

/**
 * 从待上传的快照里摘掉命中标记的墓碑，让远端文件里这条记录真正消失。
 * 与 filterPurgedEntities 同规则（只摘墓碑），区别仅在于作用对象是完整快照。
 *
 * 注意 purges 字段本身要原样随快照上传——标记得先让对端看见，对端才会跟着删。
 */
export function stripPurgedEntities(snap: SyncSnapshot, markers: PurgeMarker[]): SyncSnapshot {
  if (markers.length === 0) return snap;
  const filtered = filterPurgedEntities(
    {
      readings: snap.readings,
      bills: snap.bills,
      premises: snap.premises,
      prices: snap.prices,
      budgets: snap.budgets,
    },
    markers,
  );
  return {
    ...snap,
    readings: filtered.readings ?? [],
    bills: filtered.bills ?? [],
    premises: filtered.premises ?? [],
    prices: filtered.prices ?? [],
    budgets: filtered.budgets ?? [],
  };
}

/** 合并两侧标记：同键取 purgedAt 较新者（删除不可逆，取「最晚的删除意图」） */
export function mergePurgeMarkers(
  local: PurgeMarker[],
  remote: PurgeMarker[],
): { merged: PurgeMarker[]; pulled: PurgeMarker[]; pushed: PurgeMarker[] } {
  const localMap = new Map(local.map((m) => [m.key, m]));
  const remoteMap = new Map(remote.map((m) => [m.key, m]));

  const merged: PurgeMarker[] = [];
  const pulled: PurgeMarker[] = [];
  const pushed: PurgeMarker[] = [];

  for (const key of new Set([...localMap.keys(), ...remoteMap.keys()])) {
    const l = localMap.get(key);
    const r = remoteMap.get(key);
    if (l && !r) {
      merged.push(l);
      pushed.push(l);
    } else if (!l && r) {
      merged.push(r);
      pulled.push(r);
    } else if (l && r) {
      const winner = l.purgedAt >= r.purgedAt ? l : r;
      merged.push(winner);
      if (winner === r) pulled.push(r);
      else pushed.push(l);
    }
  }
  return { merged, pulled, pushed };
}

/**
 * 物理删除实体并落标记（回收站「永久删除」的底层动作）。
 *
 * 必须「先删记录、后写标记」：标记一旦存在，后续同步就会拒绝任何该键的墓碑，
 * 顺序颠倒的话，本轮要删的记录可能被自己上一轮遗留的标记挡在门外。
 *
 * 单条与批量共用一个 purgedAt，保证「一次清空回收站」在协议上是一个原子意图：
 * 对端要么全部删除，要么因更新的改动全部保留，不会删一半。
 */
export async function purgeEntities(
  entries: Array<{ store: TrashStoreName; id: string }>,
  purgedAt: string = new Date().toISOString(),
): Promise<PurgeMarker[]> {
  if (entries.length === 0) return [];
  const db = await getDB();
  const markers: PurgeMarker[] = [];
  for (const e of entries) {
    await db.delete(e.store, e.id as never);
    markers.push({ key: purgeKeyOf(e.store, e.id), store: e.store, id: e.id, purgedAt });
  }
  await putPurgeBatch(markers);
  logger.info('[SDB:purge]', '已永久删除', { count: markers.length });
  return markers;
}

/** 单条版本，语义等价于 purgeEntities([{store, id}]) */
export async function purgeEntity(
  store: TrashStoreName,
  id: string,
  purgedAt?: string,
): Promise<PurgeMarker[]> {
  return purgeEntities([{ store, id }], purgedAt);
}

/**
 * 本地快照构建与远端快照应用（同步核心 I/O 层）。
 * - buildLocalSnapshot：从各 repo 读全量（含软删墓碑，删除必须参与同步才能传播），排除 SyncConfig。
 * - parseRemoteSnapshot：结构校验，非法则抛 SDB_SYNC_REMOTE_INVALID，绝不拿损坏数据覆盖本地。
 * - applySnapshot：把远端胜出实体写回对应 repo，并刷新相关 store。
 */
import type {
  Reading,
  Bill,
  Premise,
  PriceRecord,
  Budget,
  Settings,
  PurgeMarker,
  TrashStoreName,
} from '@/types';
import type { SyncSnapshot } from '@/sync/merge';
import * as readingRepo from '@/db/repositories/readingRepo';
import * as billRepo from '@/db/repositories/billRepo';
import * as premiseRepo from '@/db/repositories/premiseRepo';
import * as priceRepo from '@/db/repositories/priceRepo';
import * as budgetRepo from '@/db/repositories/budgetRepo';
import * as kvRepo from '@/db/repositories/kvRepo';
import * as purgeRepo from '@/db/repositories/purgeRepo';
import { applyPurgeMarkers, filterPurgedEntities } from '@/sync/purge';
import { useReadingsStore } from '@/stores/readings';
import { usePremisesStore } from '@/stores/premises';
import { usePricesStore } from '@/stores/prices';
import { useBudgetsStore } from '@/stores/budgets';
import { useBillsStore } from '@/stores/bills';
import { useSettingsStore } from '@/stores/settings';
import { SdbError } from '@/sync/errors';
import { ERROR_CODES } from '@/utils/errorCodes';
import { logger } from '@/utils/logger';

const SCHEMA_VERSION = 1;
const SETTINGS_KEY = 'settings';

/** 空快照（远端不存在文件时使用） */
export function emptySnapshot(): SyncSnapshot {
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    readings: [],
    bills: [],
    premises: [],
    prices: [],
    budgets: [],
    purges: [],
  };
}

/**
 * 校验并规范化远端快照里的永久删除标记。
 * 采取「逐条过滤」而非「整份拒绝」：标记是元数据，个别字段缺失不影响业务实体，
 * 因为一条坏标记就让整份远端数据不可用、进而阻断全部同步，代价不成比例。
 */
function normalizePurges(raw: unknown): PurgeMarker[] {
  if (!Array.isArray(raw)) return [];
  const stores: TrashStoreName[] = ['readings', 'bills', 'premises', 'prices', 'budgets'];
  const out: PurgeMarker[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const o = item as Record<string, unknown>;
    const store = o.store;
    if (typeof store !== 'string' || !stores.includes(store as TrashStoreName)) continue;
    if (typeof o.id !== 'string' || o.id.length === 0) continue;
    if (typeof o.purgedAt !== 'string') continue;
    out.push({
      key: purgeRepo.purgeKeyOf(store as TrashStoreName, o.id),
      store: store as TrashStoreName,
      id: o.id,
      purgedAt: o.purgedAt,
    });
  }
  return out;
}

/** 快照构建选项（由 sync store 根据 SyncConfig 传入） */
export interface SnapshotBuildOptions {
  /** false 时本地设置不纳入快照（不同步应用设置）。默认 true。 */
  syncSettings?: boolean;
}

/** 快照应用选项（由 sync store 根据 SyncConfig 传入） */
export interface SnapshotApplyOptions {
  /** false 时远端主题不覆盖本地（每台设备各自管主题）。默认 true。 */
  syncTheme?: boolean;
  /** false 时远端设置全部不应用。默认 true。 */
  syncSettings?: boolean;
}

/**
 * 构建本地全量快照。必须包含软删墓碑（否则删除不会跨设备传播）。
 * 安全红线：绝不包含 syncConfig / passwordEnc / 加密密钥。本函数做运行时断言。
 * @param options.syncSettings false 时本地设置不纳入快照（不同步应用设置） */
export async function buildLocalSnapshot(options?: SnapshotBuildOptions): Promise<SyncSnapshot> {
  const syncSettings = options?.syncSettings !== false; // 默认 true
  const [readings, bills, premises, prices, budgets, purges] = await Promise.all([
    readingRepo.getAllReadings(),
    billRepo.getAllBills(),
    premiseRepo.getAllPremises(),
    priceRepo.getAllPrices(),
    budgetRepo.getAllBudgets(),
    purgeRepo.getAllPurges(),
  ]);
  let settings: Settings | undefined;
  if (syncSettings) {
    const settingsRec = await kvRepo.getKv<Settings>(SETTINGS_KEY);
    settings = settingsRec && !settingsRec.isDeleted ? settingsRec.value : undefined;
  }

  const snap: SyncSnapshot = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    readings,
    bills,
    premises,
    prices,
    budgets,
    ...(settings ? { settings } : {}),
    purges,
  };

  // 运行时断言：快照 JSON 中不得出现敏感字段
  const json = JSON.stringify(snap);
  if (json.includes('"syncConfig"') || json.includes('passwordEnc') || json.includes('sdb:crypto:key')) {
    throw new SdbError(ERROR_CODES.SDB_SYNC_REMOTE_INVALID, 'remote', '本地快照意外包含敏感字段');
  }
  return snap;
}

/**
 * 解析远端快照文本，做严格结构校验。
 * 解析失败 / schemaVersion 不认识 / 字段类型不对 → 抛 SDB_SYNC_REMOTE_INVALID。
 */
export function parseRemoteSnapshot(text: string): SyncSnapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SdbError(ERROR_CODES.SDB_SYNC_REMOTE_INVALID, 'remote', '远端数据不是合法 JSON');
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new SdbError(ERROR_CODES.SDB_SYNC_REMOTE_INVALID, 'remote', '远端数据格式非法');
  }
  const obj = raw as Record<string, unknown>;
  if (obj.schemaVersion !== SCHEMA_VERSION) {
    throw new SdbError(ERROR_CODES.SDB_SYNC_REMOTE_INVALID, 'remote', `不支持的 schemaVersion: ${String(obj.schemaVersion)}`);
  }
  // 绝不应用包含 syncConfig 的远端数据（即便出现也拒绝）
  if ('syncConfig' in obj) {
    throw new SdbError(ERROR_CODES.SDB_SYNC_REMOTE_INVALID, 'remote', '远端数据包含不应同步的 syncConfig');
  }
  const mustArrays = ['readings', 'bills', 'premises', 'prices', 'budgets'] as const;
  for (const k of mustArrays) {
    if (!Array.isArray((obj as Record<string, unknown>)[k])) {
      throw new SdbError(ERROR_CODES.SDB_SYNC_REMOTE_INVALID, 'remote', `字段 ${k} 不是数组`);
    }
  }
  const snap: SyncSnapshot = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : new Date().toISOString(),
    readings: obj.readings as Reading[],
    bills: obj.bills as Bill[],
    premises: obj.premises as Premise[],
    prices: obj.prices as PriceRecord[],
    budgets: obj.budgets as Budget[],
    ...(obj.settings && typeof obj.settings === 'object' ? { settings: obj.settings as Settings } : {}),
    purges: normalizePurges(obj.purges),
  };
  return snap;
}

/**
 * 把远端胜出的实体逐个写回对应 repo，并刷新相关 store。
 * @param options.syncTheme  false 时远端主题不覆盖本地（保留本地主题字段）
 * @param options.syncSettings false 时远端设置全部不应用
 * 若有 settings 被远端覆盖，走 settings store 的 applyRemoteSettings()（冻结远端 updatedAt
 * 以避免跨设备乒乓）并即时生效主题。
 */
export async function applySnapshot(
  pulled: Partial<SyncSnapshot>,
  options?: SnapshotApplyOptions,
): Promise<void> {
  const syncSettings = options?.syncSettings !== false; // 默认 true
  const syncTheme = options?.syncTheme !== false; // 默认 true

  // ── 第 0 步：先落地「永久删除标记」并据此挡住已被永久删除的墓碑 ──
  // 必须早于实体写入：合并规则里「本地无此键、远端有墓碑」= 远端胜出，
  // 若不拦截，用户刚清空回收站的记录会在这一轮被原样拉回来（详见 sync/purge.ts 头注释）。
  if ((pulled.purges?.length ?? 0) > 0) {
    await applyPurgeMarkers(pulled.purges as PurgeMarker[]);
  }
  const activePurges = await purgeRepo.getAllPurges();
  const safePulled = filterPurgedEntities(pulled, activePurges);

  const tasks: Promise<unknown>[] = [];
  for (const r of safePulled.readings ?? []) tasks.push(readingRepo.putReading(r));
  for (const b of safePulled.bills ?? []) tasks.push(billRepo.putBill(b));
  for (const p of safePulled.premises ?? []) tasks.push(premiseRepo.putPremise(p));
  for (const pr of safePulled.prices ?? []) tasks.push(priceRepo.putPrice(pr));
  for (const bg of safePulled.budgets ?? []) tasks.push(budgetRepo.putBudget(bg));
  await Promise.all(tasks);

  if (safePulled.settings && syncSettings) {
    // 走 applyRemoteSettings（冻结远端 updatedAt）而非 update()：
    // update() 会把 updatedAt 刷成当前时间，在 syncTheme=false 时造成跨设备设置无限乒乓。
    await useSettingsStore().applyRemoteSettings(safePulled.settings, syncTheme);
  }

  // 刷新相关 store，保证内存与库一致
  const readings = useReadingsStore();
  const premises = usePremisesStore();
  const prices = usePricesStore();
  const budgets = useBudgetsStore();
  const bills = useBillsStore();
  await Promise.all([readings.load(), premises.load(), prices.load(), budgets.load()]);
  await bills.load();

  // 重建读数链：合并是按实体逐个 LWW 写入的，插入的读数会让既有记录的
  // previousReading 失效（账单不受影响，但列表「用量」列读的正是这个字段）。
  if ((safePulled.readings?.length ?? 0) > 0) {
    await readings.relinkChains();
  }

  // 仅当「账单的计算输入」（读数 / 单价 / 预算）确实被远端更新时才重算。
  // 远端拉来的 bills 本身已是算好的结果，直接写库即可，无需再算一遍。
  // 这样可避免每次同步都无谓触发全量重算 —— 配合 bills.recompute 的幂等短路，
  // 共同防止「重算 → 版本自增 → 推送 → 对端重算」的跨设备同步死循环。
  // premises 必须计入：房租（rent / rentVisible）与结算方式（settlement）
  // 都是账单的计算输入，且「改了只体现在房源上」—— 若不同步重算，
  // 对端拉到新的房租配置后账单金额会一直停留在旧值，直到下一次改读数才被顺带修正。
  const needRecompute =
    (safePulled.readings?.length ?? 0) > 0 ||
    (safePulled.prices?.length ?? 0) > 0 ||
    (safePulled.budgets?.length ?? 0) > 0 ||
    (safePulled.premises?.length ?? 0) > 0;
  if (needRecompute) {
    await bills.recomputeAll();
  }

  logger.info('[SDB:sync]', '已应用远端快照', { recomputed: needRecompute });
}

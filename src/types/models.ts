// 最终 TS 类型定义
// 融合 architecture.md §3 与 §12 已确认决策 D1–D8（多房源 / 单价 / 预算 / 加密等）

// ---------- 枚举 ----------
export type ReadingType = 'electricity' | 'water';
export type ThemeMode = 'light' | 'dark' | 'auto';
export type DefaultView = 'home' | 'readings' | 'bills' | 'stats' | 'budget';
export type BillTemplateId = 'receipt' | 'minimal' | 'card' | 'report';
export type BudgetStatus = 'ok' | 'warning' | 'exceeded';
export type SyncStatus = 'idle' | 'syncing' | 'success' | 'error';

/** 预算口径：按金额(元) 或 按用量(度/吨) */
export type BudgetMode = 'amount' | 'usage';
/** 单价模式：固定单价 或 阶梯计价 */
export type PriceMode = 'flat' | 'tiered';

/**
 * 月底结算模式：
 * - full    全额结算 —— 保留完整计算结果（两位小数），与 0.1.0 行为一致
 * - integer 整额结算 —— 只收整数元，小数部分按 RoundingMode 处理
 */
export type SettlementMode = 'full' | 'integer';
/** 整额结算的取整方式：四舍五入 / 直接舍弃小数 / 不足进一（有小数即进位取整） */
export type RoundingMode = 'round' | 'floor' | 'ceil';

/** 启动自动弹快速记录的时机：关闭 / 每天首次打开 / 每次打开 */
export type QuickRecordPop = 'off' | 'daily' | 'always';

/**
 * 回收站条目的数据类别。
 * 取值直接复用 IndexedDB 的 object store 名，避免「UI 类别 → store」的映射表。
 * kv（settings / syncConfig）不进回收站：设置是单条全局记录，没有「删一条」的语义。
 */
export type TrashStoreName = 'readings' | 'bills' | 'premises' | 'prices' | 'budgets';

/** 回收站自动清理频率：关闭 / 每周 / 每月 */
export type CleanupFrequency = 'off' | 'weekly' | 'monthly';

/**
 * 永久删除标记（墓碑回收协议的载体，0.1.2 新增）。
 *
 * 为什么需要它：同步是「两侧全量快照按主键 LWW 合并」，**删除只能靠墓碑表达** ——
 * 本地把记录物理删掉后，下一轮合并看到「本地无此键、远端有墓碑」会判定为远端胜出，
 * 把墓碑重新拉回来。于是「清空回收站」在开启同步的设备上等于没删。
 *
 * 解决：永久删除不在本地留记录，而是留一枚极小的标记随快照传播，
 * 各端据此把对应墓碑从自己的库和远端快照里真正剔除（详见 src/sync/purge.ts）。
 * 标记本身在确认远端已无该实体后自动回收，不会无限增长。
 */
export interface PurgeMarker {
  /** 主键：${store}:${id}，与实体一一对应 */
  key: string;
  store: TrashStoreName;
  /** 实体主键（readings/bills/premises 为 id；prices/budgets 为 premiseId） */
  id: string;
  /** 永久删除发生的时刻（ISO）。晚于它的实体改动视为「比删除更新」，标记作废 */
  purgedAt: string;
}

// ---------- 同步元数据基类 ----------
export interface EntityBase {
  id: string; // uuid v4
  createdAt: string; // ISO 时间戳
  updatedAt: string; // ISO 时间戳
  syncVersion: number; // 每次本地变更 +1，LWW 依据
  isDeleted: boolean; // 软删（墓碑），用于同步传播删除
}

// ---------- 结算配置（0.1.1，按房源 × 按水电分别配置） ----------
/**
 * 单一能源类型的结算方式。
 * rounding 仅在 mode = 'integer' 时生效，full 模式下留值不影响计算
 * （保留字段是为了用户在 UI 上来回切换模式时不丢失已选的取整偏好）。
 */
export interface UtilitySettlement {
  mode: SettlementMode;
  rounding: RoundingMode;
}

/** 房源的结算配置：电、水各自独立（用户明确要求可分别设置） */
export interface PremiseSettlement {
  electricity: UtilitySettlement;
  water: UtilitySettlement;
}

// ---------- 房源（D1） ----------
export interface Premise extends EntityBase {
  name: string; // 房源名称，如「我的家」
  note?: string;
  /**
   * 月底结算模式（0.1.1 新增）。
   * 可选：0.1.0 及更早的房源记录、以及旧版本同步下发的快照都没有此字段，
   * 读取端一律用 defaultPremiseSettlement() 兜底为「全额结算」，保持行为不变。
   */
  settlement?: PremiseSettlement;
  /** 每月房租（元，0.1.1 新增）。0 或缺省表示不收房租 */
  rent?: number;
  /**
   * 房租是否计入账单。
   * 用户决策：勾选后房租按填写金额「全额」直接加入总额（不参与水电的结算取整）；
   * 未勾选则账单完全不体现房租。
   */
  rentVisible?: boolean;
}

// ---------- 阶梯档位（D2） ----------
export interface Tier {
  upTo: number | null; // 本档上限用量；null 表示「及以上」
  price: number; // 本档单价
}

// ---------- 单价配置（D2，按房源存于 prices store） ----------
export interface PriceConfig {
  mode: PriceMode;
  flat: { electricity: number; water: number };
  tiers: { electricity: Tier[]; water: Tier[] };
}

/** prices store 记录（keyPath = premiseId） */
export interface PriceRecord {
  premiseId: string;
  config: PriceConfig;
  updatedAt: string;
  syncVersion: number;
  isDeleted: boolean;
}

// ---------- 读数记录（D1 增加 premiseId） ----------
export interface Reading extends EntityBase {
  premiseId: string;
  type: ReadingType; // 电/水
  reading: number; // 本次读数
  previousReading: number | null; // 上次读数（本地展示/校验用）
  date: string; // 'YYYY-MM-DD'
  note?: string;
}

// ---------- 月度账单（D1：id = `${premiseId}:${yearMonth}`） ----------
export interface Bill extends EntityBase {
  id: string; // = `${premiseId}:${yearMonth}`
  premiseId: string;
  yearMonth: string; // 'YYYY-MM'
  electricityUsage: number;
  electricityCost: number; // 已按房源结算模式取整后的电费（落库即最终收费）
  waterUsage: number;
  waterCost: number; // 已按房源结算模式取整后的水费
  /** 房租快照（0.1.1 新增）：出账时房源上的 rent 值，0 表示无 */
  rent?: number;
  /** 房租是否计入 totalCost 并在模板中展示（0.1.1 新增） */
  rentVisible?: boolean;
  totalCost: number; // 电费 + 水费 (+ 房租，仅当 rentVisible)
  budgetStatus: BudgetStatus; // 由 budget store 计算回写（D8）
  generatedAt: string;
}

// ---------- 预算设置（D3，按房源存于 budgets store） ----------
export interface Budget extends EntityBase {
  premiseId: string;
  mode: BudgetMode; // 'amount' | 'usage'
  electricityLimit: number; // 电费限额 或 用电限额（随 mode 变化）
  waterLimit: number;
}

// ---------- 应用设置（全局；不含 unitPrice，D2 已移出） ----------
export interface Settings {
  theme: ThemeMode;
  /**
   * @deprecated 0.1.1 起改用 quickRecordPop（支持「每天首次 / 每次打开」两档）。
   * 仍保留字段：① 读取本机旧数据时迁移；② 旧版本设备同步下发的快照里只有这个字段。
   * 迁移规则见 stores/settings.ts 的 normalizeQuickRecordPop()。
   */
  autoPopQuickRecord?: boolean;
  /** 启动自动弹快速记录的时机（0.1.1 新增） */
  quickRecordPop: QuickRecordPop;
  /** 每月 1 号自动弹出上月结算账单（含打印特效，0.1.1 新增） */
  autoMonthlyBill: boolean;
  defaultView: DefaultView;
  templateId: BillTemplateId; // 默认账单模板
  updatedAt: string;
  autoBackupEnabled?: boolean; // 是否启用每周自动备份到 WebDAV（体验⑬）
  lastAutoBackupAt?: string; // 上次自动备份时间（ISO），用于判断是否已过 7 天
  keyBackupAt?: string; // 上次导出/上传设备密钥备份的时间（ISO），体验⑭的元数据，不含密钥本身
  /** 回收站自动清理频率（0.1.2 新增）。缺省 'off'：清理会删数据，必须用户显式开启 */
  trashAutoClean?: CleanupFrequency;
  /**
   * 墓碑保留天数（0.1.2 新增）：软删记录超过该天数后，自清理会将其永久删除。
   * 缺省 30 天——足够覆盖「误删后过个周末才发现」的场景，又不至于无限堆积。
   */
  trashRetentionDays?: number;
  /** 上次执行数据自清理的时间（ISO），用于判断周清 / 月清是否到期 */
  lastCleanedAt?: string;
}

// ---------- WebDAV 同步配置（Phase 3 使用，先定义类型） ----------
export interface SyncConfig {
  url: string; // 如 https://dav.example.com
  username: string;
  passwordEnc: string; // AES-256-GCM 密文（base64: iv|ciphertext）
  enabled: boolean;
  /** 是否同步主题（light/dark）。false 时远端主题不覆盖本地，适合每台设备各自管主题。 */
  syncTheme: boolean;
  /** 是否同步应用设置（自动弹窗/默认视图/账单模板）。false 时不同步任何设置。 */
  syncSettings: boolean;
  lastSyncAt?: string;
}

// ---------- KV 通用记录（settings / syncConfig 单条） ----------
export interface KvRecord<T = unknown> {
  key: string;
  value: T;
  updatedAt: string;
  syncVersion: number;
  isDeleted: boolean;
}

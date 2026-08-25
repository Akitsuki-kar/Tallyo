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

// ---------- 同步元数据基类 ----------
export interface EntityBase {
  id: string; // uuid v4
  createdAt: string; // ISO 时间戳
  updatedAt: string; // ISO 时间戳
  syncVersion: number; // 每次本地变更 +1，LWW 依据
  isDeleted: boolean; // 软删（墓碑），用于同步传播删除
}

// ---------- 房源（D1） ----------
export interface Premise extends EntityBase {
  name: string; // 房源名称，如「我的家」
  note?: string;
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
  electricityCost: number;
  waterUsage: number;
  waterCost: number;
  totalCost: number;
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
  autoPopQuickRecord: boolean; // 启动是否自动弹快速记录
  defaultView: DefaultView;
  templateId: BillTemplateId; // 默认账单模板
  updatedAt: string;
  autoBackupEnabled?: boolean; // 是否启用每周自动备份到 WebDAV（体验⑬）
  lastAutoBackupAt?: string; // 上次自动备份时间（ISO），用于判断是否已过 7 天
  keyBackupAt?: string; // 上次导出/上传设备密钥备份的时间（ISO），体验⑭的元数据，不含密钥本身
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

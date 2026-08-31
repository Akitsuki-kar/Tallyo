/**
 * 数据自清洗的判定逻辑（纯函数、零运行期依赖，可脱离浏览器单测）
 *
 * 只做「哪些数据有问题 / 该处理谁」的判断，不碰 IndexedDB —— 落库动作全部在
 * stores/trash.ts 里编排，这样每条规则都能被 scripts/test-pure-functions.ts 直接断言。
 *
 * 设计取向：**能自愈的才自动改，判断不了的只报告不动手**。
 * 自清洗会永久删除数据，宁可少删一条，也不能把用户还没想清楚的记录当成垃圾清掉。
 */
import type { Bill, Reading, CleanupFrequency } from '@/types';
import { monthKeyFromDate } from '@/utils/dayjs';

/** 墓碑默认保留天数：误删后过一个周末才发现也还来得及救 */
export const DEFAULT_RETENTION_DAYS = 30;
/** 可选的保留期档位（UI 分段控件） */
export const RETENTION_OPTIONS = [7, 30, 90, 180] as const;
/** 每周 / 每月自动清理的间隔天数 */
const FREQ_DAYS: Record<Exclude<CleanupFrequency, 'off'>, number> = { weekly: 7, monthly: 30 };

/** (房源, 月份) 的唯一键：\u0000 分隔，防 id 内含冒号/连字符时碰撞 */
export function billGroupKeyOf(premiseId: string, yearMonth: string): string {
  return `${premiseId}\u0000${yearMonth}`;
}

/**
 * 一房一月只应存在一张账单。同一 (premiseId, yearMonth) 下出现多条未删除账单即为重复。
 *
 * 正常路径下不会发生——账单主键是 `${premiseId}:${yearMonth}`，IndexedDB 天然去重。
 * 真正的来源是**外部数据**：导入的 JSON 备份里可能带着手工改过 id 的账单，
 * 或老版本客户端算出来过不同格式的 id。导入走的是逐实体 LWW 写入，不做唯一性校验，
 * 于是同一个月就在库里躺了两张账单，金额还可能对不上。
 */
export interface DuplicateBillGroup {
  premiseId: string;
  yearMonth: string;
  /** 保留者：改动时间最新的那张 */
  keep: Bill;
  /** 待墓碑的重复项（保留后剩下的全部） */
  drop: Bill[];
}

/**
 * 「哪张更新」的比较器：updatedAt → syncVersion → createdAt → id 逐级兜底。
 *
 * 用户要的是「保留新的」，而 updatedAt 是唯一能表达「用户最后一次动过它」的字段；
 * 后面几级只是为了保证排序稳定——否则同秒写入的两张账单谁被删取决于数组顺序，
 * 一次清理跑两遍可能删掉不同的那张，结果不可复现。
 */
export function compareBillRecency(a: Bill, b: Bill): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
  if (a.syncVersion !== b.syncVersion) return b.syncVersion - a.syncVersion;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? 1 : -1;
}

export function findDuplicateBillGroups(bills: Bill[]): DuplicateBillGroup[] {
  const groups = new Map<string, Bill[]>();
  for (const b of bills) {
    if (b.isDeleted) continue; // 已是墓碑的不参与去重，避免重复墓碑它
    const key = billGroupKeyOf(b.premiseId, b.yearMonth);
    const list = groups.get(key);
    if (list) list.push(b);
    else groups.set(key, [b]);
  }
  const out: DuplicateBillGroup[] = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const sorted = [...list].sort(compareBillRecency);
    const [premiseId, yearMonth] = key.split('\u0000');
    out.push({ premiseId, yearMonth, keep: sorted[0], drop: sorted.slice(1) });
  }
  // 输出按月份升序，让清理报告与用户的时间直觉一致
  return out.sort((a, b) => (a.yearMonth + a.premiseId < b.yearMonth + b.premiseId ? -1 : 1));
}

/**
 * 孤儿账单：所在月份已经没有任何有效读数，且金额为 0 的账单。
 *
 * 典型成因是「把某月的读数全删了」——账单不会跟着消失，会以一个全 0 的空壳留在库里，
 * 在统计页和账单列表里占位，用户还以为是笔真账。
 *
 * 两条安全阀：
 *   · 金额必须为 0：有房租（rentVisible + rent > 0）的月份即便没抄表也确实该出账，不能删；
 *   · 房源必须还在：房源被软删时其读数与账单按设计是保留的（删房源 ≠ 删账本），
 *     此时账单看起来「无读数」，但用户恢复房源后它就得原样回来。
 */
export function findOrphanBills(
  bills: Bill[],
  readings: Reading[],
  activePremiseIds: Set<string>,
): Bill[] {
  const monthsWithReadings = new Set<string>();
  for (const r of readings) {
    if (r.isDeleted) continue;
    monthsWithReadings.add(billGroupKeyOf(r.premiseId, monthKeyFromDate(r.date)));
  }
  return bills.filter(
    (b) =>
      !b.isDeleted &&
      activePremiseIds.has(b.premiseId) &&
      b.totalCost === 0 &&
      // 租金安全阀：有房租（rentVisible + rent > 0）的月份即便没抄表也确实该出账，
      // 不能当空壳删。常态下 rent 已计入 totalCost（>0）被上一条件挡住；这里再显式兜底，
      // 防止某次重算异常把带租账单算成 totalCost=0 时，被误当成垃圾清掉。
      // 注：rent 为可选字段（number | undefined），用 ?? 0 兜底空值，否则 vue-tsc 报 possibly-undefined。
      !(b.rentVisible && (b.rent ?? 0) > 0) &&
      !monthsWithReadings.has(billGroupKeyOf(b.premiseId, b.yearMonth)),
  );
}

/**
 * 房源孤儿记录：premiseId 为空串，或指向库里根本不存在的房源。
 *
 * 与 findOrphanBills 的区别：findOrphanBills 只在「活跃房源集合」内判断某张账单是否成了空壳；
 * 这里的记录连归属的房源实体都没有（空串 / 悬空引用），在任何 UI 里都显示不出来、也编辑不了，
 * 是彻底的脏数据。典型成因是录入时未选中房源就保存了读数，账单生成又顺带为这个不存在的房源
 * 造出一张全 0 的影子账单（见 2026-08-31 导出快照里的 `aab9bb74` 读数与 `:2026-07` 账单）。
 *
 * 判定基准用**全量**房源集合（含软删）：删除房源时其读数/账单按设计是保留的（删房源 ≠ 删账本），
 * 那些记录的 premiseId 仍指向一个「存在但已软删」的房源，不算孤儿，不能清；
 * 只有 premiseId 为空串，或在全量集合里都查不到，才算孤儿。
 *
 * 只挑活数据（isDeleted=false）：已是墓碑的走过期清理流程，不在此重复处理。
 */
export function findOrphanPremiseRecords<T extends { premiseId: string; isDeleted: boolean }>(
  items: T[],
  allPremiseIds: Set<string>,
): T[] {
  return items.filter(
    (it) => !it.isDeleted && (!it.premiseId || !allPremiseIds.has(it.premiseId)),
  );
}

/** 距某时刻过去了多少天（不足一天按 0 计，向上取整会对刚删的记录过于激进） */
export function daysSince(iso: string, now: Date): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY; // 时间戳损坏 → 视为已过期，交给清理处理
  return Math.floor((now.getTime() - t) / 86_400_000);
}

/**
 * 筛出「墓碑且超过保留期」的记录，即可被永久删除的部分。
 *
 * 只认 isDeleted：活数据无论多久都不动。时间基准取 updatedAt 而非 createdAt，
 * 因为「删除」这个动作发生的时刻才是保留期该开始计时的点。
 */
export function findExpiredTombstones<T extends { isDeleted: boolean; updatedAt: string }>(
  items: T[],
  retentionDays: number,
  now: Date,
): T[] {
  const days = Number.isFinite(retentionDays) && retentionDays > 0 ? retentionDays : DEFAULT_RETENTION_DAYS;
  return items.filter((it) => it.isDeleted && daysSince(it.updatedAt, now) >= days);
}

/** 判断周清 / 月清是否到期（'off' 或从未清理过按「到期」处理——从未清理过确实该清一次） */
export function isCleanupDue(
  lastCleanedAt: string | undefined,
  frequency: CleanupFrequency,
  now: Date,
): boolean {
  if (frequency === 'off') return false;
  if (!lastCleanedAt) return true;
  const elapsed = Date.parse(lastCleanedAt);
  if (Number.isNaN(elapsed)) return true; // 时间戳损坏 → 宁可多跑一次，也别让清理永久停摆
  return now.getTime() - elapsed >= FREQ_DAYS[frequency] * 86_400_000;
}

/**
 * 账单用量计算（纯函数、零运行期依赖，仅依赖类型与 readingChain / dayjs）
 *
 * 用途：把「某房源某类型某月」的累计读数折算成正确的月度净用量，
 * 供 bills store 的 recompute 调用，并可脱离运行环境单独单元测试。
 */
import type { Reading, ReadingType } from '@/types';
import { findPreviousReading } from '@/utils/readingChain';
import { monthKeyFromDate, daysInMonth } from '@/utils/dayjs';
import { round2 } from '@/utils/format';

/** 升序比较（与 readingChain.compareReadingOrder 保持一致） */
function asc(a: Reading, b: Reading): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return 0;
}

/** 取某房源某类型某月（YYYY-MM）的全部未软删读数，按 (date, createdAt) 升序 */
export function monthReadings(
  readings: Reading[],
  premiseId: string,
  type: ReadingType,
  yearMonth: string,
): Reading[] {
  return readings
    .filter(
      (r) =>
        !r.isDeleted &&
        r.premiseId === premiseId &&
        r.type === type &&
        monthKeyFromDate(r.date) === yearMonth,
    )
    .sort(asc);
}

/**
 * 计算某房源某类型某月的「正确净用量」。
 *
 * 读数表存的是累计读数，月度用量 = 月末读数 − 月初读数（净额）。
 * 月初读数 = 该月首条读数之前、date 严格早于它的那条读数（即上月的最后一条）。
 * 因此无论月内录了 1 条还是 N 条，结果都等于该月净消耗，不会少计。
 *
 * - 月内无读数 → 0
 * - 该月首条即历史首条（无更早基准）→ 退化为「本月首条 → 本月末条」的净额（见 resolveBaseline）
 * - 净额为负（如表复位 / 录入倒退）→ 钳为 0，账单用量不应为负
 */
export function monthlyUsage(
  readings: Reading[],
  premiseId: string,
  type: ReadingType,
  yearMonth: string,
): number {
  const inMonth = monthReadings(readings, premiseId, type, yearMonth);
  if (inMonth.length === 0) return 0;
  const last = inMonth[inMonth.length - 1];
  const baseline = resolveBaseline(readings, premiseId, type, inMonth);
  return Math.max(0, last.reading - baseline.reading);
}

/**
 * 取某月的计费基准：优先取「本月首条之前」的那条读数。
 *
 * 无更早读数时（首次抄表就落在本月，典型如用户从本月才开始用）退化为**本月首条自身**：
 * · 旧行为是整月记 0 —— 于是首月账单永远是 ¥0，且此后无论怎么改首月读数都纹丝不动，
 *   用户会认为「改读数不触发账单重算」（这正是 0.1.1 反馈的核心现象）；
 * · 退化为首条自身后，月内已抄到的那一段（首条 → 末条）能正常计入，
 *   月初到首次抄表之间那一段确实无从推算，如实记 0 即可；
 * · 月内只有一条读数时 last === baseline，结果仍是 0，与旧行为一致，不会凭空造量。
 */
function resolveBaseline(
  readings: Reading[],
  premiseId: string,
  type: ReadingType,
  inMonth: Reading[],
): Reading {
  return findPreviousReading(readings, premiseId, type, inMonth[0].date) ?? inMonth[0];
}

// ==================== 日维度统计（0.1.1 新增） ====================

/** 由 'YYYY-MM-DD' 取「日」，避免为这点小事引入 dayjs 解析开销 */
function dayOfMonth(dateStr: string): number {
  return Number(dateStr.slice(8, 10));
}

/**
 * 某房源某类型在指定月份的「逐日用量」序列，索引 0 对应该月 1 号。
 *
 * 抄表天然是稀疏的（用户可能三五天才录一次），要画「每天」曲线就必须把
 * 两次抄表之间的增量摊到区间内的每一天 —— 这也是水电行业推算日均耗量的通行做法。
 *
 * 口径与账单严格对齐：
 * · 首个区间（上月末基准 → 当月首条读数）的增量**整体归本月**，
 *   摊在「1 号 ~ 首条读数日」之间，因此 sum(series) === monthlyUsage，
 *   不会出现「日统计加起来跟账单对不上」的割裂感；
 * · 无更早基准时与 monthlyUsage 同样退化为「本月首条 → 末条」，
 *   首次抄表日之前的日子记 0（无法推算，不猜）；
 * · 单区间增量为负（表复位 / 录错）钳为 0；
 * · 最后一条读数之后的日子记 0（还没抄表，不臆造数据）。
 *
 * 注意：逐日结果保留两位小数，累加后与 monthlyUsage 可能有不足 1 分/1 厘的舍入差，
 * 属于展示层可接受范围，账单金额一律以 monthlyUsage 为准。
 */
export function dailyUsageSeries(
  readings: Reading[],
  premiseId: string,
  type: ReadingType,
  yearMonth: string,
): number[] {
  const total = daysInMonth(yearMonth);
  const series = new Array<number>(total).fill(0);

  const inMonth = monthReadings(readings, premiseId, type, yearMonth);
  if (inMonth.length === 0) return series;
  const baseline = resolveBaseline(readings, premiseId, type, inMonth);

  let prevValue = baseline.reading;
  let prevDay = 0; // 已分配到的「日」，0 表示月初之前（即首个区间从 1 号起算）
  for (const r of inMonth) {
    const day = Math.min(Math.max(dayOfMonth(r.date), 1), total);
    const delta = Math.max(0, r.reading - prevValue);
    const span = day - prevDay;
    if (delta > 0) {
      if (span > 0) {
        // 均摊到 (prevDay, day] 这 span 天
        const per = delta / span;
        for (let d = prevDay + 1; d <= day; d++) series[d - 1] += per;
      } else {
        // 同一天录了多条读数：span=0，增量全部计在当天，不能丢
        series[day - 1] += delta;
      }
    }
    prevValue = r.reading;
    prevDay = Math.max(prevDay, day);
  }
  return series.map((v) => round2(v));
}

/** 日维度统计的单日数据点 */
export interface DailyStatsPoint {
  date: string; // YYYY-MM-DD
  day: number; // 1..31
  electricity: number; // 当日用电（度）
  water: number; // 当日用水（吨）
  hasReading: boolean; // 当天是否有实际抄表记录（电或水任一）
  /** 相对前一天的涨幅，小数形式（0.25 = +25%）；无法计算时为 null */
  electricityGrowth: number | null;
  waterGrowth: number | null;
}

/**
 * 涨幅：(今日 − 昨日) / 昨日。
 * 昨日为 0 时涨幅在数学上无定义 —— 今日也是 0 则视为「持平(0)」，
 * 今日有量则返回 null 交给 UI 显示「—」，绝不返回 Infinity 去污染图表刻度。
 */
function growthRate(current: number, previous: number | undefined): number | null {
  if (previous === undefined) return null; // 月初第一天没有「前一天」
  if (previous <= 0) return current > 0 ? null : 0;
  return Math.round(((current - previous) / previous) * 10000) / 10000;
}

/**
 * 某房源某月的逐日统计（用量 + 日环比涨幅），供 Stats 页「每日」视图使用。
 * 纯函数：只依赖读数数组，费用换算交给调用方（按账单总额比例分摊，
 * 这样阶梯计价下也不会出现「日费用加总 ≠ 月账单」）。
 */
export function dailyStats(
  readings: Reading[],
  premiseId: string,
  yearMonth: string,
): DailyStatsPoint[] {
  const ele = dailyUsageSeries(readings, premiseId, 'electricity', yearMonth);
  const water = dailyUsageSeries(readings, premiseId, 'water', yearMonth);

  // 当月实际有抄表的日期集合（两种类型合并）
  const readingDays = new Set<number>();
  for (const r of readings) {
    if (r.isDeleted || r.premiseId !== premiseId) continue;
    if (monthKeyFromDate(r.date) !== yearMonth) continue;
    readingDays.add(dayOfMonth(r.date));
  }

  return ele.map((eleValue, i) => {
    const day = i + 1;
    return {
      date: `${yearMonth}-${String(day).padStart(2, '0')}`,
      day,
      electricity: eleValue,
      water: water[i],
      hasReading: readingDays.has(day),
      electricityGrowth: growthRate(eleValue, i > 0 ? ele[i - 1] : undefined),
      waterGrowth: growthRate(water[i], i > 0 ? water[i - 1] : undefined),
    };
  });
}

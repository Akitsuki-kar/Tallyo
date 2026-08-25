/**
 * 账单用量计算（纯函数、零运行期依赖，仅依赖类型与 readingChain / dayjs）
 *
 * 用途：把「某房源某类型某月」的累计读数折算成正确的月度净用量，
 * 供 bills store 的 recompute 调用，并可脱离运行环境单独单元测试。
 */
import type { Reading, ReadingType } from '@/types';
import { findPreviousReading } from '@/utils/readingChain';
import { monthKeyFromDate } from '@/utils/dayjs';

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
 * - 该月首条即历史首条（无更早基准）→ 0（无法推算，与旧行为一致）
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
  const baseline = findPreviousReading(readings, premiseId, type, inMonth[0].date);
  return baseline ? Math.max(0, last.reading - baseline.reading) : 0;
}

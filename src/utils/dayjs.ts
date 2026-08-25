/**
 * 日期工具（architecture.md §9 依赖 dayjs）
 */
import dayjs from 'dayjs';

export { dayjs };

/** 月份键 YYYY-MM */
export function monthKey(date: Date | string = new Date()): string {
  return dayjs(date).format('YYYY-MM');
}

/** 日期键 YYYY-MM-DD */
export function dateKey(date: Date | string = new Date()): string {
  return dayjs(date).format('YYYY-MM-DD');
}

/** 友好展示：YYYY年MM月 */
export function formatMonthLabel(key: string): string {
  const d = dayjs(key, 'YYYY-MM');
  return d.isValid() ? d.format('YYYY年MM月') : key;
}

/** 由 YYYY-MM-DD 取月份键 YYYY-MM */
export function monthKeyFromDate(dateKeyStr: string): string {
  return dayjs(dateKeyStr, 'YYYY-MM-DD').format('YYYY-MM');
}

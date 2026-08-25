/**
 * 数值与货币格式化（architecture.md §10，仅数值格式化）
 * 涨红跌绿等色彩语义交由 UI 层处理。
 */
const numberFmt = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });

/** 格式化普通数值（带千分位，最多 2 位小数） */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '-';
  return numberFmt.format(value);
}

/** 格式化为人民币金额：¥1,234.50 */
export function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) return '-';
  return `¥${numberFmt.format(value)}`;
}

/** 格式化为百分比：85% */
export function formatPercent(ratio: number): string {
  if (!Number.isFinite(ratio)) return '-';
  return `${(ratio * 100).toFixed(0)}%`;
}

/** 保留 2 位小数的安全四舍五入（规避浮点误差） */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

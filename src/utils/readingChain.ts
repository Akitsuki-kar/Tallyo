/**
 * 读数链工具（纯函数、零依赖）
 *
 * 仅依赖 @/types 的类型注解（import type，编译期擦除），
 * 不引入任何 store / Vue / dayjs，便于脱离运行环境独立编译与单元测试。
 *
 * 用途：
 *  - findPreviousReading：取「同房源同类型、date 严格早于目标」的最近一条记录。
 *  - relinkChain：按 (date, createdAt) 升序重建整条链的 previousReading。
 */
import type { Reading, ReadingType } from '@/types';

/**
 * 比较两个读数的先后次序：先按 date 升序，date 相同则按 createdAt 升序。
 * 返回负数表示 a 在前，正数表示 b 在前，0 表示并列。
 */
function compareReadingOrder(a: Reading, b: Reading): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return 0;
}

/**
 * 查找 date 严格早于 targetDate 的最近一条读数（同房源同类型，跳过 isDeleted）。
 *
 * 语义：在「同房源同类型、未软删」记录中，取 (date, createdAt) 次序上
 * 严格早于目标的最近一条；找不到（目标即链首）则返回 undefined。
 * 说明：date 相同视为并列 / 非先前，交由 relinkChain 以链序统一校准，
 * 因此本函数对「同日期补录」亦安全（relinkChain 会修正最终结果）。
 *
 * @param items      全部读数（会跳过 isDeleted）
 * @param premiseId  房源 ID
 * @param type       读数类型
 * @param targetDate 目标日期 'YYYY-MM-DD'
 * @param excludeId  排除的记录 ID（通常为当前记录自身，避免命中自己）
 */
export function findPreviousReading(
  items: Reading[],
  premiseId: string,
  type: ReadingType,
  targetDate: string,
  excludeId?: string,
): Reading | undefined {
  let best: Reading | undefined;
  for (const r of items) {
    if (r.isDeleted) continue;
    if (r.premiseId !== premiseId) continue;
    if (r.type !== type) continue;
    if (excludeId && r.id === excludeId) continue;
    // 仅取 date 严格早于目标日期者
    if (!(r.date < targetDate)) continue;
    if (!best || compareReadingOrder(best, r) < 0) {
      best = r;
    }
  }
  return best;
}

/**
 * 按 (date, createdAt) 升序重建整条链的 previousReading。
 *
 * 规则：链中第 i 条记录取第 i-1 条记录的 reading；首条记录 previousReading 为 null。
 * 所有记录均跳过 isDeleted。
 *
 * @returns 仅返回 previousReading 实际发生变化的记录（值未变的不返回），
 *          每个返回对象是带新 previousReading 的副本，不会原地修改入参。
 */
export function relinkChain(items: Reading[], premiseId: string, type: ReadingType): Reading[] {
  const chain = items
    .filter((r) => !r.isDeleted && r.premiseId === premiseId && r.type === type)
    .slice()
    .sort(compareReadingOrder);

  const changed: Reading[] = [];
  for (let i = 0; i < chain.length; i++) {
    const current = chain[i];
    const prevReading = i === 0 ? null : chain[i - 1].reading;
    if (current.previousReading !== prevReading) {
      changed.push({ ...current, previousReading: prevReading });
    }
  }
  return changed;
}

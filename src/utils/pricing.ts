/**
 * 单价计费纯函数（与 UI 解耦，architecture.md §3 / D2）
 */
import type { PriceConfig, Tier, ReadingType } from '@/types';
import { round2 } from './format';

/**
 * 档位上限排序键：null（「及以上」）视为 +∞ 排最后。
 * 非有限值 / 负数的脏数据统一排到末尾，由下方过滤逻辑丢弃，不参与计费。
 */
function tierUpperBound(tier: Tier): number {
  if (tier.upTo == null) return Number.POSITIVE_INFINITY;
  const n = Number(tier.upTo);
  return Number.isFinite(n) && n >= 0 ? n : Number.POSITIVE_INFINITY;
}

/**
 * 阶梯计价：将用量在各档位间分摊计算费用。
 * 末档 upTo=null 表示「及以上」。
 *
 * 入参顺序不敏感：内部先按 upTo 升序归一化（null 排最后）再分摊。
 * 必要性——单价面板允许在任意位置插入档位、任意修改上限，用户填出的顺序**不保证升序**；
 * 若按原序遍历，乱序档位会因 range<=0 被静默跳过，或首个 null 档直接吃掉全部用量，
 * 得出一份「看起来正常但金额不对」的账单。归一化同时修复了历史脏数据的计算。
 */
export function calcTieredCost(usage: number, tiers: Tier[]): number {
  if (!Number.isFinite(usage) || usage <= 0 || tiers.length === 0) return 0;

  const ordered = tiers
    .filter((t) => Number.isFinite(t.price) && tierUpperBound(t) > 0)
    .slice()
    .sort((a, b) => tierUpperBound(a) - tierUpperBound(b));

  let remaining = usage;
  let prevUpTo = 0;
  let cost = 0;
  for (const tier of ordered) {
    const upTo = tierUpperBound(tier);
    const range = upTo - prevUpTo;
    if (range <= 0) continue;
    const inTier = Math.min(remaining, range);
    cost += inTier * tier.price;
    remaining -= inTier;
    prevUpTo = upTo;
    if (remaining <= 0) break;
  }
  return round2(cost);
}

/**
 * 根据单价配置计算某类型用量的费用（纯函数）。
 */
export function calcCost(type: ReadingType, usage: number, price: PriceConfig): number {
  if (usage <= 0) return 0;
  if (price.mode === 'flat') {
    const unit = type === 'electricity' ? price.flat.electricity : price.flat.water;
    return round2(usage * unit);
  }
  const tiers = type === 'electricity' ? price.tiers.electricity : price.tiers.water;
  return calcTieredCost(usage, tiers);
}

/**
 * 默认单价配置：固定单价（电 0.56 元/度，水 3.5 元/吨），
 * 同时附一套阶梯示例，供用户切换参考。
 */
export function defaultPriceConfig(): PriceConfig {
  return {
    mode: 'flat',
    flat: { electricity: 0.56, water: 3.5 },
    tiers: {
      electricity: [
        { upTo: 216, price: 0.56 },
        { upTo: 480, price: 0.61 },
        { upTo: null, price: 0.86 },
      ],
      water: [
        { upTo: 180, price: 3.5 },
        { upTo: null, price: 4.8 },
      ],
    },
  };
}

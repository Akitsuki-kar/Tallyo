/**
 * 单价计费纯函数（与 UI 解耦，architecture.md §3 / D2）
 */
import type { PriceConfig, Tier, ReadingType } from '@/types';
import { round2 } from './format';

/**
 * 阶梯计价：将用量在各档位间分摊计算费用。
 * tiers 按 upTo 升序；末档 upTo=null 表示「及以上」。
 */
export function calcTieredCost(usage: number, tiers: Tier[]): number {
  if (usage <= 0 || tiers.length === 0) return 0;
  let remaining = usage;
  let prevUpTo = 0;
  let cost = 0;
  for (const tier of tiers) {
    const upTo = tier.upTo == null ? Number.POSITIVE_INFINITY : tier.upTo;
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

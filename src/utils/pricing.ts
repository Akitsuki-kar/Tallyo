/**
 * 单价计费纯函数（与 UI 解耦，architecture.md §3 / D2）
 */
import type {
  PriceConfig,
  Tier,
  ReadingType,
  UtilitySettlement,
  PremiseSettlement,
} from '@/types';
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
 * 应用月底结算模式：把「完整计算结果」折算成房东实际收取的金额（纯函数）。
 *
 * - full（全额结算）：保留两位小数，与 0.1.0 行为完全一致
 * - integer（整额结算）：只收整数元
 *     · round 四舍五入：28.6 → 29，28.4 → 28
 *     · floor 直接舍弃：28.9 → 28
 *     · ceil  不足进一：有小数即进位，13.4 → 14，13.1 → 14，13.6 → 14
 *
 * 缺省（settlement 为 undefined，即旧房源记录）按 full 处理，保证历史账单重算后金额不变。
 * 注意 floor 下不足 1 元会归零（0.4 → 0），这是「直接舍弃小数」的题中之义；ceil 则恒向上取整。
 */
export function applySettlement(cost: number, settlement?: UtilitySettlement): number {
  if (!Number.isFinite(cost) || cost <= 0) return 0;
  if (!settlement || settlement.mode !== 'integer') return round2(cost);
  // 三种取整：floor 直接舍弃小数、ceil 不足进一（有小数即进位）、round 四舍五入
  if (settlement.rounding === 'floor') return Math.floor(cost);
  if (settlement.rounding === 'ceil') return Math.ceil(cost);
  return Math.round(cost);
}

/**
 * 默认结算配置：电、水均为全额结算（与 0.1.0 行为一致）。
 * rounding 预置 'round'，让用户切到整额结算时有个合理默认值。
 */
export function defaultPremiseSettlement(): PremiseSettlement {
  return {
    electricity: { mode: 'full', rounding: 'round' },
    water: { mode: 'full', rounding: 'round' },
  };
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

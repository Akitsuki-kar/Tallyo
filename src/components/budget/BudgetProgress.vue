<script setup lang="ts">
/**
 * 预算进度圆环（手作美学）
 *
 * 用 SVG 圆环可视化当月用量/费用相对预算上限的使用率：
 * - < 80%  → 暖绿（--sdb-success），正常区间
 * - 80-100% → 暖橘（--sdb-warning），接近上限
 * - > 100% → 暖红（--sdb-danger），已超预算（环满圆 + 脉冲提示）
 *
 * 中心用手写体大数字显示实际值，下方显示上限与百分比。
 * 严格使用 --sdb-* token，无硬编码颜色。
 */
import { computed } from 'vue';
import { formatNumber, formatCurrency, formatPercent } from '@/utils/format';

const props = defineProps<{
  /** 实际用量（度/吨）或实际费用（元） */
  actual: number;
  /** 预算上限 */
  limit: number;
  /** 维度标签（如「电费」「水费」） */
  label: string;
  /** 单位文案（如「元」「度」「吨」） */
  unit: string;
  /** 是否为金额口径（true 用 ¥ 格式化，false 用数值格式化） */
  isAmount?: boolean;
}>();

/** 使用率（limit=0 时返回 0，避免除零） */
const ratio = computed(() => (props.limit > 0 ? props.actual / props.limit : 0));

/** 圆环视觉填充率，溢出截断到 1（满圆） */
const visualRatio = computed(() => Math.min(ratio.value, 1));

/** SVG 圆环参数 */
const RADIUS = 56;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const strokeOffset = computed(() => CIRCUMFERENCE * (1 - visualRatio.value));

/** 颜色分级 */
type Level = 'ok' | 'warning' | 'exceeded';
const level = computed<Level>(() => {
  if (ratio.value >= 1) return 'exceeded';
  if (ratio.value >= 0.8) return 'warning';
  return 'ok';
});

/** 动态 CSS 变量映射到对应语义色（在 style 中绑定） */
const ringColor = computed(() => {
  switch (level.value) {
    case 'exceeded': return 'var(--sdb-danger)';
    case 'warning': return 'var(--sdb-warning)';
    default: return 'var(--sdb-success)';
  }
});

/** 格式化实际值 */
const actualText = computed(() =>
  props.isAmount ? formatCurrency(props.actual) : formatNumber(props.actual),
);

/** 格式化上限值 */
const limitText = computed(() =>
  props.isAmount ? formatCurrency(props.limit) : `${formatNumber(props.limit)} ${props.unit}`,
);
</script>

<template>
  <div class="budget-progress" :class="`is-${level}`">
    <!-- SVG 圆环 -->
    <svg class="budget-progress__ring" viewBox="0 0 140 140" aria-hidden="true">
      <!-- 底环（淡色轨道） -->
      <circle
        class="budget-progress__track"
        cx="70"
        cy="70"
        :r="RADIUS"
        fill="none"
        stroke-width="10"
      />
      <!-- 进度环 -->
      <circle
        class="budget-progress__bar"
        cx="70"
        cy="70"
        :r="RADIUS"
        fill="none"
        stroke-width="10"
        stroke-linecap="round"
        :stroke-dasharray="CIRCUMFERENCE"
        :stroke-dashoffset="strokeOffset"
        :style="{ stroke: ringColor }"
      />
    </svg>
    <!-- 中心数字（手写体） -->
    <div class="budget-progress__center">
      <span class="budget-progress__actual">{{ actualText }}</span>
      <span class="budget-progress__unit">{{ unit }}</span>
    </div>
    <!-- 下方标签 + 百分比 -->
    <div class="budget-progress__footer">
      <span class="budget-progress__label">{{ label }}</span>
      <span class="budget-progress__pct">{{ formatPercent(ratio) }}</span>
    </div>
    <div class="budget-progress__limit">上限 {{ limitText }}</div>
  </div>
</template>

<style scoped>
.budget-progress {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: var(--sdb-space-3) var(--sdb-space-2);
}

/* 圆环容器（相对定位，让中心文字浮于圆环上方） */
.budget-progress__ring {
  width: 120px;
  height: 120px;
  transform: rotate(-90deg); /* 从顶部开始 */
}
.budget-progress__track {
  stroke: var(--sdb-surface-2);
  opacity: 0.6;
}
.budget-progress__bar {
  transition: stroke-dashoffset 0.6s var(--sdb-ease-out-quart);
}

/* 超支时进度环脉冲提示 */
.is-exceeded .budget-progress__bar {
  animation: budget-pulse 2s var(--sdb-ease-out) infinite;
}
@keyframes budget-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}

/* 中心文字（绝对定位浮于圆环中央） */
.budget-progress__center {
  position: relative;
  margin-top: -100px; /* 上移与圆环中心对齐 */
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: none;
}
.budget-progress__actual {
  font-family: var(--sdb-font-hand);
  font-size: 22px;
  font-weight: 700;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
  color: var(--sdb-text);
}
.budget-progress__unit {
  font-size: 11px;
  color: var(--sdb-text-secondary);
  margin-top: 2px;
}

/* 下方信息 */
.budget-progress__footer {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-top: 6px;
}
.budget-progress__label {
  font-size: var(--sdb-text-sm);
  font-weight: 600;
  color: var(--sdb-text);
}
.budget-progress__pct {
  font-size: var(--sdb-text-sm);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.is-ok .budget-progress__pct { color: var(--sdb-success); }
.is-warning .budget-progress__pct { color: var(--sdb-warning); }
.is-exceeded .budget-progress__pct { color: var(--sdb-danger); }

.budget-progress__limit {
  font-size: 11px;
  color: var(--sdb-text-tertiary);
}

/* reduced-motion 兜底 */
@media (prefers-reduced-motion: reduce) {
  .budget-progress__bar { transition: none; }
  .is-exceeded .budget-progress__bar { animation: none; }
}
</style>

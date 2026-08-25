<script setup lang="ts">
/**
 * 指标卡片（Phase 4）：展示单个 KPI。可选环比 delta，按中国习惯「涨红跌绿」着色。
 */
import { computed } from 'vue';

const props = defineProps<{
  label: string;
  value: string;
  unit?: string;
  /** 环比百分比（如 12.3 表示 +12.3%）。null/undefined 表示无对比数据 */
  delta?: number | null;
  /** delta 的说明文案（如「环比上月」） */
  deltaHint?: string;
  /** 显式指定整卡色调（用于环比卡直接着色数值）；不传则由 delta 推导 */
  tone?: 'up' | 'down' | 'flat' | 'none';
}>();

type Tone = 'up' | 'down' | 'flat' | 'none';

const tone = computed<Tone>(() => {
  if (props.tone) return props.tone;
  if (props.delta == null || Number.isNaN(props.delta)) return 'none';
  if (props.delta > 0.05) return 'up';
  if (props.delta < -0.05) return 'down';
  return 'flat';
});

const deltaText = computed(() => {
  if (props.delta == null || Number.isNaN(props.delta)) return '';
  const sign = props.delta > 0 ? '+' : '';
  return `${sign}${props.delta.toFixed(1)}%`;
});
</script>

<template>
  <div class="sdb-metric" :class="`is-${tone}`">
    <div class="sdb-metric__label">{{ label }}</div>
    <div class="sdb-metric__value">
      {{ value }}<span v-if="unit" class="sdb-metric__unit">{{ unit }}</span>
    </div>
    <div v-if="tone !== 'none'" class="sdb-metric__delta">
      <span class="sdb-metric__delta-badge">{{ deltaText }}</span>
      <span v-if="deltaHint" class="sdb-metric__delta-hint">{{ deltaHint }}</span>
    </div>
  </div>
</template>

<style scoped>
.sdb-metric {
  background: var(--sdb-surface);
  background-image: var(--sdb-paper);
  background-repeat: repeat;
  border: 1px solid var(--sdb-border);
  border-radius: var(--sdb-radius);
  box-shadow: var(--sdb-shadow);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.sdb-metric__label {
  font-size: 12px;
  color: var(--sdb-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sdb-metric__value {
  /* 手写感大数字（仅数字/符号，渐进增强） */
  font-family: var(--sdb-font-hand);
  font-size: 30px;
  font-weight: 700;
  color: var(--sdb-text);
  line-height: 1.1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-variant-numeric: tabular-nums;
}
.sdb-metric__unit {
  font-family: var(--sdb-font-rounded);
  font-size: 13px;
  font-weight: 600;
  color: var(--sdb-text-secondary);
  margin-left: 3px;
}
.sdb-metric__delta {
  display: flex;
  align-items: baseline;
  gap: 4px;
  font-size: 12px;
}
.sdb-metric__delta-badge {
  font-weight: 600;
}
.sdb-metric__delta-hint {
  color: var(--sdb-text-secondary);
}
/* 中国习惯：涨红跌绿（费用上涨用红，下降用绿） */
.sdb-metric.is-up .sdb-metric__delta-badge {
  color: var(--sdb-danger);
}
.sdb-metric.is-down .sdb-metric__delta-badge {
  color: var(--sdb-success);
}
.sdb-metric.is-flat .sdb-metric__delta-badge {
  color: var(--sdb-text-secondary);
}
/* 显式 tone 时同步着色数值（如环比卡） */
.sdb-metric.is-up .sdb-metric__value {
  color: var(--sdb-danger);
}
.sdb-metric.is-down .sdb-metric__value {
  color: var(--sdb-success);
}
.sdb-metric.is-flat .sdb-metric__value {
  color: var(--sdb-text-secondary);
}
</style>

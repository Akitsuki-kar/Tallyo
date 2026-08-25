<script setup lang="ts">
/**
 * 账单概览卡片（手作美学）
 *
 * 展示月度账单摘要：月份标签、合计金额（手写体大数字）、电费/水费明细分项、
 * 用量信息、预算状态徽章。可点击展开查看完整模板渲染。
 *
 * 严格使用 --sdb-* token，无硬编码颜色。
 */
import { computed } from 'vue';
import type { Bill } from '@/types';
import { formatCurrency, formatNumber } from '@/utils/format';
import { formatMonthLabel } from '@/utils/dayjs';

const props = defineProps<{
  bill: Bill;
  premiseName?: string;
}>();

const emit = defineEmits<{
  (e: 'click'): void;
}>();

/** 预算状态徽章 */
const statusInfo = computed(() => {
  switch (props.bill.budgetStatus) {
    case 'exceeded': return { text: '超支', icon: 'warning-o', cls: 'is-exceeded' };
    case 'warning': return { text: '接近', icon: 'bell', cls: 'is-warning' };
    default: return { text: '正常', icon: 'success', cls: 'is-ok' };
  }
});

const monthLabel = computed(() => formatMonthLabel(props.bill.yearMonth));
</script>

<template>
  <div class="bill-card sdb-card" @click="emit('click')">
    <!-- 顶部行：月份 + 状态徽章 -->
    <div class="bill-card__head">
      <div class="bill-card__month-info">
        <span class="bill-card__month">{{ monthLabel }}</span>
        <span v-if="premiseName" class="bill-card__premise">{{ premiseName }}</span>
      </div>
      <span class="bill-card__badge" :class="statusInfo.cls">
        <van-icon :name="statusInfo.icon" />
        {{ statusInfo.text }}
      </span>
    </div>

    <!-- 合计（手写体大数字） -->
    <div class="bill-card__total">
      <span class="bill-card__total-label">合计</span>
      <span class="bill-card__total-value">{{ formatCurrency(bill.totalCost) }}</span>
    </div>

    <!-- 电费/水费明细 -->
    <div class="bill-card__detail">
      <div class="bill-card__detail-row">
        <span class="bill-card__detail-label">
          <van-icon name="flash-on-o" /> 电费
        </span>
        <span class="bill-card__detail-usage">{{ formatNumber(bill.electricityUsage) }} 度</span>
        <span class="bill-card__detail-cost">{{ formatCurrency(bill.electricityCost) }}</span>
      </div>
      <div class="bill-card__detail-row">
        <span class="bill-card__detail-label">
          <van-icon name="drop-o" /> 水费
        </span>
        <span class="bill-card__detail-usage">{{ formatNumber(bill.waterUsage) }} 吨</span>
        <span class="bill-card__detail-cost">{{ formatCurrency(bill.waterCost) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bill-card {
  cursor: pointer;
  transition:
    transform var(--sdb-dur-fast) var(--sdb-ease-out-quart),
    box-shadow var(--sdb-dur) var(--sdb-ease-out);
}
.bill-card:active {
  transform: translateY(1px);
  box-shadow: var(--sdb-shadow-sm);
}

/* 顶部行 */
.bill-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: var(--sdb-space-3);
}
.bill-card__month-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.bill-card__month {
  font-size: var(--sdb-text-base);
  font-weight: 700;
  color: var(--sdb-text);
}
.bill-card__premise {
  font-size: var(--sdb-text-xs);
  color: var(--sdb-text-secondary);
}

/* 状态徽章 */
.bill-card__badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: var(--sdb-text-xs);
  font-weight: 700;
  padding: 2px 8px;
  border-radius: var(--sdb-radius-pill);
  flex-shrink: 0;
}
.bill-card__badge .van-icon { font-size: 13px; }
.bill-card__badge.is-ok {
  color: var(--sdb-success);
  background: oklch(from var(--sdb-success) l c h / 0.12);
}
.bill-card__badge.is-warning {
  color: var(--sdb-warning);
  background: oklch(from var(--sdb-warning) l c h / 0.12);
}
.bill-card__badge.is-exceeded {
  color: var(--sdb-danger);
  background: oklch(from var(--sdb-danger) l c h / 0.12);
}

/* 合计 */
.bill-card__total {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: var(--sdb-space-3);
}
.bill-card__total-label {
  font-size: var(--sdb-text-sm);
  color: var(--sdb-text-secondary);
}
.bill-card__total-value {
  font-family: var(--sdb-font-hand);
  font-size: 28px;
  font-weight: 700;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
  color: var(--sdb-text);
}

/* 明细 */
.bill-card__detail {
  display: flex;
  flex-direction: column;
  gap: var(--sdb-space-2);
  padding-top: var(--sdb-space-2);
  border-top: 1px dashed var(--sdb-border);
}
.bill-card__detail-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.bill-card__detail-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--sdb-text-sm);
  color: var(--sdb-text);
  flex: 1;
}
.bill-card__detail-label .van-icon { font-size: 15px; }
.bill-card__detail-usage {
  font-size: var(--sdb-text-xs);
  color: var(--sdb-text-tertiary);
  font-variant-numeric: tabular-nums;
}
.bill-card__detail-cost {
  font-size: var(--sdb-text-sm);
  font-weight: 600;
  color: var(--sdb-text);
  font-variant-numeric: tabular-nums;
}
</style>

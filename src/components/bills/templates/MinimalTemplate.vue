<script setup lang="ts">
/**
 * 账单模板：极简风（Minimal）
 *
 * 大量留白，仅展示核心数字。合计用手写体大数字居中展示，
 * 下方细线分列电费/水费。色调克制，仅暖色文字。
 */
import type { Bill } from '@/types';
import { formatCurrency, formatNumber } from '@/utils/format';
import { formatMonthLabel } from '@/utils/dayjs';

const props = defineProps<{
  bill: Bill;
  premiseName?: string;
}>();
</script>

<template>
  <div class="bill-minimal">
    <!-- 头部 -->
    <div class="bill-minimal__header">
      <span class="bill-minimal__month">{{ formatMonthLabel(bill.yearMonth) }}</span>
      <span v-if="premiseName" class="bill-minimal__premise">{{ premiseName }}</span>
    </div>

    <!-- 合计（手写体超大数字居中） -->
    <div class="bill-minimal__total-section">
      <div class="bill-minimal__total-label">本月合计</div>
      <div class="bill-minimal__total-value">{{ formatCurrency(bill.totalCost) }}</div>
    </div>

    <!-- 分割线 -->
    <div class="bill-minimal__divider" />

    <!-- 明细 -->
    <div class="bill-minimal__details">
      <div class="bill-minimal__detail-row">
        <span class="bill-minimal__detail-label">电费</span>
        <span class="bill-minimal__detail-value">{{ formatCurrency(bill.electricityCost) }}</span>
        <span class="bill-minimal__detail-sub">{{ formatNumber(bill.electricityUsage) }} 度</span>
      </div>
      <div class="bill-minimal__detail-row">
        <span class="bill-minimal__detail-label">水费</span>
        <span class="bill-minimal__detail-value">{{ formatCurrency(bill.waterCost) }}</span>
        <span class="bill-minimal__detail-sub">{{ formatNumber(bill.waterUsage) }} 吨</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bill-minimal {
  padding: 32px 24px;
  background: var(--sdb-surface);
  background-image: var(--sdb-paper);
  border-radius: var(--sdb-radius);
  color: var(--sdb-text);
}

.bill-minimal__header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 24px;
}
.bill-minimal__month {
  font-size: var(--sdb-text-sm);
  font-weight: 600;
  color: var(--sdb-text);
}
.bill-minimal__premise {
  font-size: var(--sdb-text-xs);
  color: var(--sdb-text-tertiary);
}

/* 合计 */
.bill-minimal__total-section {
  text-align: center;
  margin: 24px 0;
}
.bill-minimal__total-label {
  font-size: var(--sdb-text-xs);
  color: var(--sdb-text-tertiary);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  margin-bottom: 8px;
}
.bill-minimal__total-value {
  font-family: var(--sdb-font-hand);
  font-size: 40px;
  font-weight: 700;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
  color: var(--sdb-text);
}

/* 分割线 */
.bill-minimal__divider {
  height: 1px;
  background: var(--sdb-border);
  margin: 20px 0;
}

/* 明细 */
.bill-minimal__details {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.bill-minimal__detail-row {
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.bill-minimal__detail-label {
  font-size: var(--sdb-text-sm);
  color: var(--sdb-text-secondary);
  flex: 1;
}
.bill-minimal__detail-value {
  font-size: var(--sdb-text-base);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--sdb-text);
}
.bill-minimal__detail-sub {
  font-size: var(--sdb-text-xs);
  color: var(--sdb-text-tertiary);
  font-variant-numeric: tabular-nums;
}
</style>

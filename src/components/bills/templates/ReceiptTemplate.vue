<script setup lang="ts">
/**
 * 账单模板：超市小票风（Receipt）
 *
 * 窄纸条样式，虚线分割，等宽数字，居中布局。
 * 模拟热敏小票的视觉感，但使用暖色纸纹而非纯白。
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
  <div class="bill-receipt">
    <!-- 顶部 -->
    <div class="bill-receipt__header">
      <div class="bill-receipt__title">水电动账</div>
      <div v-if="premiseName" class="bill-receipt__premise">{{ premiseName }}</div>
      <div class="bill-receipt__month">{{ formatMonthLabel(bill.yearMonth) }}</div>
    </div>

    <!-- 虚线分割 -->
    <div class="bill-receipt__dashed" />

    <!-- 明细 -->
    <div class="bill-receipt__body">
      <div class="bill-receipt__row">
        <span>用电</span>
        <span class="bill-receipt__num">{{ formatNumber(bill.electricityUsage) }} 度</span>
        <span class="bill-receipt__price">{{ formatCurrency(bill.electricityCost) }}</span>
      </div>
      <div class="bill-receipt__row">
        <span>用水</span>
        <span class="bill-receipt__num">{{ formatNumber(bill.waterUsage) }} 吨</span>
        <span class="bill-receipt__price">{{ formatCurrency(bill.waterCost) }}</span>
      </div>
    </div>

    <!-- 虚线分割 -->
    <div class="bill-receipt__dashed" />

    <!-- 合计 -->
    <div class="bill-receipt__total">
      <span>合计</span>
      <span class="bill-receipt__total-value">{{ formatCurrency(bill.totalCost) }}</span>
    </div>

    <!-- 底部 -->
    <div class="bill-receipt__dashed" />
    <div class="bill-receipt__footer">感谢使用 · {{ formatMonthLabel(bill.yearMonth) }}</div>
  </div>
</template>

<style scoped>
.bill-receipt {
  width: 280px;
  margin: 0 auto;
  padding: 20px 16px;
  background: var(--sdb-surface);
  background-image: var(--sdb-paper);
  border: 1px dashed var(--sdb-border);
  border-radius: var(--sdb-radius-sm);
  font-family: var(--sdb-font-mono, var(--sdb-font-rounded));
  color: var(--sdb-text);
}

.bill-receipt__header {
  text-align: center;
  margin-bottom: 12px;
}
.bill-receipt__title {
  font-size: var(--sdb-text-base);
  font-weight: 700;
  letter-spacing: 0.05em;
}
.bill-receipt__premise {
  font-size: var(--sdb-text-sm);
  color: var(--sdb-text-secondary);
  margin-top: 2px;
}
.bill-receipt__month {
  font-size: var(--sdb-text-xs);
  color: var(--sdb-text-tertiary);
  margin-top: 2px;
}

.bill-receipt__dashed {
  border-top: 1px dashed var(--sdb-border);
  margin: 10px 0;
}

.bill-receipt__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.bill-receipt__row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--sdb-text-sm);
}
.bill-receipt__row > span:first-child {
  flex: 1;
}
.bill-receipt__num {
  color: var(--sdb-text-secondary);
  font-variant-numeric: tabular-nums;
}
.bill-receipt__price {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  min-width: 70px;
  text-align: right;
}

.bill-receipt__total {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--sdb-text-lg);
  font-weight: 700;
}
.bill-receipt__total-value {
  font-family: var(--sdb-font-hand);
  font-size: 24px;
  font-variant-numeric: tabular-nums;
  color: var(--sdb-primary);
}

.bill-receipt__footer {
  text-align: center;
  font-size: var(--sdb-text-xs);
  color: var(--sdb-text-tertiary);
  margin-top: 8px;
}
</style>

<script setup lang="ts">
/**
 * 账单模板：卡片风（Card）
 *
 * 暖色渐变头部 + 类型图标 + 便签纸感卡片 + 预算状态缎带。
 * 最贴合手作美学的模板，适合分享截图。
 */
import { computed } from 'vue';
import type { Bill } from '@/types';
import { formatCurrency, formatNumber } from '@/utils/format';
import { formatMonthLabel } from '@/utils/dayjs';

const props = defineProps<{
  bill: Bill;
  premiseName?: string;
}>();

/** 房租行：仅在房源勾选「计入账单」且金额大于 0 时出现 */
const showRent = computed(() => props.bill.rentVisible === true && (props.bill.rent ?? 0) > 0);

const budgetText = computed(() => {
  switch (props.bill.budgetStatus) {
    case 'exceeded': return '超预算';
    case 'warning': return '接近预算';
    default: return '预算正常';
  }
});
</script>

<template>
  <div class="bill-card-tpl">
    <!-- 暖色渐变头部 -->
    <div class="bill-card-tpl__header">
      <div class="bill-card-tpl__header-top">
        <div>
          <div class="bill-card-tpl__brand">水电动账</div>
          <div v-if="premiseName" class="bill-card-tpl__premise">{{ premiseName }}</div>
        </div>
        <div class="bill-card-tpl__month">{{ formatMonthLabel(bill.yearMonth) }}</div>
      </div>
      <!-- 预算缎带 -->
      <div class="bill-card-tpl__ribbon" :class="`is-${bill.budgetStatus}`">
        <van-icon :name="bill.budgetStatus === 'exceeded' ? 'warning-o' : bill.budgetStatus === 'warning' ? 'bell' : 'success'" />
        {{ budgetText }}
      </div>
    </div>

    <!-- 合计区 -->
    <div class="bill-card-tpl__total-area">
      <span class="bill-card-tpl__total-label">本月合计</span>
      <span class="bill-card-tpl__total-value">{{ formatCurrency(bill.totalCost) }}</span>
    </div>

    <!-- 明细卡 -->
    <div class="bill-card-tpl__items">
      <div class="bill-card-tpl__item">
        <div class="bill-card-tpl__item-icon is-elec">
          <van-icon name="flash-on-o" />
        </div>
        <div class="bill-card-tpl__item-body">
          <div class="bill-card-tpl__item-label">电费</div>
          <div class="bill-card-tpl__item-sub">{{ formatNumber(bill.electricityUsage) }} 度</div>
        </div>
        <div class="bill-card-tpl__item-cost">{{ formatCurrency(bill.electricityCost) }}</div>
      </div>
      <div class="bill-card-tpl__item">
        <div class="bill-card-tpl__item-icon is-water">
          <van-icon name="drop-o" />
        </div>
        <div class="bill-card-tpl__item-body">
          <div class="bill-card-tpl__item-label">水费</div>
          <div class="bill-card-tpl__item-sub">{{ formatNumber(bill.waterUsage) }} 吨</div>
        </div>
        <div class="bill-card-tpl__item-cost">{{ formatCurrency(bill.waterCost) }}</div>
      </div>
      <div v-if="showRent" class="bill-card-tpl__item">
        <div class="bill-card-tpl__item-icon is-rent">
          <van-icon name="home-o" />
        </div>
        <div class="bill-card-tpl__item-body">
          <div class="bill-card-tpl__item-label">房租</div>
          <div class="bill-card-tpl__item-sub">月租</div>
        </div>
        <div class="bill-card-tpl__item-cost">{{ formatCurrency(bill.rent ?? 0) }}</div>
      </div>
    </div>

    <!-- 底部 -->
    <div class="bill-card-tpl__footer">
      生成于 {{ bill.generatedAt.slice(0, 10) }}
    </div>
  </div>
</template>

<style scoped>
.bill-card-tpl {
  max-width: 380px;
  margin: 0 auto;
  background: var(--sdb-surface);
  background-image: var(--sdb-paper);
  border: 1px solid var(--sdb-border);
  border-radius: var(--sdb-radius);
  box-shadow: var(--sdb-shadow);
  overflow: hidden;
  color: var(--sdb-text);
}

/* 渐变头部 */
.bill-card-tpl__header {
  background: linear-gradient(135deg, var(--sdb-primary), var(--sdb-primary-dark));
  padding: 16px 20px;
  color: var(--sdb-on-primary);
}
.bill-card-tpl__header-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.bill-card-tpl__brand {
  font-size: var(--sdb-text-base);
  font-weight: 700;
  letter-spacing: 0.03em;
}
.bill-card-tpl__premise {
  font-size: var(--sdb-text-xs);
  opacity: 0.85;
  margin-top: 2px;
}
.bill-card-tpl__month {
  font-size: var(--sdb-text-sm);
  font-weight: 600;
  opacity: 0.9;
}

/* 预算缎带 */
.bill-card-tpl__ribbon {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--sdb-text-xs);
  font-weight: 700;
  padding: 2px 10px;
  border-radius: var(--sdb-radius-pill);
  margin-top: 10px;
  background: rgba(255, 255, 255, 0.2);
}
.bill-card-tpl__ribbon .van-icon { font-size: 13px; }
.bill-card-tpl__ribbon.is-exceeded { background: rgba(0, 0, 0, 0.25); }
.bill-card-tpl__ribbon.is-warning { background: rgba(255, 255, 255, 0.3); }

/* 合计区 */
.bill-card-tpl__total-area {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 20px;
}
.bill-card-tpl__total-label {
  font-size: var(--sdb-text-sm);
  color: var(--sdb-text-secondary);
}
.bill-card-tpl__total-value {
  font-family: var(--sdb-font-hand);
  font-size: 32px;
  font-weight: 700;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
  color: var(--sdb-text);
}

/* 明细项 */
.bill-card-tpl__items {
  display: flex;
  flex-direction: column;
  gap: var(--sdb-space-2);
  padding: 0 20px 16px;
}
.bill-card-tpl__item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: var(--sdb-surface-2);
  border-radius: var(--sdb-radius-sm);
}
.bill-card-tpl__item-icon {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  flex-shrink: 0;
}
.bill-card-tpl__item-icon .van-icon { font-size: 18px; }
.bill-card-tpl__item-icon.is-elec {
  background: oklch(from var(--sdb-warning) l c h / 0.15);
  color: var(--sdb-warning);
}
.bill-card-tpl__item-icon.is-water {
  background: oklch(from var(--sdb-water) l c h / 0.15);
  color: var(--sdb-water);
}
.bill-card-tpl__item-icon.is-rent {
  background: oklch(from var(--sdb-success) l c h / 0.15);
  color: var(--sdb-success);
}
.bill-card-tpl__item-body {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.bill-card-tpl__item-label {
  font-size: var(--sdb-text-sm);
  font-weight: 600;
  color: var(--sdb-text);
}
.bill-card-tpl__item-sub {
  font-size: var(--sdb-text-xs);
  color: var(--sdb-text-tertiary);
}
.bill-card-tpl__item-cost {
  font-size: var(--sdb-text-base);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--sdb-text);
}

/* 底部 */
.bill-card-tpl__footer {
  padding: 10px 20px;
  font-size: var(--sdb-text-xs);
  color: var(--sdb-text-tertiary);
  border-top: 1px dashed var(--sdb-border);
  text-align: center;
}
</style>

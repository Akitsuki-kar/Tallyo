<script setup lang="ts">
/**
 * 账单模板：专业报表风（Report）
 *
 * 结构化表格布局，标题栏 + 项目/用量/金额表头 + 汇总行。
 * 适合正式场景或打印归档。使用暖色 token 保持一致美学。
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
  <div class="bill-report">
    <!-- 标题栏 -->
    <div class="bill-report__title-bar">
      <div class="bill-report__title">水电动账 · 月度报表</div>
      <div class="bill-report__subtitle">
        <span v-if="premiseName">{{ premiseName }} · </span>
        {{ formatMonthLabel(bill.yearMonth) }}
      </div>
    </div>

    <!-- 表格 -->
    <table class="bill-report__table">
      <thead>
        <tr>
          <th>项目</th>
          <th>用量</th>
          <th>金额</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <span class="bill-report__item-icon">⚡</span>
            电费
          </td>
          <td class="bill-report__num">{{ formatNumber(bill.electricityUsage) }} 度</td>
          <td class="bill-report__num bill-report__num--cost">{{ formatCurrency(bill.electricityCost) }}</td>
        </tr>
        <tr>
          <td>
            <span class="bill-report__item-icon">💧</span>
            水费
          </td>
          <td class="bill-report__num">{{ formatNumber(bill.waterUsage) }} 吨</td>
          <td class="bill-report__num bill-report__num--cost">{{ formatCurrency(bill.waterCost) }}</td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <td>合计</td>
          <td></td>
          <td class="bill-report__total">{{ formatCurrency(bill.totalCost) }}</td>
        </tr>
      </tfoot>
    </table>

    <!-- 底部信息 -->
    <div class="bill-report__footer">
      <span>生成日期：{{ bill.generatedAt.slice(0, 10) }}</span>
      <span>预算状态：{{ bill.budgetStatus === 'exceeded' ? '超支' : bill.budgetStatus === 'warning' ? '接近上限' : '正常' }}</span>
    </div>
  </div>
</template>

<style scoped>
.bill-report {
  max-width: 420px;
  margin: 0 auto;
  background: var(--sdb-surface);
  background-image: var(--sdb-paper);
  border: 1px solid var(--sdb-border);
  border-radius: var(--sdb-radius);
  overflow: hidden;
  color: var(--sdb-text);
}

/* 标题栏 */
.bill-report__title-bar {
  background: var(--sdb-surface-2);
  border-bottom: 2px solid var(--sdb-primary);
  padding: 14px 20px;
}
.bill-report__title {
  font-size: var(--sdb-text-base);
  font-weight: 700;
  color: var(--sdb-text);
}
.bill-report__subtitle {
  font-size: var(--sdb-text-sm);
  color: var(--sdb-text-secondary);
  margin-top: 2px;
}

/* 表格 */
.bill-report__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--sdb-text-sm);
}
.bill-report__table th {
  text-align: left;
  font-weight: 600;
  color: var(--sdb-text-secondary);
  padding: 10px 20px;
  border-bottom: 1px solid var(--sdb-border);
  font-size: var(--sdb-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.bill-report__table th:nth-child(2),
.bill-report__table th:nth-child(3) {
  text-align: right;
}
.bill-report__table td {
  padding: 12px 20px;
  border-bottom: 1px solid var(--sdb-border);
}
.bill-report__table tbody tr:last-child td {
  border-bottom: none;
}
.bill-report__table tfoot td {
  padding: 12px 20px;
  border-top: 2px solid var(--sdb-border);
  font-weight: 700;
  font-size: var(--sdb-text-base);
}

.bill-report__item-icon {
  margin-right: 6px;
}

.bill-report__num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--sdb-text-secondary);
}
.bill-report__num--cost {
  font-weight: 600;
  color: var(--sdb-text);
}
.bill-report__total {
  text-align: right;
  font-family: var(--sdb-font-hand);
  font-size: 22px;
  font-variant-numeric: tabular-nums;
  color: var(--sdb-primary);
}

/* 底部 */
.bill-report__footer {
  display: flex;
  justify-content: space-between;
  padding: 10px 20px;
  font-size: var(--sdb-text-xs);
  color: var(--sdb-text-tertiary);
  border-top: 1px dashed var(--sdb-border);
}
</style>

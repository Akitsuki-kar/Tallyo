<script setup lang="ts">
/**
 * 可视化统计页（Phase 4，architecture.md §T07）。
 *
 * - 房源切换器：默认当前选中房源，可切到「全部房源汇总」（按用户拍板）。
 * - 时间跨度：用户手动选择（近 3/6/12 月 + 全部历史），图表随选择重绘、页面响应式适配手机/PC。
 * - 指标卡：本月电费 / 水费 / 合计 + 环比（中国习惯涨红跌绿）。
 * - 三图：趋势折线（电费/水费/合计）、月度对比柱状（电费 vs 水费）、费用构成饼图（中心显示合计）。
 * - 数据全部从 bills / premises store 派生（reactive），无需额外请求。
 */
import { computed, ref } from 'vue';
import { useBillsStore } from '@/stores/bills';
import { usePremisesStore } from '@/stores/premises';
import { formatCurrency } from '@/utils/format';
import EmptyState from '@/components/common/EmptyState.vue';
import MetricCard from '@/components/stats/MetricCard.vue';
import TrendChart from '@/components/stats/TrendChart.vue';
import CompareChart from '@/components/stats/CompareChart.vue';
import CostPieChart from '@/components/stats/CostPieChart.vue';

interface SheetAction {
  name: string;
  value: string;
}

const billsStore = useBillsStore();
const premisesStore = usePremisesStore();

const scope = ref<'current' | 'all'>('current');
const span = ref<'3' | '6' | '12' | 'all'>('6');

const scopeSheet = ref(false);
const spanSheet = ref(false);

const scopeOptions = computed<SheetAction[]>(() => [
  { name: '全部房源', value: 'all' },
  ...premisesStore.list.map((p) => ({ name: p.name, value: p.id })),
]);
const spanOptions: SheetAction[] = [
  { name: '近 3 个月', value: '3' },
  { name: '近 6 个月', value: '6' },
  { name: '近 12 个月', value: '12' },
  { name: '全部历史', value: 'all' },
];

const scopeLabel = computed(() =>
  scope.value === 'all' ? '全部房源' : premisesStore.currentPremise?.name ?? '当前房源',
);
const spanLabel = computed(() => spanOptions.find((o) => o.value === span.value)?.name ?? '近 6 个月');

function onScopeSelect(action: SheetAction): void {
  scopeSheet.value = false;
  if (action.value === 'all') {
    scope.value = 'all';
  } else {
    scope.value = 'current';
    premisesStore.setCurrent(action.value);
  }
}
function onSpanSelect(action: SheetAction): void {
  spanSheet.value = false;
  span.value = action.value as '3' | '6' | '12' | 'all';
}

// ---- 数据派生 ----
const billsList = computed(() => Object.values(billsStore.bills).filter((b) => !b.isDeleted));
const scopedBills = computed(() => {
  if (scope.value === 'all') return billsList.value;
  const pid = premisesStore.currentPremiseId;
  return billsList.value.filter((b) => b.premiseId === pid);
});

const monthsDesc = computed(() =>
  [...new Set(scopedBills.value.map((b) => b.yearMonth))].sort((a, b) => (a < b ? 1 : -1)),
);
const rangeMonths = computed(() => {
  const n = span.value === 'all' ? Number.MAX_SAFE_INTEGER : Number(span.value);
  return monthsDesc.value.slice(0, n).sort((a, b) => (a < b ? -1 : 1)); // 升序供图表 X 轴
});

function aggFor(month: string) {
  const bs = scopedBills.value.filter((b) => b.yearMonth === month);
  return {
    ele: bs.reduce((s, b) => s + b.electricityCost, 0),
    water: bs.reduce((s, b) => s + b.waterCost, 0),
    total: bs.reduce((s, b) => s + b.totalCost, 0),
  };
}

const aggs = computed(() => rangeMonths.value.map(aggFor));
const months = computed(() => rangeMonths.value.map((m) => `${Number(m.slice(5))}月`));
const eleArr = computed(() => aggs.value.map((a) => a.ele));
const waterArr = computed(() => aggs.value.map((a) => a.water));
const totalArr = computed(() => aggs.value.map((a) => a.total));

const lastAgg = computed(() => (aggs.value.length ? aggs.value[aggs.value.length - 1] : null));
const prevAgg = computed(() => (aggs.value.length > 1 ? aggs.value[aggs.value.length - 2] : null));
const deltaPct = computed(() => {
  if (!lastAgg.value || !prevAgg.value || prevAgg.value.total <= 0) return null;
  return ((lastAgg.value.total - prevAgg.value.total) / prevAgg.value.total) * 100;
});
const deltaText = computed(() =>
  deltaPct.value == null ? '—' : `${deltaPct.value > 0 ? '+' : ''}${deltaPct.value.toFixed(1)}%`,
);
const deltaTone = computed<'up' | 'down' | 'flat' | 'none'>(() => {
  if (deltaPct.value == null) return 'none';
  if (deltaPct.value > 0.05) return 'up';
  if (deltaPct.value < -0.05) return 'down';
  return 'flat';
});
const hasData = computed(() => scopedBills.value.length > 0);
const pieTitle = computed(() =>
  rangeMonths.value.length ? `${rangeMonths.value[rangeMonths.value.length - 1]} 费用构成` : '费用构成',
);

const money = (n: number): string => formatCurrency(n);
</script>

<template>
  <div class="sdb-stats">
    <h2 class="sdb-page-title">可视化统计</h2>

    <!-- 选择器：房源维度 + 时间跨度 -->
    <div class="sdb-stats__filters">
      <button class="sdb-chip" type="button" @click="scopeSheet = true">
        <span class="sdb-chip__key">房源</span>
        <span class="sdb-chip__val">{{ scopeLabel }}</span>
        <span class="sdb-chip__caret">▾</span>
      </button>
      <button class="sdb-chip" type="button" @click="spanSheet = true">
        <span class="sdb-chip__key">区间</span>
        <span class="sdb-chip__val">{{ spanLabel }}</span>
        <span class="sdb-chip__caret">▾</span>
      </button>
    </div>

    <EmptyState
      v-if="!hasData"
      text="暂无账单数据"
      hint="先去记录读数，月底账单会自动生成"
    />

    <template v-else>
      <!-- 指标卡 -->
      <div class="sdb-metric-row">
        <MetricCard label="本月电费" :value="lastAgg ? money(lastAgg.ele) : '—'" />
        <MetricCard label="本月水费" :value="lastAgg ? money(lastAgg.water) : '—'" />
        <MetricCard label="本月合计" :value="lastAgg ? money(lastAgg.total) : '—'" />
        <MetricCard label="环比 (总)" :value="deltaText" :tone="deltaTone" delta-hint="环比上月" />
      </div>

      <!-- 趋势折线 -->
      <section class="sdb-card">
        <h3 class="sdb-card__title">费用趋势</h3>
        <TrendChart :months="months" :electricity="eleArr" :water="waterArr" :total="totalArr" />
      </section>

      <!-- 月度对比 + 费用构成（PC 两列，手机堆叠） -->
      <div class="sdb-stats-grid">
        <section class="sdb-card">
          <h3 class="sdb-card__title">月度对比</h3>
          <CompareChart :months="months" :electricity="eleArr" :water="waterArr" />
        </section>
        <section class="sdb-card">
          <h3 class="sdb-card__title">费用构成</h3>
          <CostPieChart
            :electricity="lastAgg?.ele ?? 0"
            :water="lastAgg?.water ?? 0"
            :title="pieTitle"
          />
        </section>
      </div>
    </template>

    <!-- 选择器面板 -->
    <van-action-sheet
      v-model:show="scopeSheet"
      :actions="scopeOptions"
      cancel-text="取消"
      description="选择统计房源"
      @select="onScopeSelect"
    />
    <van-action-sheet
      v-model:show="spanSheet"
      :actions="spanOptions"
      cancel-text="取消"
      description="选择时间跨度"
      @select="onSpanSelect"
    />
  </div>
</template>

<style scoped>
.sdb-stats {
  padding: var(--sdb-pad);
  display: flex;
  flex-direction: column;
  gap: var(--sdb-gap);
}
.sdb-page-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--sdb-text);
}
.sdb-stats__filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.sdb-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border: 1px solid var(--sdb-surface-2);
  background: var(--sdb-surface);
  border-radius: 999px;
  box-shadow: var(--sdb-shadow);
  cursor: pointer;
  font-size: 13px;
}
.sdb-chip__key {
  color: var(--sdb-text-secondary);
}
.sdb-chip__val {
  color: var(--sdb-text);
  font-weight: 600;
}
.sdb-chip__caret {
  color: var(--sdb-text-secondary);
  font-size: 11px;
}
.sdb-metric-row {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
.sdb-card {
  background: var(--sdb-surface);
  border-radius: var(--sdb-radius);
  box-shadow: var(--sdb-shadow);
  padding: 12px 14px 8px;
}
.sdb-card__title {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 600;
  color: var(--sdb-text);
}
.sdb-stats-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--sdb-gap);
}
/* PC ≥768px：月度对比与费用构成并排 */
@media (min-width: 768px) {
  .sdb-metric-row {
    grid-template-columns: repeat(4, 1fr);
  }
  .sdb-stats-grid {
    grid-template-columns: 1fr 1fr;
  }
}
</style>

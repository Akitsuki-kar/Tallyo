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
import { computed, onMounted, ref } from 'vue';
import { useBillsStore } from '@/stores/bills';
import { usePremisesStore } from '@/stores/premises';
import { useReadingsStore } from '@/stores/readings';
import { formatCurrency } from '@/utils/format';
import { dailyStats } from '@/utils/billing';
import { dayjs, prevMonthKey, nextMonthKey } from '@/utils/dayjs';
import { logger } from '@/utils/logger';
import EmptyState from '@/components/common/EmptyState.vue';
import MetricCard from '@/components/stats/MetricCard.vue';
import TrendChart from '@/components/stats/TrendChart.vue';
import CompareChart from '@/components/stats/CompareChart.vue';
import CostPieChart from '@/components/stats/CostPieChart.vue';
import DailyChart from '@/components/stats/DailyChart.vue';

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

// ---- 读数条数（按区间）：按所选房源维度 + 时间跨度统计各月读数条数 ----
// 首页「本月条数」的宏观展开：统计页按区间展示每个月的读数条数分布。
const readingCounts = computed(() => {
  const pid = premisesStore.currentPremiseId;
  return rangeMonths.value.map((m) => {
    const count = readingsStore.items.filter(
      (r) => !r.isDeleted && (scope.value === 'all' || r.premiseId === pid) && r.date.startsWith(m),
    ).length;
    return { month: `${Number(m.slice(5))}月`, count };
  });
});
const READING_BAR_PX = 88;
const maxReadingCount = computed(() => Math.max(1, ...readingCounts.value.map((c) => c.count)));
function barHeightPx(n: number): number {
  if (n <= 0) return 3;
  return Math.max(3, Math.round((n / maxReadingCount.value) * READING_BAR_PX));
}

// ---- 视图切换：月度（原有三图）/ 每日（0.1.1 新增） ----
const viewMode = ref<'monthly' | 'daily'>('monthly');

// ---- 每日视图：当前房源 + 可前后翻月（用户需求「当月每天」+ 历史回看） ----
const readingsStore = useReadingsStore();
const dailyMonth = ref(dayjs().format('YYYY-MM'));
const dailyPoints = computed(() =>
  dailyStats(readingsStore.items, premisesStore.currentPremiseId, dailyMonth.value),
);
const dailyHasData = computed(() =>
  dailyPoints.value.some((p) => p.hasReading || p.electricity > 0 || p.water > 0),
);
function stepMonth(delta: number): void {
  dailyMonth.value = delta < 0 ? prevMonthKey(dailyMonth.value) : nextMonthKey(dailyMonth.value);
}
onMounted(async () => {
  // 每日视图依赖读数；bootstrap 通常已加载，这里兜底
  if (!readingsStore.items.length) {
    try {
      await readingsStore.load();
    } catch (err) {
      logger.error('stats', '加载读数失败', { message: err instanceof Error ? err.message : String(err) });
    }
  }
});
</script>

<template>
  <div class="sdb-stats">
    <h2 class="sdb-page-title">可视化统计</h2>

    <!-- 视图切换：月度 / 每日 -->
    <div class="sdb-seg">
      <button
        class="sdb-seg__i"
        :class="{ 'is-on': viewMode === 'monthly' }"
        type="button"
        @click="viewMode = 'monthly'"
      >
        月度
      </button>
      <button
        class="sdb-seg__i"
        :class="{ 'is-on': viewMode === 'daily' }"
        type="button"
        @click="viewMode = 'daily'"
      >
        每日
      </button>
    </div>

    <!-- 月度视图：房源 + 区间选择 + 三图 -->
    <template v-if="viewMode === 'monthly'">
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

        <!-- 读数条数（按区间）：对应首页「本月条数」的逐月分布 -->
        <section class="sdb-card">
          <h3 class="sdb-card__title">读数条数（按区间）</h3>
          <div v-if="readingCounts.some((c) => c.count > 0)" class="sdb-countbars">
            <div v-for="c in readingCounts" :key="c.month" class="sdb-countbars__col">
              <div class="sdb-countbars__track">
                <div class="sdb-countbars__bar" :style="{ height: barHeightPx(c.count) + 'px' }">
                  <span class="sdb-countbars__num">{{ c.count }}</span>
                </div>
              </div>
              <div class="sdb-countbars__label">{{ c.month }}</div>
            </div>
          </div>
          <EmptyState v-else text="区间内暂无读数" hint="先去记录读数，再回来看条数分布" />
        </section>
      </template>
    </template>

    <!-- 每日视图：当前房源 + 翻月 + 日维度图表 -->
    <template v-else>
      <div class="sdb-stats__daily-head">
        <span class="sdb-stats__daily-name">{{ premisesStore.currentPremise?.name ?? '当前房源' }}</span>
        <div class="sdb-stats__month-nav">
          <button class="sdb-chip sdb-chip--sm" type="button" aria-label="上个月" @click="stepMonth(-1)">‹</button>
          <span class="sdb-chip__val">{{ dailyMonth }}</span>
          <button class="sdb-chip sdb-chip--sm" type="button" aria-label="下个月" @click="stepMonth(1)">›</button>
        </div>
      </div>

      <EmptyState
        v-if="!dailyHasData"
        text="本月暂无读数"
        hint="先去记录读数，再回来看每日用量与涨幅"
      />
      <DailyChart v-else :points="dailyPoints" />
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
/* 视图切换分段控件（月度 / 每日） */
.sdb-seg {
  display: flex;
  gap: 4px;
  padding: 4px;
  background: var(--sdb-surface-2);
  border-radius: var(--sdb-radius-pill);
  width: fit-content;
}
.sdb-seg__i {
  padding: 7px 22px;
  border: none;
  border-radius: var(--sdb-radius-pill);
  cursor: pointer;
  background: transparent;
  color: var(--sdb-text-secondary);
  font-family: inherit;
  font-size: var(--sdb-text-sm);
  font-weight: 600;
  transition:
    background var(--sdb-dur-fast) var(--sdb-ease-out),
    color var(--sdb-dur-fast) var(--sdb-ease-out);
}
.sdb-seg__i.is-on {
  background: var(--sdb-surface);
  color: var(--sdb-text);
  box-shadow: var(--sdb-shadow-sm);
}
/* 每日视图头部：房源名 + 翻月 */
.sdb-stats__daily-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.sdb-stats__daily-name {
  font-size: var(--sdb-text-base);
  font-weight: 700;
  color: var(--sdb-text);
}
.sdb-stats__month-nav {
  display: flex;
  align-items: center;
  gap: 6px;
}
.sdb-chip--sm {
  padding: 6px 12px;
  font-size: 16px;
  line-height: 1;
}
/* 读数条数（按区间）迷你柱状 */
.sdb-countbars {
  display: flex;
  align-items: stretch;
  gap: 8px;
  padding-top: 6px;
}
.sdb-countbars__col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.sdb-countbars__track {
  height: 96px;
  width: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.sdb-countbars__bar {
  position: relative;
  width: 70%;
  max-width: 26px;
  min-height: 3px;
  background: var(--sdb-primary);
  border-radius: 6px 6px 2px 2px;
  transition: height var(--sdb-dur) var(--sdb-ease-out);
}
.sdb-countbars__num {
  position: absolute;
  top: -18px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 11px;
  font-weight: 700;
  color: var(--sdb-text-secondary);
  font-variant-numeric: tabular-nums;
}
.sdb-countbars__label {
  font-size: 11px;
  color: var(--sdb-text-secondary);
}
/* 尊重降低动效偏好 */
@media (prefers-reduced-motion: reduce) {
  .sdb-seg__i {
    transition: none;
  }
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

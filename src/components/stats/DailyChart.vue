<script setup lang="ts">
/**
 * 日维度统计图（0.1.1 功能 3）：当前房源某月的
 *  - 每日用电 / 用水量（双轴柱状，电度 / 水吨单位不同分轴避免刻度打架）
 *  - 每日环比涨幅（折线，涨红跌绿；无前日 / 无数据为缺省）
 * 纯展示：数据由 Stats 页经 dailyStats() 算好传入，本组件不碰仓库。
 * 复用 useECharts，主题切换 / 容器缩放自动重绘（与既有图表一致）。
 */
import { computed, ref, watch } from 'vue';
import type { EChartsOption } from 'echarts';
import { useECharts, type ChartPalette } from '@/composables/useECharts';
import type { DailyStatsPoint } from '@/utils/billing';

const props = defineProps<{ points: DailyStatsPoint[] }>();

const days = computed(() => props.points.map((p) => `${p.day}日`));
const eleArr = computed(() => props.points.map((p) => p.electricity));
const waterArr = computed(() => props.points.map((p) => p.water));
const eleGrowth = computed(() => props.points.map((p) => p.electricityGrowth));
const waterGrowth = computed(() => props.points.map((p) => p.waterGrowth));

// ---- 汇总卡 ----
const sumEle = computed(() => props.points.reduce((s, p) => s + p.electricity, 0));
const sumWater = computed(() => props.points.reduce((s, p) => s + p.water, 0));
const daysWithUse = computed(
  () => props.points.filter((p) => p.electricity > 0 || p.water > 0).length || 1,
);
const avgEle = computed(() => sumEle.value / daysWithUse.value);
const peak = computed<DailyStatsPoint>(() => {
  let m: DailyStatsPoint | undefined;
  for (const p of props.points) {
    if (!m || p.electricity + p.water > m.electricity + m.water) m = p;
  }
  return (
    m ?? {
      date: '',
      day: 0,
      electricity: 0,
      water: 0,
      hasReading: false,
      electricityGrowth: null,
      waterGrowth: null,
    }
  );
});

// 涨红跌绿：正 → danger，负 → success，持平/无数据 → 次级灰
function signColor(p: ChartPalette) {
  return (params: { value?: unknown }) => {
    const v = typeof params.value === 'number' ? params.value : null;
    if (v == null || v === 0) return p.textSecondary;
    return v > 0 ? p.danger : p.success;
  };
}

const usageEl = ref<HTMLElement | null>(null);
const growthEl = ref<HTMLElement | null>(null);

function buildUsage(p: ChartPalette): EChartsOption {
  return {
    color: [p.primary, p.accent],
    tooltip: {
      trigger: 'axis',
      backgroundColor: p.surface,
      borderColor: p.splitLine,
      textStyle: { color: p.text },
    },
    legend: { data: ['用电', '用水'], top: 0, textStyle: { color: p.textSecondary }, itemWidth: 14, itemHeight: 8 },
    grid: { left: 4, right: 12, top: 36, bottom: 4, containLabel: true },
    xAxis: {
      type: 'category',
      data: days.value,
      axisLine: { lineStyle: { color: p.axisLine } },
      axisLabel: { color: p.textSecondary, fontSize: 10, interval: Math.ceil(days.value.length / 15) },
      axisTick: { show: false },
    },
    yAxis: [
      {
        type: 'value',
        name: '度',
        nameTextStyle: { color: p.textSecondary, fontSize: 10 },
        axisLabel: { color: p.textSecondary, fontSize: 10 },
        splitLine: { lineStyle: { color: p.splitLine } },
        axisLine: { show: false },
      },
      {
        type: 'value',
        name: '吨',
        nameTextStyle: { color: p.textSecondary, fontSize: 10 },
        axisLabel: { color: p.textSecondary, fontSize: 10 },
        splitLine: { show: false },
        axisLine: { show: false },
      },
    ],
    series: [
      {
        name: '用电',
        type: 'bar',
        yAxisIndex: 0,
        data: eleArr.value,
        barMaxWidth: 16,
        itemStyle: { color: p.primary, borderRadius: [3, 3, 0, 0] },
      },
      {
        name: '用水',
        type: 'bar',
        yAxisIndex: 1,
        data: waterArr.value,
        barMaxWidth: 16,
        itemStyle: { color: p.accent, borderRadius: [3, 3, 0, 0] },
      },
    ],
  };
}

function buildGrowth(p: ChartPalette): EChartsOption {
  return {
    color: [p.danger, p.success],
    tooltip: {
      trigger: 'axis',
      backgroundColor: p.surface,
      borderColor: p.splitLine,
      textStyle: { color: p.text },
      valueFormatter: (v) => {
        const n = typeof v === 'number' ? v : null;
        return n == null ? '—' : `${n > 0 ? '+' : ''}${Math.round(n * 100)}%`;
      },
    },
    legend: { data: ['用电涨幅', '用水涨幅'], top: 0, textStyle: { color: p.textSecondary }, itemWidth: 14, itemHeight: 8 },
    grid: { left: 4, right: 12, top: 36, bottom: 4, containLabel: true },
    xAxis: {
      type: 'category',
      data: days.value,
      axisLine: { lineStyle: { color: p.axisLine } },
      axisLabel: { color: p.textSecondary, fontSize: 10, interval: Math.ceil(days.value.length / 15) },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        color: p.textSecondary,
        fontSize: 10,
        formatter: (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`,
      },
      splitLine: { lineStyle: { color: p.splitLine } },
      axisLine: { show: false },
    },
    series: [
      {
        name: '用电涨幅',
        type: 'line',
        smooth: true,
        showSymbol: true,
        symbolSize: 5,
        connectNulls: false,
        data: eleGrowth.value,
        itemStyle: { color: signColor(p) },
        lineStyle: { width: 2, color: p.axisLine },
      },
      {
        name: '用水涨幅',
        type: 'line',
        smooth: true,
        showSymbol: true,
        symbolSize: 5,
        connectNulls: false,
        data: waterGrowth.value,
        itemStyle: { color: signColor(p) },
        lineStyle: { width: 2, color: p.axisLine },
      },
    ],
  };
}

const u = useECharts(usageEl, buildUsage);
const g = useECharts(growthEl, buildGrowth);

watch(
  () => props.points,
  () => {
    u.render();
    g.render();
  },
  { deep: true },
);
</script>

<template>
  <div class="sdb-daily">
    <!-- 汇总卡：当月总量 / 日均 / 峰值日，一眼看规模 -->
    <div class="sdb-daily__summary">
      <div class="sdb-daily__chip">
        <span class="sdb-daily__k">月累计用电</span>
        <b class="sdb-daily__v">{{ sumEle.toFixed(1) }} 度</b>
      </div>
      <div class="sdb-daily__chip">
        <span class="sdb-daily__k">月累计用水</span>
        <b class="sdb-daily__v">{{ sumWater.toFixed(1) }} 吨</b>
      </div>
      <div class="sdb-daily__chip">
        <span class="sdb-daily__k">日均用电</span>
        <b class="sdb-daily__v">{{ avgEle.toFixed(1) }} 度</b>
      </div>
      <div class="sdb-daily__chip">
        <span class="sdb-daily__k">峰值日</span>
        <b class="sdb-daily__v">{{ peak.day ? `${peak.day} 日` : '—' }}</b>
      </div>
    </div>

    <section class="sdb-card">
      <h3 class="sdb-card__title">每日用量</h3>
      <div ref="usageEl" class="sdb-chart"></div>
    </section>

    <section class="sdb-card">
      <h3 class="sdb-card__title">每日环比涨幅（涨红跌绿）</h3>
      <div ref="growthEl" class="sdb-chart sdb-chart--short"></div>
    </section>
  </div>
</template>

<style scoped>
.sdb-daily {
  display: flex;
  flex-direction: column;
  gap: var(--sdb-gap);
}
.sdb-daily__summary {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
.sdb-daily__chip {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  background: var(--sdb-surface);
  border-radius: var(--sdb-radius-sm);
  box-shadow: var(--sdb-shadow);
}
.sdb-daily__k {
  font-size: var(--sdb-text-xs);
  color: var(--sdb-text-secondary);
}
.sdb-daily__v {
  font-size: var(--sdb-text-base);
  font-weight: 700;
  color: var(--sdb-text);
}
/* 复用既有卡片骨架（与 Stats 内 .sdb-card 同款观感，自包含不依赖父作用域） */
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
.sdb-chart {
  width: 100%;
  height: 240px;
}
.sdb-chart--short {
  height: 210px;
}
@media (min-width: 768px) {
  .sdb-daily__summary {
    grid-template-columns: repeat(4, 1fr);
  }
}
</style>

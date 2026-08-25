<script setup lang="ts">
/**
 * 趋势折线图（Phase 4）：电费 / 水费 / 合计 三条折线，带面积。主题自适应、响应式。
 */
import { ref, watch } from 'vue';
import type { EChartsOption } from 'echarts';
import { useECharts, type ChartPalette } from '@/composables/useECharts';

const props = defineProps<{
  months: string[];
  electricity: number[];
  water: number[];
  total: number[];
}>();

const el = ref<HTMLElement | null>(null);

function build(p: ChartPalette): EChartsOption {
  return {
    color: [p.primary, p.accent, p.danger],
    tooltip: {
      trigger: 'axis',
      backgroundColor: p.surface,
      borderColor: p.splitLine,
      textStyle: { color: p.text },
      valueFormatter: (v) => (typeof v === 'number' ? `¥${v.toFixed(2)}` : String(v)),
    },
    legend: {
      data: ['电费', '水费', '合计'],
      top: 0,
      textStyle: { color: p.textSecondary },
      itemWidth: 14,
      itemHeight: 8,
    },
    grid: { left: 4, right: 12, top: 36, bottom: 4, containLabel: true },
    xAxis: {
      type: 'category',
      data: props.months,
      boundaryGap: false,
      axisLine: { lineStyle: { color: p.axisLine } },
      axisLabel: { color: p.textSecondary, fontSize: 11 },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: p.textSecondary, fontSize: 11, formatter: (v: number) => `¥${v}` },
      splitLine: { lineStyle: { color: p.splitLine } },
      axisLine: { show: false },
    },
    series: [
      {
        name: '电费',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: props.electricity,
        itemStyle: { color: p.primary },
        lineStyle: { width: 2 },
        areaStyle: { color: p.primary, opacity: 0.1 },
      },
      {
        name: '水费',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: props.water,
        itemStyle: { color: p.accent },
        lineStyle: { width: 2 },
        areaStyle: { color: p.accent, opacity: 0.1 },
      },
      {
        name: '合计',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: props.total,
        itemStyle: { color: p.danger },
        lineStyle: { width: 2, type: 'dashed' },
      },
    ],
  };
}

const { render } = useECharts(el, build);

watch(
  () => [props.months, props.electricity, props.water, props.total],
  () => render(),
  { deep: true },
);
</script>

<template>
  <div ref="el" class="sdb-chart"></div>
</template>

<style scoped>
.sdb-chart {
  width: 100%;
  height: 260px;
}
</style>

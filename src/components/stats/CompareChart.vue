<script setup lang="ts">
/**
 * 月度对比柱状图（Phase 4）：每月「电费 vs 水费」分组柱状。主题自适应、响应式。
 */
import { ref, watch } from 'vue';
import type { EChartsOption } from 'echarts';
import { useECharts, type ChartPalette } from '@/composables/useECharts';

const props = defineProps<{
  months: string[];
  electricity: number[];
  water: number[];
}>();

const el = ref<HTMLElement | null>(null);

function build(p: ChartPalette): EChartsOption {
  return {
    color: [p.electricity, p.water],
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: p.surface,
      borderColor: p.splitLine,
      textStyle: { color: p.text },
      valueFormatter: (v) => (typeof v === 'number' ? `¥${v.toFixed(2)}` : String(v)),
    },
    legend: {
      data: ['电费', '水费'],
      top: 0,
      textStyle: { color: p.textSecondary },
      itemWidth: 14,
      itemHeight: 8,
    },
    grid: { left: 4, right: 12, top: 36, bottom: 4, containLabel: true },
    xAxis: {
      type: 'category',
      data: props.months,
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
        type: 'bar',
        data: props.electricity,
        itemStyle: { color: p.electricity, borderRadius: [4, 4, 0, 0] },
        barMaxWidth: 22,
      },
      {
        name: '水费',
        type: 'bar',
        data: props.water,
        itemStyle: { color: p.water, borderRadius: [4, 4, 0, 0] },
        barMaxWidth: 22,
      },
    ],
  };
}

const { render } = useECharts(el, build);

watch(
  () => [props.months, props.electricity, props.water],
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

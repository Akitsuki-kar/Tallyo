<script setup lang="ts">
/**
 * 费用构成饼图（Phase 4）：所选月份电费 vs 水费占比。中心显示合计金额。主题自适应、响应式。
 */
import { ref, watch } from 'vue';
import type { EChartsOption } from 'echarts';
import { useECharts, type ChartPalette } from '@/composables/useECharts';

const props = defineProps<{
  electricity: number;
  water: number;
  /** 饼图标题（如「2026-08 费用构成」） */
  title?: string;
}>();

const el = ref<HTMLElement | null>(null);

function build(p: ChartPalette): EChartsOption {
  const total = props.electricity + props.water;
  const hasData = total > 0;
  return {
    tooltip: {
      trigger: 'item',
      backgroundColor: p.surface,
      borderColor: p.splitLine,
      textStyle: { color: p.text },
      formatter: '{b}: ¥{c} ({d}%)',
    },
    title: hasData
      ? {
          text: `¥${total.toFixed(2)}`,
          subtext: '合计',
          left: 'center',
          top: '38%',
          textStyle: { color: p.text, fontSize: 18, fontWeight: 700 },
          subtextStyle: { color: p.textSecondary, fontSize: 12 },
        }
      : undefined,
    legend: {
      bottom: 0,
      textStyle: { color: p.textSecondary },
      itemWidth: 12,
      itemHeight: 12,
    },
    series: [
      {
        name: '费用构成',
        type: 'pie',
        radius: ['46%', '70%'],
        center: ['50%', '46%'],
        avoidLabelOverlap: true,
        label: { color: p.text, formatter: '{b}\n{d}%', fontSize: 12 },
        labelLine: { lineStyle: { color: p.axisLine } },
        data: [
          { name: '电费', value: props.electricity, itemStyle: { color: p.electricity } },
          { name: '水费', value: props.water, itemStyle: { color: p.water } },
        ],
      },
    ],
  };
}

const { render } = useECharts(el, build);

watch(
  () => [props.electricity, props.water, props.title],
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

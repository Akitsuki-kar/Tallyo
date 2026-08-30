/**
 * ECharts 封装（architecture.md §20 / T07 Phase 4）。
 *
 * 设计目标：
 * - 统一内存管理：组件挂载时 init、卸载时 dispose，避免 SPA 切换路由后图表实例泄漏。
 * - 主题自适应：运行时读取 document 上的 --sdb-* CSS 变量作为调色板，浅色/深色主题切换
 *   （THEME_CHANGED 事件）时自动重绘，图表配色始终与 App 暖色生活风一致。
 * - 响应式：容器尺寸变化（ResizeObserver）与窗口 resize 时自动 resize，适配手机/PC 两种布局。
 * - 纯展示：本 composable 只负责「挂载一个图表并随调色板/resize 重绘」，
 *   具体 option 由调用方通过 build(palette) 工厂提供，数据变化由调用方 watch 后调用 render()。
 */
import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';
import { use, init, type ECharts } from 'echarts/core';
import { LineChart, BarChart, PieChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsOption } from 'echarts';
import { eventBus, EVENTS } from '@/utils/eventBus';

// 按需注册：仅引入项目实际使用的图表类型与组件，避免全量打包（~1MB → ~200KB）
use([
  LineChart,
  BarChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  CanvasRenderer,
]);

/** 图表调色板（与 src/styles/variables.css 的 --sdb-* 对齐） */
export interface ChartPalette {
  primary: string;
  primaryLight: string;
  accent: string;
  text: string;
  textSecondary: string;
  surface: string;
  bg: string;
  success: string;
  warning: string;
  danger: string;
  /** 电费专属色（暖橘），与 --sdb-electricity 对齐 */
  electricity: string;
  /** 水费专属色（海蓝），与 --sdb-water 对齐 */
  water: string;
  /** 坐标轴线与分割线（半透明，深浅主题通用） */
  axisLine: string;
  splitLine: string;
}

const FALLBACK: ChartPalette = {
  primary: '#ef7a2e',
  primaryLight: '#f6c79a',
  accent: '#f4d27a',
  text: '#473a2f',
  textSecondary: '#857668',
  surface: '#fbf7f2',
  bg: '#f5efe6',
  success: '#5aa83f',
  warning: '#d9a23a',
  danger: '#c8442f',
  electricity: '#ef7a2e',
  water: '#2f7fd1',
  axisLine: 'rgba(133,118,104,0.35)',
  splitLine: 'rgba(133,118,104,0.15)',
};

function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** 读取当前主题的调色板（深色主题下 --sdb-* 已被 [data-theme="dark"] 覆盖，故自动取深色值） */
export function readPalette(): ChartPalette {
  return {
    primary: cssVar('--sdb-primary', FALLBACK.primary),
    primaryLight: cssVar('--sdb-primary-light', FALLBACK.primaryLight),
    accent: cssVar('--sdb-accent', FALLBACK.accent),
    text: cssVar('--sdb-text', FALLBACK.text),
    textSecondary: cssVar('--sdb-text-secondary', FALLBACK.textSecondary),
    surface: cssVar('--sdb-surface', FALLBACK.surface),
    bg: cssVar('--sdb-bg', FALLBACK.bg),
    success: cssVar('--sdb-success', FALLBACK.success),
    warning: cssVar('--sdb-warning', FALLBACK.warning),
    danger: cssVar('--sdb-danger', FALLBACK.danger),
    electricity: cssVar('--sdb-electricity', FALLBACK.electricity),
    water: cssVar('--sdb-water', FALLBACK.water),
    axisLine: FALLBACK.axisLine,
    splitLine: FALLBACK.splitLine,
  };
}

export type BuildOption = (palette: ChartPalette) => EChartsOption;

/**
 * 在 elRef 指向的 DOM 上挂载一个 ECharts 实例。
 * @param elRef   图表容器 ref（须有显式宽高，建议 CSS 设 min-height）
 * @param build   根据调色板生成 EChartsOption 的工厂
 */
export function useECharts(elRef: Ref<HTMLElement | null>, build: BuildOption) {
  let chart: ECharts | null = null;
  let ro: ResizeObserver | null = null;
  let offTheme: (() => void) | null = null;
  let onWinResize: (() => void) | null = null;
  let onVisibility: (() => void) | null = null;
  const ready = ref(false);

  /** 用当前调色板与数据重绘（notMerge=true 完全替换，避免主题切换后残留旧颜色） */
  function render(): void {
    if (!chart) return;
    chart.setOption(build(readPalette()), true);
  }

  onMounted(() => {
    if (!elRef.value) return;
    chart = init(elRef.value, undefined, { renderer: 'canvas' });
    render();
    ready.value = true;

    if (typeof ResizeObserver !== 'undefined') {
      // 后台冻结：页面隐藏时跳过 resize，避免无谓的 canvas 重绘（省电）
      ro = new ResizeObserver(() => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        chart?.resize();
      });
      ro.observe(elRef.value);
    }
    onWinResize = () => chart?.resize();
    window.addEventListener('resize', onWinResize);
    // 主题切换时重绘（浅色↔深色），保证图表配色与 App 一致
    offTheme = eventBus.on(EVENTS.THEME_CHANGED, render);
    // 回到前台：补一次 resize + 重绘（后台期间跳过的尺寸变更在此生效）
    onVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        chart?.resize();
        render();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
  });

  onBeforeUnmount(() => {
    ro?.disconnect();
    ro = null;
    if (onWinResize) window.removeEventListener('resize', onWinResize);
    if (onVisibility) document.removeEventListener('visibilitychange', onVisibility);
    offTheme?.();
    chart?.dispose();
    chart = null;
  });

  return { render, ready };
}

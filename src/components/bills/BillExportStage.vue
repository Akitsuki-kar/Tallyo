<script setup lang="ts">
/**
 * 账单 PDF 导出舞台（离屏渲染）
 *
 * 设计目标：导出的 PDF 内容 **只有用户选择的模板小票本身**，小票按 A4 满宽
 * 等比放大铺满第一页——而不是「小票 + 补足空白纸底」的整张控件图（那种结果
 * 保存起来割裂感强）。
 *
 * 实现思路：
 * 1. 离屏渲染选中的模板，先按基准宽度量出它自身的设计宽度与高度；
 *    （minimal 模板没有 max-width，需要这个基准宽度才有确定尺寸）
 * 2. 导出时直接捕获 **模板根元素**（小票），由 pdf.ts 按 A4 满宽放置：
 *    比例接近 A4 的模板（如 420×594 / 280×396）正好铺满第一页；
 *    高度不足的模板顶部对齐、下方留白，内容不会被拉伸变形。
 *
 * 注意：离屏必须用 position:fixed + 负偏移，不能用 display:none / visibility:hidden，
 * html2canvas-pro 无法正确捕获未参与布局的元素。
 */
import { nextTick, ref } from 'vue';
import type { Bill, BillTemplateId } from '@/types';
import { exportPageToPdf } from '@/utils/pdf';
import ReceiptTemplate from './templates/ReceiptTemplate.vue';
import MinimalTemplate from './templates/MinimalTemplate.vue';
import CardTemplate from './templates/CardTemplate.vue';
import ReportTemplate from './templates/ReportTemplate.vue';

const props = defineProps<{
  bill: Bill;
  premiseName: string;
  templateId: BillTemplateId;
}>();

const TEMPLATES = {
  receipt: ReceiptTemplate,
  minimal: MinimalTemplate,
  card: CardTemplate,
  report: ReportTemplate,
} as const;

/** 测量基准宽度：给「无 max-width」的模板一个确定尺寸 */
const MEASURE_W = 420;

const contentRef = ref<HTMLElement | null>(null);
/** 模板自然宽度（测量后回填，使纸精确贴合模板，避免左右留白） */
const tplW = ref(MEASURE_W);

/**
 * 量取模板自身的设计尺寸。
 * 先用基准宽度渲染一次拿到真实宽度，再把渲染宽度收敛到该宽度——
 * 各模板（固定宽度 / max-width / 无限制）在收敛后宽度都不再变化，因此不会抖动。
 */
async function measure(): Promise<void> {
  tplW.value = MEASURE_W;
  await nextTick();
  const root = contentRef.value?.firstElementChild as HTMLElement | undefined;
  if (!root) return;
  const w = root.offsetWidth;
  // 量不到（极端字体/渲染时序）时退回基准宽度，绝不把纸宽设成 0
  tplW.value = w > 0 ? w : MEASURE_W;
  await nextTick();
}

/** 供父组件调用：测量 → 捕获模板小票 → 导出 PDF */
async function exportPdf(filename: string): Promise<void> {
  await measure();
  // 等待宽度收敛应用后再捕获，否则拿到的是收敛前的尺寸
  await nextTick();
  const root = contentRef.value?.firstElementChild as HTMLElement | undefined;
  if (!root) throw new Error('导出舞台未就绪，请重试');
  await exportPageToPdf(root, filename);
}

defineExpose({ exportPdf });
</script>

<template>
  <!-- 离屏但真实参与布局：fixed + 负偏移移出视口（不可用 display:none） -->
  <div class="bill-export-stage" aria-hidden="true">
    <!-- 内容列：宽度由测量结果驱动，flex:none 防止被压缩 -->
    <div ref="contentRef" class="bill-export-stage__content" :style="{ width: `${tplW}px` }">
      <component
        :is="TEMPLATES[props.templateId]"
        :bill="props.bill"
        :premise-name="props.premiseName"
      />
    </div>
  </div>
</template>

<style scoped>
.bill-export-stage {
  position: fixed;
  top: 0;
  left: -10000px;
  z-index: -1;
  pointer-events: none;
}

/* 内容列：宽度由测量结果驱动，flex:none 防止被压缩 */
.bill-export-stage__content {
  flex: none;
}
/* minimal 模板没有 width/max-width，靠内容列给定确定宽度，
   否则其自然宽度会随文案长度浮动，导致同一账单每次导出的纸宽不一致 */
.bill-export-stage__content :deep(.bill-minimal) {
  width: 100%;
}
</style>

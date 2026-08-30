<script setup lang="ts">
/**
 * 月初账单弹层（0.1.1 功能 5）
 *
 * 每月 1 号启动时自动弹出上月结算单，按用户默认账单模板渲染，带小票打印特效。
 * 交互脚本（已确认原型：docs/prototypes/receipt-print-prototype.html）：
 *   ① 打印机停在屏幕底部，小票从出纸口缓慢吐出（约 1.9s）
 *   ② 吐完浮现「打印 PDF」「关闭」
 *   ③ 点「打印 PDF」：小票**底部**（贴着出纸口的那一端）生成锯齿撕边、打印机淡出、
 *      小票平移到屏幕正中并轻微放大；同时后台导出 PDF
 *   ④「关闭」全程保留并在撕下后下移到屏底，避免遮挡居中的单据、把用户卡在此页
 *
 * 尺寸自适应：模板本身宽高不一（小票 280 / 卡片 380 / 报表 420，报表还可能很长），
 * 挂载后测量真实高度，按「可用高度」算一个 ≤1 的缩放系数，保证再长的单据也吐得完、不顶出屏幕。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { showToast } from 'vant';
import type { Bill, BillTemplateId } from '@/types';
import { formatMonthLabel } from '@/utils/dayjs';
import { logger } from '@/utils/logger';
import BillExportStage from './BillExportStage.vue';
import ReceiptTemplate from './templates/ReceiptTemplate.vue';
import MinimalTemplate from './templates/MinimalTemplate.vue';
import CardTemplate from './templates/CardTemplate.vue';
import ReportTemplate from './templates/ReportTemplate.vue';

const props = defineProps<{
  bill: Bill;
  premiseName: string;
  templateId: BillTemplateId;
}>();
const emit = defineEmits<{ close: [] }>();

const TEMPLATES = {
  receipt: ReceiptTemplate,
  minimal: MinimalTemplate,
  card: CardTemplate,
  report: ReportTemplate,
} as const;

/** 各模板的纸宽（与模板自身的 width / max-width 对齐，minimal 无限宽给一个居中的舒适值） */
const PAPER_WIDTH: Record<BillTemplateId, number> = {
  receipt: 280,
  minimal: 340,
  card: 380,
  report: 420,
};

/** 打印机高度（与 CSS 中 .mbill__printer 的 height 保持一致） */
const PRINTER_H = 150;
/** 顶部留给说明条的安全区 */
const TOP_SAFE = 76;
/** 撕下居中时的放大系数（轻微，够有「拿到手上」的感觉即可） */
const CENTER_ZOOM = 1.04;

const paperRef = ref<HTMLElement | null>(null);
/** 吐纸完成 */
const fed = ref(false);
/** 已撕下（锯齿边 + 居中） */
const torn = ref(false);
/** 控制条浮现 */
const controlsOn = ref(false);
const exporting = ref(false);
/** 离屏导出舞台：仅导出瞬间挂载，不常驻渲染 */
const exportStageOn = ref(false);
const exportStageRef = ref<InstanceType<typeof BillExportStage> | null>(null);

/** 缩放系数：长单据（报表模板）超出可用高度时整体缩小，保证完整吐出 */
const scale = ref(1);
/** 撕边裁剪路径（撕下后写入） */
const clipPath = ref('');
/** 居中位移（撕下后写入） */
const shift = ref({ x: 0, y: 0 });

const paperWidth = computed(() => PAPER_WIDTH[props.templateId] ?? 320);
const monthLabel = computed(() => formatMonthLabel(props.bill.yearMonth));

/** 减少动效偏好：跳过吐纸过程，直接呈现结果，只保留必要的状态切换 */
const reduceMotion =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 纸张 transform：吐出前压在出纸口下方，吐出后归位，撕下后平移到屏幕正中 */
const paperStyle = computed(() => {
  const s = torn.value ? scale.value * CENTER_ZOOM : scale.value;
  const y = fed.value ? '0px' : '110%';
  const t = torn.value
    ? `translateX(-50%) translate(${shift.value.x}px, ${shift.value.y}px) scale(${s})`
    : `translateX(-50%) translateY(${y}) scale(${s})`;
  return {
    width: `${paperWidth.value}px`,
    transform: t,
    clipPath: clipPath.value || undefined,
  };
});

/**
 * 锯齿撕边：底部像素级细齿 + 确定性微扰（正弦起伏），比等高齿更像手撕断口。
 * 顶部保持平直——撕下的是贴着出纸口的那一端。
 * @param teeth 齿数
 * @param ampPx 齿深基准（px）
 */
function tornClip(teeth: number, ampPx: number): string {
  const pts = ['0% 0%', '100% 0%'];
  for (let i = 0; i <= teeth; i++) {
    const x = (1 - i / teeth) * 100;
    const wobble = Math.sin(i * 1.7) * (ampPx * 0.22);
    const depth = Math.max(2.5, ampPx + wobble);
    const y = i % 2 === 0 ? '100%' : `calc(100% - ${depth.toFixed(1)}px)`;
    pts.push(`${x.toFixed(2)}% ${y}`);
  }
  return `polygon(${pts.join(', ')})`;
}

/** 按可用高度算缩放：可用 = 视口高 − 打印机 − 顶部安全区 */
function fitScale(): void {
  const el = paperRef.value;
  if (!el) return;
  // offsetHeight 不含 transform，正是未缩放的设计高度
  const h = el.offsetHeight;
  if (h <= 0) return;
  const avail = window.innerHeight - PRINTER_H - TOP_SAFE;
  scale.value = avail > 0 && h > avail ? Math.max(0.5, avail / h) : 1;
}

let feedTimer: ReturnType<typeof setTimeout> | undefined;

/** 吐纸：等布局与缩放算好，下一帧再切 fed 触发过渡（同帧切换会被浏览器合并、看不到动画） */
async function feed(): Promise<void> {
  await nextTick();
  fitScale();
  if (reduceMotion) {
    fed.value = true;
    controlsOn.value = true;
    return;
  }
  requestAnimationFrame(() => {
    fed.value = true;
    // 与 CSS 的 1.9s 过渡对齐，吐完再给按钮，避免用户在半截纸时就点打印
    feedTimer = setTimeout(() => {
      controlsOn.value = true;
    }, 1900);
  });
}

/** 点「打印 PDF」：先撕下并居中（视觉即时反馈），再后台导出 PDF */
async function onPrint(): Promise<void> {
  if (!fed.value || torn.value) return;
  tearAndCenter();
  await exportPdf();
}

function tearAndCenter(): void {
  const el = paperRef.value;
  if (!el) return;
  clipPath.value = tornClip(22, 9);

  // 以「吐出状态」的实际矩形为基准算居中位移。
  // transform-origin 是 bottom center，改变 scale 时底边中点不动，
  // 因此放大后的中心 = (底边中点x, 底边中点y − 放大后高度/2)，据此反推位移，居中才准。
  const rect = el.getBoundingClientRect();
  const anchorX = rect.left + rect.width / 2;
  const anchorY = rect.bottom;
  const zoomedH = rect.height * CENTER_ZOOM;
  shift.value = {
    x: window.innerWidth / 2 - anchorX,
    y: window.innerHeight / 2 - (anchorY - zoomedH / 2),
  };
  torn.value = true;
}

async function exportPdf(): Promise<void> {
  exporting.value = true;
  try {
    exportStageOn.value = true;
    await nextTick();
    try {
      await exportStageRef.value?.exportPdf(`水电动账-${props.bill.yearMonth}`);
      showToast('已生成 PDF');
    } finally {
      exportStageOn.value = false;
    }
  } catch (err) {
    // 不静默：导出失败时用户手上没有文件，必须知道
    logger.error('bills:monthly-pop', '月初账单导出 PDF 失败', {
      message: err instanceof Error ? err.message : String(err),
    });
    showToast('导出失败：' + (err instanceof Error ? err.message : String(err)));
  } finally {
    exporting.value = false;
  }
}

function onClose(): void {
  emit('close');
}

/** Esc 关闭：弹层是模态的，键盘用户必须有退出路径 */
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') onClose();
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown);
  void feed();
});
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown);
  if (feedTimer) clearTimeout(feedTimer);
});
</script>

<template>
  <div class="mbill" role="dialog" aria-modal="true" :aria-label="`${monthLabel} 结算单`">
    <div class="mbill__backdrop"></div>

    <!-- 顶部说明条 -->
    <div class="mbill__hint">
      <span class="mbill__hint-t">上月结算单</span>
      <span class="mbill__hint-d">{{ premiseName }} · {{ monthLabel }}</span>
    </div>

    <!-- 小票（内含用户默认模板） -->
    <div
      ref="paperRef"
      class="mbill__paper"
      :class="{ 'is-fed': fed, 'is-torn': torn }"
      :style="paperStyle"
    >
      <component :is="TEMPLATES[props.templateId]" :bill="props.bill" :premise-name="props.premiseName" />
    </div>

    <!-- 打印机（撕下后淡出） -->
    <div class="mbill__printer" :class="{ 'is-hidden': torn }" aria-hidden="true">
      <span class="mbill__slot"></span>
      <span class="mbill__brand">SDB PRINT</span>
      <span class="mbill__led"></span>
    </div>

    <!-- 控制条：撕下后隐藏「打印 PDF」、下移「关闭」以免遮挡居中的单据 -->
    <div class="mbill__controls" :class="{ 'is-on': controlsOn, 'is-lowered': torn }">
      <button
        v-if="!torn"
        class="mbill__btn mbill__btn--primary"
        type="button"
        :disabled="exporting"
        @click="onPrint"
      >
        {{ exporting ? '生成中…' : '打印 PDF' }}
      </button>
      <button class="mbill__btn mbill__btn--ghost" type="button" @click="onClose">关闭</button>
    </div>

    <!-- PDF 导出舞台：离屏，仅导出瞬间挂载 -->
    <BillExportStage
      v-if="exportStageOn"
      ref="exportStageRef"
      :bill="props.bill"
      :premise-name="props.premiseName"
      :template-id="props.templateId"
    />
  </div>
</template>

<style scoped>
.mbill {
  position: fixed;
  inset: 0;
  z-index: 2500; /* 高于撤销条(2000)，低于 Vant toast */
  overflow: hidden;
}
.mbill__backdrop {
  position: absolute;
  inset: 0;
  background: oklch(from var(--sdb-text) l c h / 0.42);
  backdrop-filter: blur(2px);
}

/* ---- 顶部说明条 ---- */
.mbill__hint {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: calc(14px + env(safe-area-inset-top)) 16px 12px;
  text-align: center;
  color: var(--sdb-on-primary);
  text-shadow: 0 1px 4px oklch(from var(--sdb-text) l c h / 0.5);
}
.mbill__hint-t {
  font-family: var(--sdb-font-hand);
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.mbill__hint-d {
  font-size: var(--sdb-text-xs);
  opacity: 0.85;
}

/* ---- 小票 ---- */
.mbill__paper {
  position: absolute;
  left: 50%;
  /* 底边贴住出纸口（打印机高 150，槽在顶部 -3px） */
  bottom: 147px;
  z-index: 2;
  transform-origin: bottom center;
  will-change: transform;
  box-shadow: 0 6px 18px oklch(from var(--sdb-text) l c h / 0.16);
  transition:
    transform 1.9s cubic-bezier(0.22, 0.61, 0.36, 1),
    box-shadow 0.4s var(--sdb-ease-out);
}
/* 撕下后的位移用更短的时长，动作要利落 */
.mbill__paper.is-torn {
  transition:
    transform 1.1s cubic-bezier(0.22, 0.61, 0.36, 1),
    box-shadow 0.5s var(--sdb-ease-out);
  box-shadow: 0 24px 60px oklch(from var(--sdb-text) l c h / 0.34);
}
/* 让无固定宽度的模板（minimal）撑满纸宽，否则纸宽与内容宽对不上 */
.mbill__paper :deep(.bill-minimal),
.mbill__paper :deep(.bill-card-tpl),
.mbill__paper :deep(.bill-report),
.mbill__paper :deep(.bill-receipt) {
  width: 100%;
  max-width: 100%;
  margin: 0;
}

/* ---- 打印机 ---- */
.mbill__printer {
  position: absolute;
  left: 50%;
  bottom: 0;
  transform: translateX(-50%);
  width: min(360px, 92vw);
  height: 150px;
  z-index: 3;
  background: linear-gradient(180deg, var(--sdb-surface), var(--sdb-surface-2));
  border: 1px solid var(--sdb-border);
  border-bottom: none;
  border-radius: 18px 18px 0 0;
  box-shadow: 0 -10px 30px oklch(from var(--sdb-text) l c h / 0.18);
  transition: opacity 0.45s var(--sdb-ease-out);
}
.mbill__printer.is-hidden {
  opacity: 0;
  pointer-events: none;
}
.mbill__slot {
  position: absolute;
  left: 50%;
  top: -3px;
  transform: translateX(-50%);
  width: 82%;
  height: 8px;
  border-radius: 6px;
  background: linear-gradient(180deg, var(--sdb-text-secondary), var(--sdb-text));
  box-shadow: inset 0 2px 3px oklch(from var(--sdb-text) l c h / 0.55);
}
.mbill__brand {
  position: absolute;
  left: 18px;
  bottom: 18px;
  font-size: var(--sdb-text-xs);
  font-weight: 700;
  letter-spacing: 0.16em;
  color: var(--sdb-text-tertiary);
}
.mbill__led {
  position: absolute;
  right: 20px;
  bottom: 20px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--sdb-primary);
  box-shadow: 0 0 8px var(--sdb-primary);
  animation: mbill-blink 1.4s infinite;
}
@keyframes mbill-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

/* ---- 控制条 ---- */
.mbill__controls {
  position: absolute;
  left: 50%;
  bottom: 168px;
  transform: translateX(-50%);
  z-index: 4;
  display: flex;
  gap: 10px;
  opacity: 0;
  pointer-events: none;
  transition:
    opacity 0.4s var(--sdb-ease-out),
    bottom 0.45s var(--sdb-ease-out);
}
.mbill__controls.is-on {
  opacity: 1;
  pointer-events: auto;
}
/* 撕下后单据居中，控制条下移到屏底，避免压住单据 */
.mbill__controls.is-lowered {
  bottom: calc(20px + env(safe-area-inset-bottom));
}
.mbill__btn {
  border: none;
  cursor: pointer;
  font-family: inherit;
  font-size: var(--sdb-text-sm);
  font-weight: 700;
  padding: 10px 18px;
  border-radius: var(--sdb-radius-pill);
  box-shadow: var(--sdb-shadow);
}
.mbill__btn--primary {
  background: var(--sdb-primary);
  color: var(--sdb-on-primary);
}
.mbill__btn--ghost {
  background: var(--sdb-surface);
  color: var(--sdb-text);
  border: 1px solid var(--sdb-border);
}
.mbill__btn:active {
  transform: translateY(1px);
}
.mbill__btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* 降低动效偏好：不做吐纸/位移过渡，直接到位 */
@media (prefers-reduced-motion: reduce) {
  .mbill__paper,
  .mbill__paper.is-torn,
  .mbill__printer,
  .mbill__controls {
    transition: none;
  }
  .mbill__led {
    animation: none;
  }
}
</style>

<script setup lang="ts">
/**
 * 交互式引导 Tour（聚光灯高亮 + 气泡提示）
 *
 * 实现：
 * - spotlight 盒子定位到目标元素 rect，用超大 box-shadow 遮暗其余区域
 * - 气泡卡片跟随 spotlight 上下摆放（空间不足自动翻转，水平方向钳制在视口内）
 * - 监听 resize/scroll 实时重算位置；目标不存在时自动跳过该步
 *
 * 约束：仅 transform/opacity 动效；z-index 低于 OnboardingFlow(100)，高于 TabBar(20)。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

export interface TourStep {
  selector: string; // 目标元素 CSS 选择器（找不到则自动跳过该步）
  title: string;
  text: string;
}

const props = defineProps<{ steps: TourStep[] }>();
const emit = defineEmits<{ (e: 'finish'): void }>();

const index = ref(0);
const spot = ref<{ top: number; left: number; width: number; height: number } | null>(null);
const tip = ref<{ top: number; left: number; above: boolean; arrowX: number } | null>(null);

const current = computed(() => props.steps[index.value]);
const isLast = computed(() => index.value === props.steps.length - 1);

/** 重算聚光灯与气泡位置（目标未就绪时短暂重试，避免渲染间隙误跳步） */
async function updatePosition(retry = true): Promise<void> {
  const step = props.steps[index.value];
  if (!step) {
    spot.value = null;
    tip.value = null;
    return;
  }
  const el = document.querySelector(step.selector);
  if (!el) {
    if (retry) {
      // 目标可能尚未挂载（路由切换/懒加载间隙），300ms 后重试一次
      await new Promise((r) => setTimeout(r, 300));
      return updatePosition(false);
    }
    // 重试后仍不存在（布局差异）→ 自动跳到下一步
    advance(true);
    return;
  }
  const r = el.getBoundingClientRect();
  const pad = 8; // 高亮外扩留白
  spot.value = {
    top: r.top - pad,
    left: r.left - pad,
    width: r.width + pad * 2,
    height: r.height + pad * 2,
  };
  await nextTick();
  positionTip();
}

/** 气泡摆放：优先在聚光灯下方，空间不足翻到上方；水平钳制在视口内 */
function positionTip(): void {
  if (!spot.value) return;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const tipW = Math.min(320, vw - 32);
  const tipH = 150; // 估算高度（含内边距与按钮）

  const centerX = spot.value.left + spot.value.width / 2;
  const left = Math.min(Math.max(centerX - tipW / 2, 16), vw - tipW - 16);

  // 气泡优先放聚光灯下方（above=false）；下方空间不足才翻到上方（above=true）
  const fitsBelow = spot.value.top + spot.value.height + 12 + tipH < vh;
  const above = !fitsBelow;
  const top = above
    ? Math.max(spot.value.top - 12 - tipH, 16)
    : spot.value.top + spot.value.height + 12;

  // 箭头横向位置：跟随聚光灯中心（相对气泡钳制在安全范围）
  const arrowX = Math.min(Math.max(centerX - left, 24), tipW - 24);

  tip.value = { top, left, above, arrowX };
}

function advance(auto = false): void {
  if (isLast.value && !auto) {
    emit('finish');
    return;
  }
  if (index.value < props.steps.length - 1) {
    index.value += 1;
  } else {
    // 最后一步仍找不到目标：直接结束
    emit('finish');
  }
}

function onSkip(): void {
  emit('finish');
}

watch(index, () => {
  void updatePosition();
});

watch(
  () => props.steps,
  () => {
    void updatePosition();
  },
);

const onReposition = (): void => {
  void updatePosition();
};

onMounted(() => {
  void updatePosition();
  window.addEventListener('resize', onReposition);
  window.addEventListener('scroll', onReposition, true);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', onReposition);
  window.removeEventListener('scroll', onReposition, true);
});
</script>

<template>
  <div v-if="current" class="tour" role="dialog" aria-label="功能导览">
    <!-- 聚光灯：目标高亮盒，超大阴影遮暗其余区域（点击空白处下一步） -->
    <div
      v-if="spot"
      class="tour__spot"
      :style="{
        top: `${spot.top}px`,
        left: `${spot.left}px`,
        width: `${spot.width}px`,
        height: `${spot.height}px`,
      }"
      @click="advance()"
    />
    <!-- 全屏遮罩兜底（spot 未就绪时也能跳过） -->
    <div v-else class="tour__fallback" @click="advance()" />

    <!-- 气泡提示卡 -->
    <Transition name="tour-tip">
      <div
        v-if="tip && current"
        class="tour__tip"
        :class="{ 'is-above': tip.above }"
        :style="{ top: `${tip.top}px`, left: `${tip.left}px`, '--tour-arrow-x': `${tip.arrowX}px` }"
      >
        <div class="tour__tip-head">
          <strong class="tour__tip-title">{{ current.title }}</strong>
          <span class="tour__tip-step">{{ index + 1 }} / {{ steps.length }}</span>
        </div>
        <p class="tour__tip-text">{{ current.text }}</p>
        <div class="tour__tip-actions">
          <button class="tour__tip-skip" type="button" @click="onSkip">跳过导览</button>
          <button class="sdb-btn sdb-btn--primary tour__tip-next" type="button" @click="advance()">
            {{ isLast ? '完成' : '下一步' }}
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.tour {
  position: fixed;
  inset: 0;
  z-index: 60; /* 高于 TabBar(20)/顶栏(10)，低于 OnboardingFlow(100) */
}
.tour__spot {
  position: absolute;
  border-radius: var(--sdb-radius);
  box-shadow: 0 0 0 200vmax oklch(32% 0.026 50 / 0.55); /* 遮暗其余区域 */
  border: 2px solid var(--sdb-primary);
  transition:
    top var(--sdb-dur) var(--sdb-ease-out),
    left var(--sdb-dur) var(--sdb-ease-out),
    width var(--sdb-dur) var(--sdb-ease-out),
    height var(--sdb-dur) var(--sdb-ease-out);
  cursor: pointer;
}
.tour__fallback {
  position: absolute;
  inset: 0;
  background: oklch(32% 0.026 50 / 0.55);
  cursor: pointer;
}

/* ---- 气泡卡片（便签风格） ---- */
.tour__tip {
  position: absolute;
  width: min(320px, calc(100vw - 32px));
  background: var(--sdb-surface);
  background-image: var(--sdb-paper);
  border: 1px solid var(--sdb-border);
  border-radius: var(--sdb-radius);
  box-shadow: var(--sdb-shadow-lg);
  padding: var(--sdb-space-4);
}
/* 默认（气泡在聚光灯下方）：箭头在气泡顶部，指向上方的聚光灯 */
.tour__tip::after {
  content: '';
  position: absolute;
  top: -8.5px;
  left: var(--tour-arrow-x, 50%);
  width: 14px;
  height: 14px;
  background: var(--sdb-surface);
  border-left: 1px solid var(--sdb-border);
  border-top: 1px solid var(--sdb-border);
  transform: translateX(-50%) rotate(45deg);
}
/* 气泡在聚光灯上方：箭头翻到底部，指向下方的聚光灯 */
.tour__tip.is-above::after {
  top: auto;
  bottom: -8.5px;
  border: none;
  border-right: 1px solid var(--sdb-border);
  border-bottom: 1px solid var(--sdb-border);
}
.tour__tip-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}
.tour__tip-title {
  font-size: var(--sdb-text-base);
  font-weight: 700;
  color: var(--sdb-text);
}
.tour__tip-step {
  font-size: var(--sdb-text-xs);
  color: var(--sdb-text-tertiary);
  font-variant-numeric: tabular-nums;
}
.tour__tip-text {
  margin: 0 0 var(--sdb-space-3);
  font-size: var(--sdb-text-sm);
  line-height: 1.7;
  color: var(--sdb-text-secondary);
}
.tour__tip-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.tour__tip-skip {
  border: none;
  background: transparent;
  color: var(--sdb-text-tertiary);
  font-family: var(--sdb-font-rounded);
  font-size: var(--sdb-text-sm);
  padding: 8px 10px;
  cursor: pointer;
  transition: color var(--sdb-dur) var(--sdb-ease-out);
}
.tour__tip-skip:hover {
  color: var(--sdb-text-secondary);
}
.tour__tip-next {
  min-height: 38px;
  padding: 0 18px;
  font-size: var(--sdb-text-sm);
}

/* ---- 气泡过渡（仅 transform/opacity） ---- */
.tour-tip-enter-active {
  transition:
    opacity var(--sdb-dur) var(--sdb-ease-out),
    transform var(--sdb-dur) var(--sdb-ease-out);
}
.tour-tip-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
</style>

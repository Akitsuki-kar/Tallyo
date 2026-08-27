<script setup lang="ts">
/**
 * 全局顶栏。
 *
 * 双模式：
 * 1. Windows 原生壳（Tauri + Windows UA）：自绘标题栏，**完整替代系统原生标题栏**
 *    ——整条空白区可拖拽（data-tauri-drag-region，双击自动最大化），右侧提供真实有效的
 *    最小化/最大化(还原)/关闭按钮；最大化状态随窗口事件同步图标。
 *    权限由 capabilities/desktop.json 授权（core:window:allow-{minimize,toggle-maximize,close,start-dragging}），
 *    缺失时按钮静默降级为无响应（Web 构建永不调用）。
 * 2. 其余环境（Web PWA / 移动端 Tauri / 非 Windows 桌面）：普通极简条，可选返回/标题/插槽。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { isTauriShell } from '@/utils/platform';

const props = withDefaults(
  defineProps<{
    title?: string;
    showBack?: boolean;
  }>(),
  {
    title: '',
    showBack: false,
  },
);

const emit = defineEmits<{ (e: 'back'): void }>();

function onBack(): void {
  emit('back');
}

// 是否自绘标题栏：仅 Windows 桌面 Tauri（macOS/Linux 未适配自绘，保持原生外观；移动端/Web 不显示窗口按钮）。
const isWindowsShell = computed(
  () => isTauriShell() && /Windows/i.test(navigator.userAgent || ''),
);

const maximized = ref(false);
let unlistenResize: (() => void) | null = null;

/** 窗口控制：最小化 / 切换最大化 / 关闭。仅在 Windows 原生壳执行。 */
async function winAction(kind: 'min' | 'max' | 'close'): Promise<void> {
  if (!isWindowsShell.value) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    if (kind === 'min') {
      await win.minimize();
    } else if (kind === 'max') {
      await win.toggleMaximize();
      maximized.value = await win.isMaximized();
    } else {
      await win.close();
    }
  } catch {
    /* 权限缺失或调用失败时静默降级（Web 构建永不进入此分支） */
  }
}

onMounted(async () => {
  if (!isWindowsShell.value) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    maximized.value = await win.isMaximized();
    // 同步最大化状态：双击标题栏 / 拖拽到屏幕边缘最大化后，按钮图标保持一致
    unlistenResize = await win.onResized(() => {
      void win.isMaximized().then((v) => {
        maximized.value = v;
      });
    });
  } catch {
    /* 非原生壳或权限缺失时静默 */
  }
});

onBeforeUnmount(() => {
  unlistenResize?.();
  unlistenResize = null;
});
</script>

<template>
  <header class="sdb-header" :class="{ 'sdb-header--titlebar': isWindowsShell }">
    <!-- Windows 自绘标题栏：整条空白区可拖拽；右侧 = 主题插槽 + 窗口控制 -->
    <template v-if="isWindowsShell">
      <div class="sdb-header__drag" data-tauri-drag-region="" aria-hidden="true"></div>
      <div class="sdb-header__actions">
        <slot name="actions" />
        <button class="sdb-winbtn" type="button" aria-label="最小化" @click="winAction('min')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12" /></svg>
        </button>
        <button
          class="sdb-winbtn"
          type="button"
          :aria-label="maximized ? '还原窗口' : '最大化窗口'"
          @click="winAction('max')"
        >
          <svg v-if="maximized" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="8" y="8" width="11" height="11" rx="1" />
            <path d="M5 15V6a1 1 0 0 1 1-1h9" />
          </svg>
          <svg v-else viewBox="0 0 24 24" aria-hidden="true">
            <rect x="5" y="5" width="14" height="14" rx="1" />
          </svg>
        </button>
        <button class="sdb-winbtn sdb-winbtn--close" type="button" aria-label="关闭" @click="winAction('close')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
        </button>
      </div>
    </template>

    <!-- 其他环境：普通极简条（可选返回 / 标题 / 插槽） -->
    <template v-else>
      <button v-if="showBack" class="sdb-header__back" type="button" aria-label="返回" @click="onBack">‹</button>
      <h1 v-if="props.title" class="sdb-header__title">{{ props.title }}</h1>
      <div class="sdb-header__actions">
        <slot name="actions" />
      </div>
    </template>
  </header>
</template>

<style scoped>
.sdb-header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: var(--sdb-header-h);
  padding: 0 16px;
  flex: none; /* flex 列布局中顶栏固定不伸缩，主内容区独占剩余高度滚动 */
  /* 透明极简条：不显示品牌文字，仅承载主题按钮 / 桌面窗口控制；
   * 各页面用自身的 .sdb-page-title 自标题。 */
  background: transparent;
  color: var(--sdb-text);
}
.sdb-header__title {
  font-size: 19px;
  font-weight: 700;
  letter-spacing: 0.02em;
  margin: 0;
  flex: 1;
  color: var(--sdb-text);
}
.sdb-header__back {
  background: transparent;
  border: none;
  color: var(--sdb-text);
  font-size: 26px;
  line-height: 1;
  cursor: pointer;
}
.sdb-header__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
/* 桌面（非 Windows 标题栏模式）：顶栏与主内容区外缘对齐，四角圆润浮动卡片 */
@media (min-width: 768px) {
  .sdb-header {
    margin: 0 auto;
    max-width: calc(var(--sdb-maxw-md) + 2 * var(--sdb-space-5));
    height: 60px;
    padding: 0 20px;
    border-radius: var(--sdb-radius-lg);
  }
  .sdb-header__title {
    font-size: 20px;
  }
}
@media (min-width: 1024px) {
  .sdb-header {
    max-width: calc(var(--sdb-maxw-lg) + 2 * var(--sdb-space-5));
  }
}

/* ---- Windows 自绘标题栏：齐顶铺满、毛玻璃纸感、整条空白可拖拽 ---- */
.sdb-header--titlebar {
  margin: 0;
  max-width: none;
  border-radius: 0;
  height: 40px;
  min-height: 40px;
  padding: 0;
  gap: 0;
  /* 半透明暖纸 + 背景模糊：内容滚动时呈现「毛玻璃标题栏」，贴近 Windows 原生质感 */
  background: color-mix(in oklch, var(--sdb-bg) 88%, transparent);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--sdb-border);
}
/* 拖拽区：占据整条空白，非交互元素（Tauri 拖拽区域不能是按钮/输入等交互控件） */
.sdb-header--titlebar .sdb-header__drag {
  flex: 1;
  align-self: stretch;
  cursor: default;
}
.sdb-header--titlebar .sdb-header__actions {
  gap: 2px;
  padding-right: 4px;
}
.sdb-header--titlebar :deep(.sdb-header__btn) {
  width: 40px;
  height: 40px;
  border-radius: 8px;
}
.sdb-header--titlebar :deep(.sdb-header__btn:hover) {
  background: var(--sdb-surface-2);
}

/* 原生窗口控制按钮（仅 Windows 自绘标题栏渲染；hover 底色、关闭 hover 红） */
.sdb-winbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 40px;
  margin-left: 2px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--sdb-text-secondary);
  cursor: pointer;
  transition: background-color var(--sdb-dur) var(--sdb-ease-out);
}
.sdb-winbtn:hover {
  background: var(--sdb-surface-2);
}
.sdb-winbtn--close:hover {
  background: #e5484d;
  color: #fff;
}
.sdb-winbtn svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>

<script setup lang="ts">
// 全局顶栏（暖色），提供标题与右侧操作插槽（如主题切换）。
// 桌面原生壳（Tauri，非移动端）下切换为「自定义标题栏」：顶栏齐顶铺满、标题可拖拽、
// 右侧提供最小化/最大化/关闭按钮，消除系统原生标题栏与软件暖色风格割裂的问题。
import { computed, ref } from 'vue';
import { isTauriShell } from '@/utils/platform';

const props = withDefaults(
  defineProps<{
    title?: string;
    showBack?: boolean;
  }>(),
  {
    title: '水电动账',
    showBack: false,
  },
);

const emit = defineEmits<{ (e: 'back'): void }>();

function onBack(): void {
  emit('back');
}

// 是否渲染原生窗口控制按钮：仅桌面 Tauri（Windows/macOS/Linux）；移动端 Tauri 不显示。
const showWindowControls = computed(
  () => isTauriShell() && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent || ''),
);
const maximized = ref(false);

/** 窗口控制：最小化 / 切换最大化 / 关闭。仅在 Tauri 原生壳内执行，Web 构建永不调用。 */
async function winAction(kind: 'min' | 'max' | 'close'): Promise<void> {
  if (!isTauriShell()) return;
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
    /* 非原生壳或调用失败均静默忽略 */
  }
}
</script>

<template>
  <header class="sdb-header" :class="{ 'sdb-header--titlebar': showWindowControls }">
    <button v-if="showBack" class="sdb-header__back" type="button" aria-label="返回" @click="onBack">‹</button>
    <h1 class="sdb-header__title" data-tauri-drag-region>{{ props.title }}</h1>
    <div class="sdb-header__actions">
      <slot name="actions" />
      <template v-if="showWindowControls">
        <button class="sdb-winbtn" type="button" aria-label="最小化" @click="winAction('min')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12" /></svg>
        </button>
        <button class="sdb-winbtn" type="button" :aria-label="maximized ? '还原窗口' : '最大化窗口'" @click="winAction('max')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="1" /></svg>
        </button>
        <button class="sdb-winbtn sdb-winbtn--close" type="button" aria-label="关闭" @click="winAction('close')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
        </button>
      </template>
    </div>
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
  height: var(--sdb-header-h);
  padding: 0 16px;
  /* 暖橘柔和渐变 + 底部圆角，像一张便签顶条 */
  background: linear-gradient(135deg, var(--sdb-primary), var(--sdb-primary-dark));
  color: var(--sdb-on-primary);
  border-radius: 0 0 var(--sdb-radius) var(--sdb-radius);
  box-shadow: var(--sdb-shadow);
}
.sdb-header__title {
  font-size: 19px;
  font-weight: 700;
  letter-spacing: 0.02em;
  margin: 0;
  flex: 1;
}
.sdb-header__back {
  background: transparent;
  border: none;
  color: var(--sdb-on-primary);
  font-size: 26px;
  line-height: 1;
  cursor: pointer;
}
.sdb-header__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
/* 桌面：顶栏与主内容区外缘对齐（补偿 main 的左右内边距），四角圆润浮动卡片 */
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
/* 桌面 Tauri 自定义标题栏：齐顶铺满窗口，去掉浮动卡片的圆角与左右留白，与窗口融为一体 */
.sdb-header--titlebar {
  margin: 0;
  max-width: none;
  border-radius: 0;
}
/* 原生窗口控制按钮（仅桌面 Tauri 渲染） */
.sdb-winbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  margin-left: 2px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--sdb-on-primary);
  cursor: pointer;
  transition: background-color var(--sdb-dur) var(--sdb-ease-out);
}
.sdb-winbtn:hover {
  background: rgba(255, 255, 255, 0.18);
}
.sdb-winbtn--close:hover {
  background: #e5484d;
}
.sdb-winbtn svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}
</style>

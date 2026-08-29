/**
 * 主题切换 composable（architecture.md §10.5 / D 视觉决策）
 *
 * 三种模式：
 * - 'light'：强制浅色
 * - 'dark'  ：强制深色
 * - 'auto'  ：跟随系统 prefers-color-scheme 媒体查询，自动切换浅/深色
 *
 * 实现要点：
 * - data-theme 属性始终设为 resolved 值（'light' / 'dark'），CSS 变量以此匹配。
 * - localStorage 存储的是用户偏好（'light' / 'dark' / 'auto'），而非 resolved 值。
 * - auto 模式下监听媒体查询变化，系统主题切换时自动重应用并广播 THEME_CHANGED。
 * - 切换 THEME_CHANGED 事件供全局监听（ECharts 重绘等）。
 */
import { eventBus, EVENTS } from '@/utils/eventBus';
import type { ThemeMode } from '@/types';

const STORAGE_KEY = 'sdb:theme';

/** 已 resolved 的主题类型（data-theme 属性的实际值） */
type ResolvedTheme = 'light' | 'dark';

/** MediaQueryList 及监听器（auto 模式下持有，退出 auto 时清理） */
let mql: MediaQueryList | null = null;
let autoHandler: ((e: MediaQueryListEvent) => void) | null = null;

/** 读取系统深色偏好（SSR / 无 matchMedia 时回退浅色） */
function resolveAutoTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** 启动 prefers-color-scheme 媒体查询监听（仅 auto 模式下生效） */
function startAutoListener(): void {
  if (typeof window === 'undefined' || !window.matchMedia) return;
  stopAutoListener(); // 先清理旧监听
  mql = window.matchMedia('(prefers-color-scheme: dark)');
  autoHandler = () => {
    // 仅当用户偏好仍为 auto 时才重应用（可能已被切到 light/dark）
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'auto') {
        const resolved = resolveAutoTheme();
        document.documentElement.setAttribute('data-theme', resolved);
        eventBus.emit(EVENTS.THEME_CHANGED, resolved);
      }
    } catch {
      /* localStorage 不可用时忽略 */
    }
  };
  mql.addEventListener('change', autoHandler);
}

/** 停止媒体查询监听 */
function stopAutoListener(): void {
  if (mql && autoHandler) {
    mql.removeEventListener('change', autoHandler);
  }
  mql = null;
  autoHandler = null;
}

/**
 * 应用主题模式（无响应式依赖，可在任意处调用）。
 * auto 模式下会 resolved 为 light/dark 并启动媒体查询监听；
 * light/dark 模式下会停止监听。
 */
export function applyThemeMode(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const resolved: ResolvedTheme = mode === 'auto' ? resolveAutoTheme() : mode;
  document.documentElement.setAttribute('data-theme', resolved);
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* 忽略存储异常 */
  }
  // auto 模式：启动媒体查询监听；否则停止
  if (mode === 'auto') {
    startAutoListener();
  } else {
    stopAutoListener();
  }
  eventBus.emit(EVENTS.THEME_CHANGED, resolved);
}

/** 读取本地已保存的主题偏好（含 'auto'） */
export function getSavedTheme(): ThemeMode | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'auto') return v;
    return null;
  } catch {
    return null;
  }
}

export function useTheme() {
  function applyTheme(mode: ThemeMode): void {
    applyThemeMode(mode);
  }

  /**
   * 在 light ↔ dark 之间切换（不经过 auto）。
   * @returns 切换后的模式，供调用方落库（见 App.vue onToggleTheme）
   */
  function toggle(): ThemeMode {
    // toggle 在 light ↔ dark 之间切换，不经过 auto
    const current =
      ((typeof document !== 'undefined'
        ? document.documentElement.getAttribute('data-theme')
        : null) as ResolvedTheme) || 'light';
    const next: ThemeMode = current === 'dark' ? 'light' : 'dark';
    applyThemeMode(next);
    return next;
  }

  function setTheme(mode: ThemeMode): void {
    applyThemeMode(mode);
  }

  return { applyTheme, toggle, setTheme };
}

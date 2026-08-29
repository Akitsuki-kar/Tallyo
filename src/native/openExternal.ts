/**
 * 外部链接统一出口（Tauri opener 插件）
 *
 * 问题背景：原生壳（Tauri WebView）里直接写 <a target="_blank"> 不会被系统浏览器接管。
 * Android 侧走 WebChromeClient.onCreateWindow，结果是「在同一个 WebView 内导航」过去——
 * 没有地址栏、没有返回键、回不到 App，正是鸣谢外链在原生壳里表现「怪异」的根因。
 *
 * 解法：
 * - Tauri 运行期：经 tauri-plugin-opener 的 openUrl() 调起系统默认浏览器
 *   （Android = ACTION_VIEW → Chrome Custom Tabs / 默认浏览器；桌面 = 默认浏览器），
 *   离开 App 但可一键返回，最符合系统习惯。
 * - Web 运行期：回退 window.open（新标签）。弹窗被拦截或失败则给出「复制链接」兜底，
 *   保证用户一定能拿到 URL。
 *
 * 同时导出 installExternalLinkInterceptor()：在 document 上做 click 事件委托，
 * 命中 <a href^="http(s)://"> 就 preventDefault 并转本出口。这样全站外链
 * （鸣谢、作者主页等）统一走系统浏览器，无需逐个改造 <a>。
 *
 * 与原生插件约定同 httpTransport.ts / secureKey.ts：
 * - Web 构建把 @tauri-apps/plugin-opener 标为 external（见 vite.config.ts），
 *   且本模块被 isTauriShell() 守卫，浏览器运行期永不执行该 import，web 包保持最精简。
 */
import { isTauriShell } from '@/utils/platform';
import { showToast, showDialog } from 'vant';
import { logger } from '@/utils/logger';

/** 判断是否为外链（http / https 绝对地址） */
function isExternalHref(href: string | null | undefined): href is string {
  if (!href) return false;
  return /^https?:\/\//i.test(href);
}

/** 复制文本到剪贴板（Clipboard API 优先，execCommand 兜底） */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 安全上下文不支持或非 HTTPS，走下方兜底 */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * 打开外部链接：Tauri → 系统浏览器；Web → 新标签；失败 → 复制链接兜底。
 * @param url 目标 URL（应为 http/https）
 */
export async function openExternal(url: string): Promise<void> {
  if (!isExternalHref(url)) {
    logger.warn('[SDB:openExternal]', '非 http(s) 链接被忽略', { url });
    return;
  }

  if (isTauriShell()) {
    try {
      // 字面量 specifier：Tauri 构建期正常打包进原生壳；Web 构建期被 vite 标为外部，
      // 本分支仅 Tauri 运行期经 isTauriShell() 进入，浏览器永不执行该 import。
      const mod = await import('@tauri-apps/plugin-opener');
      await mod.openUrl(url);
      return;
    } catch (err) {
      logger.error('[SDB:openExternal]', '系统浏览器打开失败，回退复制链接', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    // Web：新标签打开（用户手势触发时一般不被拦截）
    const win = window.open(url, '_blank', 'noopener,noreferrer');
    if (win) return;
    logger.warn('[SDB:openExternal]', 'window.open 被拦截或失败，回退复制链接');
  }

  // 兜底：复制链接，保证用户一定能拿到 URL
  const copied = await copyToClipboard(url);
  if (copied) {
    showToast('链接已复制，可粘贴到浏览器打开');
  } else {
    showDialog({
      title: '打开链接',
      message: `请在浏览器中打开以下链接：\n${url}`,
      confirmButtonText: '好的',
    }).catch(() => {});
  }
}

/**
 * 全局外链拦截器：document 委托 click，命中 <a> 外链则转 openExternal()。
 * 仅拦截带 http(s) 绝对地址的 <a>（显然是外链），不干扰内部 router-link（#/ 或 /）。
 * 保留 Ctrl/Cmd+点击「新标签打开」的浏览器默认行为。返回取消函数，便于按需卸载。
 */
export function installExternalLinkInterceptor(): () => void {
  function onClick(e: MouseEvent): void {
    // 仅响应主按钮左键、且无修饰键（Ctrl/Cmd/Shift/Alt 交给浏览器默认行为）
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    const target = e.target as HTMLElement | null;
    const anchor = target?.closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!isExternalHref(href)) return;
    e.preventDefault();
    void openExternal(href);
  }
  document.addEventListener('click', onClick, true);
  return () => document.removeEventListener('click', onClick, true);
}

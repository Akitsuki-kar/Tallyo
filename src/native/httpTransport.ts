/**
 * 环境感知的 HTTP 传输层（WebDAV 同步专用）
 *
 * 背景：浏览器（含 WebView）的同源策略要求跨域请求的响应携带 CORS 头，
 * 而坚果云 WebDAV 端点不返回任何 CORS 头，导致浏览器/WebView 直连跨域地址
 * 一律被拦截（"Failed to fetch"）。Web 端（PWA / 部署站点）的解法是**同源反代**
 * （填 /dav/...，见 docs/webdav-setup.md）；但 Tauri 桌面/移动壳没有服务器可反代，
 * 文档方案在桌面包完全走不通。
 *
 * 解法：Tauri 壳内切换为 tauri-plugin-http 的**原生 fetch**（Rust reqwest 发起请求），
 * 完全绕开 WebView 的 CORS/CSP，可直连任意 HTTPS 的 WebDAV 端点。
 * 前端无需感知差异——webdavClient 默认经本模块取用对应环境的 fetch。
 *
 * 兼容性：
 * - Web 构建把 @tauri-apps/plugin-http 标为 external、且本模块被 isTauriShell() 守卫，
 *   浏览器运行期永不执行该 import，web 包保持最精简（与 secureKey.ts 同一套约定）。
 * - 原生插件不可用（如纯 WebView 调试）时静默回退浏览器 fetch，功能不报错、仅退回原 CORS 行为。
 */
import { isTauriShell } from '@/utils/platform';

/** 复用 DOM fetch 的签名；Tauri 原生 fetch 与 DOM fetch 行为/结构一致，直接类型复用 */
type FetchLike = typeof fetch;

let cached: FetchLike | null = null;
let loadPromise: Promise<FetchLike> | null = null;

async function load(): Promise<FetchLike> {
  if (cached) return cached;
  if (!loadPromise) {
    loadPromise = (async () => {
      if (isTauriShell()) {
        try {
          // 字面量 specifier：Tauri 构建期正常打包进原生壳；Web 构建期被 vite.config 的
          // rollupOptions.external 标为外部（不解析/不打包）。本分支仅 Tauri 运行期进入。
          const mod = await import('@tauri-apps/plugin-http');
          cached = mod.fetch as unknown as FetchLike;
          if (cached) return cached;
        } catch {
          /* 原生插件不可用，回退浏览器 fetch（行为等同修复前） */
        }
      }
      cached = window.fetch.bind(window);
      return cached;
    })();
  }
  return loadPromise;
}

/** 取当前环境适用的 fetch（结果缓存；仅首次异步加载原生模块） */
export function getWebFetch(): Promise<FetchLike> {
  return load();
}

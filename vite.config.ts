import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';

// 是否为 Tauri 原生壳构建（由 dev:tauri / build:tauri 经 cross-env TAURI_BUILD=1 传入）。
// 该标记决定两件事：① index.html 的 CSP 是否放宽（允许直连 WebDAV）；② 是否生成 PWA Service Worker。
const isTauri = !!process.env.TAURI_BUILD;

// 按目标注入 Content-Security-Policy：
// - Web/PWA：保持严格 'self'，同步走同源反代（/dav/），connect-src 仅 'self'。
// - Tauri：原生壳里页面 origin 为 tauri://localhost，直连 WebDAV 不算 'self'。
//   放宽 connect-src 至 https:/wss:/ws:，并允许 dev 期 Vite HMR 的 ws。SW 已禁用，故无需 manifest-src。
function injectCsp(): Plugin {
  const csp = isTauri
    ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self' https: wss: ws:; object-src 'none'; base-uri 'self';"
    : "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self';";
  return {
    name: 'tallyo-inject-csp',
    transformIndexHtml(html) {
      return html.replace(
        /<meta\s+http-equiv="Content-Security-Policy"[^>]*>/,
        `<meta http-equiv="Content-Security-Policy" content="${csp}" />`,
      );
    },
  };
}

// 水电动账（SDB）Vite 配置：Vue + PWA（离线优先）/ 可选 Tauri 原生壳
export default defineConfig({
  // 将 Vite 缓存目录移出 node_modules
  cacheDir: '.vite-cache',
  // 构建前清空 outDir（最终交付配置）
  build: {
    emptyOutDir: true,
    // ECharts 等图表依赖构成较大的 Stats 异步 chunk（gzip 后仍属可接受范围），
    // 放宽体积告警阈值以避免无意义的构建告警。
    chunkSizeWarningLimit: 800,
    // Web/PWA 构建下，把 Tauri 专有模块标为 external：
    // 它们仅在原生壳运行期按需动态加载，且被 isTauriShell() 守卫，浏览器永不执行，
    // 故不应进入 web 包、也不应在构建期被解析（避免 failed to resolve import）。
    // Tauri 构建（TAURI_BUILD=1）不 external，需正常打包这些插件供原生壳运行期使用。
    rollupOptions: isTauri
      ? {}
      : {
          external: [
            '@tauri-apps/plugin-dialog',
            '@tauri-apps/plugin-fs',
            '@tauri-apps/plugin-http',
            '@tauri-apps/plugin-opener',
            'tauri-plugin-keyring-api',
          ],
        },
  },
  // 注入 import.meta.env.TAURI_BUILD，供 main.ts 守卫 registerSW 使用。
  define: {
    'import.meta.env.TAURI_BUILD': JSON.stringify(isTauri),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // 坚果云 WebDAV 不返回 CORS 头，浏览器直连会被拦截。
    // 开发期走同源本地代理（/dav → 坚果云），App 填 /dav/... 即可，不涉及跨域。
    // 注意：Tauri 原生壳走 tauri-plugin-http 原生通道（不经浏览器），可直连完整 HTTPS 地址（见 docs/webdav-setup.md）。
    proxy: {
      '/dav': {
        target: 'https://dav.jianguoyun.com',
        changeOrigin: true,
        secure: true, // 保留 PROPFIND/MKCOL 等 WebDAV 扩展方法
      },
    },
  },
  plugins: [
    vue(),
    injectCsp(),
    VitePWA({
      // Tauri 原生壳下资源已本地打包、WebView 对 SW 支持有限，禁用 SW 生成。
      // 注意：vite-plugin-pwa v1 的正确选项名是 `disable`（不是 `disabled`）。
      disable: isTauri,
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/pwa-192.png', 'icons/pwa-512.png', 'icons/apple-touch-icon.png'],
      manifest: {
        name: '水电动账',
        short_name: '水电动账',
        description: '离线优先的水电读数记录与账单生成 PWA',
        theme_color: '#EF7A2E',
        background_color: '#FFF9F2',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icons/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // html2canvas / jspdf 通过动态 import 懒加载，单独打包为异步 chunk。
        // 不纳入 precache 以免 SW 缓存膨胀；运行时按需从网络加载。
        globIgnores: [
          '**/html2canvas**',
          '**/jspdf**',
          '**/jspdf-**',
        ],
        maximumFileSizeToCacheInBytes: 3_000_000,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
});

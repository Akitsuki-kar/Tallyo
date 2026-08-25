import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';

// 水电动账（SDB）Vite 配置：Vue + PWA（离线优先）
export default defineConfig({
  // 将 Vite 缓存目录移出 node_modules
  cacheDir: '.vite-cache',
  // 构建前清空 outDir（最终交付配置）
  build: {
    emptyOutDir: true,
    // ECharts 等图表依赖构成较大的 Stats 异步 chunk（gzip 后仍属可接受范围），
    // 放宽体积告警阈值以避免无意义的构建告警。
    chunkSizeWarningLimit: 800,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // 坚果云 WebDAV 不返回 CORS 头，浏览器直连会被拦截。
    // 开发期走同源本地代理（/dav → 坚果云），App 填 /dav/... 即可，不涉及跨域。
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
    VitePWA({
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

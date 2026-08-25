/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// 由 vite.config.ts 的 define 注入：当前是否为 Tauri 原生壳构建。
interface ImportMetaEnv {
  readonly TAURI_BUILD?: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

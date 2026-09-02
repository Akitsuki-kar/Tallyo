/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// 由 vite.config.ts 的 define 注入：当前是否为 Tauri 原生壳构建。
interface ImportMetaEnv {
  readonly TAURI_BUILD?: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// 由 vite.config.ts 的 define 注入：应用版本号（唯一事实来源 package.json）。
// 设置页「关于」直接渲染该常量，改版本只需动 package.json 一处。
declare const __APP_VERSION__: string;

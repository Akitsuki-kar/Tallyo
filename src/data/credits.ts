/**
 * 开源致谢清单（单一数据源）
 *
 * 供设置页「鸣谢」弹层渲染；README 的「开源致谢」章节与此保持一致（手动同步）。
 * 规则：
 * - 只收录直接依赖且对最终产物有贡献的项目（构建期工具也列入，便于致谢完整）。
 * - url 一律使用官方主页 / 官方仓库，避免跳转到镜像或二手来源。
 * - 许可证以各项目官方声明为准；双许可项目列出两个。
 */

export interface CreditItem {
  /** 项目名 */
  name: string;
  /** 在本项目中的用途 */
  desc: string;
  /** 许可证（短名，如 MIT / Apache-2.0） */
  license: string;
  /** 官方主页 / 官方仓库 */
  url: string;
}

export interface CreditGroup {
  /** 分组标题 */
  title: string;
  items: CreditItem[];
}

export const creditGroups: CreditGroup[] = [
  {
    title: '运行时依赖',
    items: [
      {
        name: 'Vue 3',
        desc: '前端框架',
        license: 'MIT',
        url: 'https://vuejs.org',
      },
      {
        name: 'Vue Router',
        desc: '页面路由',
        license: 'MIT',
        url: 'https://router.vuejs.org',
      },
      {
        name: 'Pinia',
        desc: '状态管理',
        license: 'MIT',
        url: 'https://pinia.vuejs.org',
      },
      {
        name: 'Vant 4',
        desc: 'UI 组件库（深度定制为手作美学）',
        license: 'MIT',
        url: 'https://vant-ui.github.io/vant',
      },
      {
        name: 'ECharts 5',
        desc: '图表可视化（按需引入）',
        license: 'Apache-2.0',
        url: 'https://echarts.apache.org',
      },
      {
        name: 'idb',
        desc: 'IndexedDB 封装',
        license: 'ISC',
        url: 'https://github.com/jakearchibald/idb',
      },
      {
        name: 'dayjs',
        desc: '日期处理',
        license: 'MIT',
        url: 'https://day.js.org',
      },
      {
        name: 'html2canvas',
        desc: '账单截图（PDF 导出前置）',
        license: 'MIT',
        url: 'https://html2canvas.hertzen.com',
      },
      {
        name: 'jsPDF',
        desc: 'PDF 导出',
        license: 'MIT',
        url: 'https://github.com/parallax/jsPDF',
      },
    ],
  },
  {
    title: '构建与工程化',
    items: [
      {
        name: 'Vite',
        desc: '构建工具',
        license: 'MIT',
        url: 'https://vitejs.dev',
      },
      {
        name: 'TypeScript',
        desc: '类型系统',
        license: 'Apache-2.0',
        url: 'https://www.typescriptlang.org',
      },
      {
        name: '@vitejs/plugin-vue',
        desc: 'Vite 的 Vue 单文件组件插件',
        license: 'MIT',
        url: 'https://github.com/vitejs/vite-plugin-vue',
      },
      {
        name: 'vite-plugin-pwa',
        desc: 'PWA 离线与安装能力',
        license: 'MIT',
        url: 'https://vite-pwa-org.netlify.app',
      },
      {
        name: 'vue-tsc',
        desc: 'Vue 类型检查',
        license: 'MIT',
        url: 'https://github.com/vuejs/language-tools',
      },
      {
        name: 'cross-env',
        desc: '跨平台环境变量（TAURI_BUILD 开关）',
        license: 'MIT',
        url: 'https://github.com/kentcdodds/cross-env',
      },
      {
        name: 'cn-font-split',
        desc: '中文字体切分（构建期，产出 woff2 分片）',
        license: 'Apache-2.0',
        url: 'https://github.com/KonghaYao/cn-font-split',
      },
    ],
  },
  {
    title: '原生壳（Tauri 2）',
    items: [
      {
        name: 'Tauri 2',
        desc: '桌面 / 移动原生壳',
        license: 'MIT / Apache-2.0',
        url: 'https://tauri.app',
      },
      {
        name: 'tauri-plugin-dialog',
        desc: '系统保存对话框（PDF 导出）',
        license: 'MIT / Apache-2.0',
        url: 'https://github.com/tauri-apps/plugins-workspace',
      },
      {
        name: 'tauri-plugin-fs',
        desc: '文件系统访问',
        license: 'MIT / Apache-2.0',
        url: 'https://github.com/tauri-apps/plugins-workspace',
      },
      {
        name: 'tauri-plugin-keyring',
        desc: '系统密钥环（Keychain / Credential Manager）',
        license: 'MIT',
        url: 'https://github.com/HuakunShen/tauri-plugin-keyring',
      },
      {
        name: 'serde / serde_json',
        desc: 'Rust 序列化',
        license: 'MIT / Apache-2.0',
        url: 'https://serde.rs',
      },
    ],
  },
  {
    title: '字体（SIL OFL 1.1）',
    items: [
      {
        name: '霞鹜文楷轻便版（LXGW WenKai Lite）',
        desc: '中文正文楷体（本地自托管分片）',
        license: 'SIL OFL 1.1',
        url: 'https://github.com/lxgw/LxgwWenKai-Lite',
      },
      {
        name: 'Caveat',
        desc: '手写数字（hero 大数字）',
        license: 'SIL OFL 1.1',
        url: 'https://github.com/googlefonts/caveat',
      },
    ],
  },
];

# 审计修复完成 — 水电动账（SDB）

## 修复概要

修复了深度审计报告中的全部 **2 个 P0 + 12 个 P1 + 2 个 P2** 问题。

## P0（阻断级）

| # | 问题 | 修复 | 文件 |
|---|------|------|------|
| 1 | ECharts 全量引入致 Stats chunk 1,045KB | 改为 `echarts/core` 按需 use（3 chart + 4 component + 1 renderer） | `useECharts.ts` |
| 2 | defaultView 已保存但 bootstrap() 从未路由跳转 | bootstrap 末尾读 settings.defaultView 并 `router.replace` | `main.ts` |

**效果**：Stats chunk 1,045KB → 532KB（-49%）。

## P1（高优）

| # | 问题 | 修复 | 文件 |
|---|------|------|------|
| 1 | @rollup/plugin-babel 幽灵依赖 + emptyOutDir:false | 删依赖、改回 true | `package.json` `vite.config.ts` |
| 2 | Google Fonts CDN 离线不可用 + PWA precache 含重依赖 | 下载 Caveat woff2 本地自托管 + globIgnores 排除 html2canvas/jspdf | `index.html` `variables.css` `vite.config.ts` |
| 3 | getReadingsByPremiseMonth 全量取再 JS filter | DB_VERSION→v2 + 复合索引 [premiseId,date] + IDBKeyRange.bound | `schema.ts` `database.ts` `readingRepo.ts` |
| 4 | getDirtyXxxSince 全量取再 filter | 改用 syncVersion 索引 + IDBKeyRange.upperBound | 4 个 repo |
| 5 | 无 DB 版本迁移骨架 | createStores(db, oldVersion, transaction) 逐版本递进 | `schema.ts` `database.ts` |
| 6 | recomputeAll 笛卡尔积遍历 | 按 (premiseId, monthKey) 组合去重 | `bills.ts` |
| 7 | importData 直接覆盖本地无 LWW | 先 buildLocalSnapshot → mergeSnapshotDetailed → 仅 apply pulled | `dataExport.ts` |
| 8 | 同步锁 read-then-write 非原子 | 异步 compare-and-swap（写入后让出微任务再读回验证） | `lock.ts` `sync.ts` |
| 9 | 无 prefers-color-scheme 自动主题 | ThemeMode 新增 'auto' + MediaQueryList 监听 | `models.ts` `useTheme.ts` `Settings.vue` |
| 10 | 无 CSP 安全头 | index.html 添加 Content-Security-Policy meta | `index.html` |
| 11 | 7 Tab 小屏拥挤 + bootstrap 全量加载 | 同步移入设置页(7→6) + 并行加载优化 | `AppTabBar.vue` `main.ts` |

## P2（中优）

| # | 问题 | 修复 | 文件 |
|---|------|------|------|
| 1 | PDF 多页分页偏移 bug | 改为 for + Math.ceil 总页数 + 一致 yOffset | `pdf.ts` |
| 2 | 核心纯函数无测试 | 32 项断言（readingChain + merge），esbuild bundle + node 执行 | `scripts/test-pure-functions.ts` |

## 验证

- `npm run build`：**0 TypeScript 错误**，PWA precache 34 条目（1.4MB，html2canvas/jspdf 已排除）。
- `npm run test:pure`：**32 passed, 0 failed**。

## 用户确认的设计决策

1. **自动主题**：新增 'auto' 模式（跟随系统 prefers-color-scheme），Settings 主题选择器从开关改为三选一。
2. **字体本地化**：下载 Caveat woff2（Latin 子集，74KB）到 `public/fonts/`，移除 Google Fonts CDN link，离线可用。
3. **Tab 精简**：移除底部「同步」Tab，同步功能从设置页「数据同步」入口进入，底部 Tab 7→6。

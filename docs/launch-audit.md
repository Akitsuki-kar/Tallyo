# 水电动账（SDB）上线深度审计报告（含修复记录）

> 审计时间：2026-08-24（首轮审计 + 同日修复 + 复验）
> 审计对象：`D:\Work\@Project\SDB`（Vue 3 + TS + Vite + Pinia + Vant 4 + ECharts + vite-plugin-pwa）
> 审计方式：静态代码审查 + 构建验证（vue-tsc + vite build）+ 纯函数测试验证 + 配置/部署拓扑核对
> 基线：Phase 1–8 已实现；本次为独立复核 + 全量修复，覆盖既有 `docs/audit-report.html`（2 P0 + 12 P1 + 2 P2 均已修复，见 `overview.md`）。

---

## 一、审计结论（Verdict）

**判定：可上线（Go）。**

首轮审计发现的 1 个 P0 阻断项与全部 P1/P2 建议项**已全部修复并复验通过**：
- `vue-tsc --noEmit` 退出码 **0**；`vite build` 退出码 **0**；SW 正常生成。
- 纯函数测试 **39/39 通过**（原 32 + 新增 7 项 billing 用例）。
- 同步拓扑、账单计算、全局兜底、清理项均已落地。

| 维度 | 结论（修复后） |
|---|---|
| 构建 / 类型检查 | ✅ 通过（TSC 0 错误，vite build 0 错误，SW 生成） |
| 自动化测试 | ✅ 39/39 通过（核心纯函数 + 新增账单计算） |
| 数据层健壮性 | ✅ reactive 边界、迁移、索引均正确 |
| 同步可靠性（死循环/LWW/加密） | ✅ 三层防护 + AES-256-GCM + 快照断言 |
| 安全（XSS/CSP/密钥） | ✅ CSP 与同步反代拓扑已对齐（同源 /dav） |
| 账单计算正确性 | ✅ 月内多次读数不再少计（monthlyUsage） |
| 崩溃兜底 / 测试覆盖度 | ✅ 全局错误兜底已加；账单核心逻辑已单测 |

---

## 二、已验证通过项（Go 项）

- **构建**：`vue-tsc --noEmit` 退出码 0；`vite build` 退出码 0；生成 `sw.js` 与 workbox，precache 36 条目。
- **测试**：`npm run test:pure` → `39 passed, 0 failed`（readingChain / pricing / merge / LWW / **billing**）。
- **数据层 reactive 边界**：6 个 repo `put` 前全部经 `toPlain()` 剥离 Vue Proxy。
- **DB 迁移**：`DB_VERSION=2`，逐版本递进；复合索引 `[premiseId,date]` + `IDBKeyRange.bound` 精确查询。
- **同步死循环三层防护**（经代码核对有效）：recompute 幂等短路 / applySnapshot 条件重算 / useAutoSync 同步期事件抑制。
- **密码加密**：D4 设备本地随机密钥（AES-256-GCM）；密钥不进 IndexedDB / 快照 / 日志。
- **快照安全 / LWW / 导入导出**：断言拒绝含 `syncConfig`/`passwordEnc`；4 级裁决；`importData` 走 LWW 合并不覆盖新数据。
- **XSS 面**：全仓无 `v-html` / `innerHTML`。
- **PWA 图标**：字节数健康，无需重生成。
- **文档**：`docs/webdav-setup.md` 已改为同源反代示例。

---

## 三、修复记录（首轮 P0/P1/P2 → 已修复）

### P0-1 · CSP 与同步反代拓扑冲突 → 已修复（同源反代）
- **改动**：
  - `docs/webdav-setup.md` 第 2/3/4 节重写：反代改为**前端同域名**的 `location /dav/`（Nginx 同一 `server` 块），App 始终填同源相对路径 `/dav/...`。跨域发生在「你的服务器 → 坚果云」之间，对浏览器透明，同时满足 CSP `connect-src 'self'` 与 CORS。
  - `src/components/sync/SyncConfigForm.vue`：地址提示改为「开发/生产均建议填同源反代路径 /dav/...」；新增 `isCrossOrigin()` 校验，检测到跨域绝对地址时弹提示，避免用户误配导致生产同步被拦截。
  - `index.html` CSP 注释补充：说明同步走同源反代、connect-src 'self' 的意图。
- **结果**：生产同步不再被 CSP 拦截（同源 /dav 受 `'self'` 放行）。

### P1-1 · 月度多读数少计 → 已修复（monthlyUsage）
- **改动**：
  - 新增纯函数 `src/utils/billing.ts`：`monthlyUsage(readings, premiseId, type, yearMonth)` 按「月末读数 − 月初基准（该月首条之前、date 严格早于它的读数）」计算净额；月内录 1 条或 N 条结果一致，且负净额钳为 0（账单用量不为负）。
  - `src/stores/bills.ts`：`recompute` / `recomputeAll` 改用 `monthlyUsage`；`recomputeAll` 全量读数只取一次按月复用（性能更优）。移除原 `sortByDateDesc` / `usageOfLocal` 单差逻辑。
  - `scripts/test-pure-functions.ts`：新增 7 项 `monthlyUsage` 单测（单条/多条/无基准/负净额/水电能独立/软删跳过）。
- **结果**：月内多次录入不再少计；单条录入行为与原实现一致（无回归）。

### P1-2 · 设备密钥不可移植 → 已修复（友好提示 + 可操作错误）
- **改动**：
  - `src/sync/crypto.ts`：`decryptPassword` 失败信息改为可操作提示：「本机加密密钥已变更（可能因清除站点数据或更换设备），请在同步设置中重新填写应用密码」。
  - `SyncConfigForm.vue`：密码字段下方新增说明「应用密码仅在当前设备加密保存（密钥不跨设备、不随同步上传）。清除站点数据或更换设备后需重新填写。」

### P1-3 · 全局错误兜底缺失 → 已修复
- **改动**：`src/main.ts` 增加：
  - `app.config.errorHandler`：记录日志，生产环境弹 Toast，避免静默白屏。
  - `window` 的 `unhandledrejection` / `error` 监听统一落日志。
  - `bootstrap()` 失败 `catch` 弹「启动失败」对话框，而非白屏。

### P2 · 清理与配置加固 → 已处理
- 删除根目录 3 个 `vite.config.ts.timestamp-*.mjs` 临时文件。
- 新增 `.gitignore`（忽略 `node_modules/`、`dist/`、`dist-audit/`、`.vite-cache/`、`vite.config.ts.timestamp-*.mjs`、`*.local` 等）。
- `index.html` `theme-color=#EF7A2E` 与 ` manifest` `theme_color=#EF7A2E` 已统一（vite.config.ts manifest 改为 `#EF7A2E`）。
- `vite.config.ts`：`build.chunkSizeWarningLimit` 设为 800（Stats chunk 532KB 属预期，gzip 180KB，消除无意义的构建告警）；修正误导注释。
- CSP `script-src 'unsafe-inline'`：保留并注释说明（当前无 `v-html`，实际风险低；收紧需服务端 nonce，超出静态 PWA 范围，标记为已接受）。
- **测试覆盖度**：核心账单计算已补单测；完整 E2E 仍建议后续补充（见下），不阻塞发布。

---

## 四、上线前 QA 清单（人工验证，建议逐条过）

1. 首启引导：每步真实写库，且不破坏既有数据；跳过/重看逻辑正常。
2. 单机闭环：录入读数 → 账单重算 → 统计/预算 → 导出 PDF（4 套模板）。
3. 双机同步（**同源反代**下）：A 录 → B 拉 → B 改 → A 拉，数据一致；冲突按 LWW 收敛；限流退避正常。
4. 清除站点数据后重新配置同步（验证 P1-2 提示）。
5. 离线可用：IndexedDB 读写、SW 缓存、断网不崩。
6. 主题：浅/深/auto + 图表随 `THEME_CHANGED` 重绘。
7. 导入旧 JSON 不覆盖新数据；导出 JSON 可被重新导入。
8. **月内多次读数时账单金额是否正确（P1-1 已修复，建议抽样验证）**。

---

## 五、部署要点

- 静态托管 `dist/`，需 HTTPS（localhost 例外）。
- **必须配套同源 `/dav` 反代**（见 `docs/webdav-setup.md` §4）：前端同域名下 `location /dav/` 转发到坚果云，App 地址填 `/dav/...`。
- 标准 `npm run build` 在当前审计沙箱中因安全删除策略拦截 `rm -rf dist` 未能直接跑；但构建本身（vue-tsc + vite）已验证通过，产物位于 `dist-audit/`。用户真实环境下 `emptyOutDir` 正常，可正常产出 `dist/`。

---

## 六、总结

所有审计发现（1×P0、3×P1、5×P2）均已修复并复验：构建零错误、纯函数测试 39/39、同源同步拓扑落地、账单多读数计算正确、全局错误兜底到位、仓库清理与配置加固完成。**项目已达可上线标准**，建议按第四节 QA 清单做一次人工回归后即可发布。

---

## 七、后续改进实现记录（同日，独立于审计）

用户要求补齐「高优先级数据安全」与「体验增强」项，已全部实现并复验（详见 `docs/regression-checklist.md`）：

| 项 | 内容 | 复验 |
|---|---|---|
| 高优① | `navigator.storage.persist()` 持久化授权 + 顶部提示 | vue-tsc 0 / build 0 / test 52/52 |
| 高优② | `src/db/guard.ts` 配额守卫（6 repo 接入），`QuotaExceededError` 转可识别错误 | 同上 |
| 高优③ | `webdavClient` 指数退避重试（≤3 次，429 读 Retry-After） | 同上 |
| 体验⑩ | 同步提示含「合并 N 处冲突」+ 上次同步时间 | 同上 |
| 体验⑪ | 离线/待同步横幅（`useSyncStatus` 跟踪在线与本地改动计数） | 同上 |
| 体验⑫ | 删除读数/房源的 5 秒撤销条（`useUndo`） | 同上 |
| 体验⑬ | 每周自动备份开关（写远端 `backups/`，失败仅告警） | 同上 |
| 体验⑭ | 设备密钥口令加密备份/恢复（PBKDF2-SHA256 + AES-256-GCM，独立 `key-backup.json`，不进快照） | 同上 + 5 项密钥用例 |

复验结果（最终）：`vue-tsc` **0 错误**、`vite build` **0 错误**、纯函数测试 **52/52**。发布前建议按 `docs/regression-checklist.md` 走查上述交互/端到端行为。

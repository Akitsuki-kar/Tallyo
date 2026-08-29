# 原生壳（Tauri 2）

Tallyo 的桌面 / 移动原生壳方案。设计目标：**存储与内存占用最小、最精简，同时体验与性能最优**——因此选用 **Tauri 2**，复用系统原生 WebView（macOS/Windows/iOS 用系统内核），不打包 Chromium。

> 与 Web/PWA 的关系：原生壳是**增量外壳**，Vue 业务代码零改动。Web 版（PWA）与 Tauri 版共用同一套 `src/` 与构建产物 `dist/`，仅构建参数不同。

## 为什么是 Tauri 而不是 Electron / Capacitor

| 方案 | 桌面安装体积 | 桌面常驻内存 | 内核 | 多平台 |
| --- | --- | --- | --- | --- |
| Electron | ~120 MB | ~250 MB | 内置 Chromium | Win/mac/Linux |
| Capacitor（桌面=Electron） | ~120 MB | ~250 MB | 内置 Chromium | iOS/Android/Web/桌面 |
| **Tauri 2** | **~5 MB** | **~80 MB** | **系统原生 WebView** | Win/mac/Linux/iOS/Android |

Tauri 因复用系统 WebView，体积与内存远低于「打包引擎」类方案，最贴合「最小存储 / 最小内存 / 最精简」诉求；同时原生 WebView 的 JS 引擎与浏览器同代，性能不打折。

## 目录结构

```
src-tauri/                # Rust 原生壳（独立于 Vue 代码）
├─ Cargo.toml             # Rust 依赖：tauri + tauri-plugin-dialog + tauri-plugin-fs + tauri-plugin-opener + tauri-plugin-keyring（按需，最小集）
├─ tauri.conf.json        # 产物名 Tallyo、identifier com.tallyo.app、前端指向 ../dist
├─ build.rs
├─ capabilities/default.json   # 权限：core:default + dialog:default + opener:default + fs:allow-write-file + keyring:allow-*-password
├─ icons/icon.png         # 图标源（复用 PWA 图标，需一键生成各平台图标）
└─ src/{main.rs,lib.rs}   # 入口：挂载 WebView 与 dialog/fs/keyring 插件
```

## 环境准备（一次性）

1. 安装 **Rust 工具链**：https://rustup.rs （`rustup` 默认 stable 即可）。
2. 安装系统依赖（按平台）：
   - Windows：Visual Studio Build Tools（勾选「C++ 桌面开发」）+ WebView2（Win11 自带）。
   - macOS：`xcode-select --install`。
   - Linux：见 Tauri 官方「prerequisites」（webkit2gtk 等）。
3. 安装前端依赖：`npm install`（会拉取 `@tauri-apps/cli`、`@tauri-apps/api`、`@tauri-apps/plugin-dialog`、`@tauri-apps/plugin-fs`、`tauri-plugin-keyring-api`、`cross-env`）。

## 生成平台图标（首次必做）

`tauri.conf.json` 引用了 `icons/32x32.png`、`icons/128x128.png`、`icons/128x128@2x.png`、`icons/icon.icns`、`icons/icon.ico`。这些由 Tauri CLI 从源图一键生成：

```bash
npx tauri icon src-tauri/icons/icon.png
```

该命令会生成上述全部平台图标（含 Windows 的 `.ico` 与 macOS 的 `.icns`）。之后每次更换品牌图标重复此命令即可。

## 运行与打包

```bash
# 开发（热更新）：先起 Vite(dev:tauri 已放宽 CSP)，再起原生壳
npm run tauri:dev

# 生产构建（生成对应平台安装包：msi/nsis、dmg/app、deb/AppImage…）
npm run tauri:build
```

> `dev:tauri` / `build:tauri` 经由 `cross-env TAURI_BUILD=1` 为 Vite 设置环境变量，触发 `vite.config.ts` 中的「Tauri 模式」：
> 1. **CSP 放宽**：`connect-src` 由 `'self'` 放宽为 `'self' https: wss: ws:`，允许原生壳**直连 WebDAV**（见下）。
> 2. **禁用 PWA SW**：资源已本地打包，无需 Service Worker。
> 3. **守卫 `registerSW`**：`main.ts` 中仅在非 Tauri 时注册 SW。

### 构建验证（已通过）

- `npm run build`（Web/PWA）：生成 `dist/sw.js`、CSP 严格 `connect-src 'self'`、Tauri 专有包全部 external（不进 web 包）。
- `npm run build:tauri`（即 `vue-tsc --noEmit && cross-env TAURI_BUILD=1 vite build`）：type-check 通过、不生成 `sw.js`、CSP 放宽 `connect-src 'self' https: wss: ws:`、Tauri 插件被打包进 `dist/`。

> 注意：`build:tauri` 必须把 `TAURI_BUILD=1` 作用在 `vite build` 这一步（用 `cross-env TAURI_BUILD=1 vite build`，而非 `cross-env ... vue-tsc && vite build`），否则 `&&` 后的 `vite build` 拿不到环境变量，会退化成 Web 构建（仍带 SW）。

## WebDAV 直连（顺带解决「是否必须 Nginx」）

浏览器有 CORS 限制，所以 Web/PWA 版必须走同源反代（`/dav/` → 坚果云）。但 Tauri 原生壳接入 **`tauri-plugin-http` 原生 HTTP 通道**（`src/native/httpTransport.ts` 自动切换：WebDAV 请求由 Rust reqwest 直接发起，不经 WebView），**没有浏览器 CORS 概念**，因此 App 可**直连你的 WebDAV 地址**（如 `https://dav.jianguoyun.com/dav/...`），不再需要部署 Nginx 反代。

- 在原生壳里，把同步设置中的服务器地址填为 WebDAV 完整 HTTPS 地址即可（填相对路径会提示错误）。
- 原生 HTTP 请求不受 WebView CSP 约束（`tauri.conf.json` 的 `csp` 本就为 `null`）；`connect-src https:` 的放宽仅兜底 WebView 内其他请求。

## 已落地的原生增强

为在「最小存储 / 最小内存」前提下把体验拉满，已接入两个与原生壳强相关的增强（仅 Tauri 模式生效，Web 模式自动回退，业务代码零分支）：

1. **设备密钥进系统 Keychain / Keystore**（`src/native/secureKey.ts` + `src/sync/crypto.ts`）
   - D4 的设备加密密钥（AES-256-GCM 的 base64 主密钥）在原生壳里存进系统密钥库（macOS Keychain / Windows 凭据管理器 / Android Keystore / Linux Secret Service），而非 WebView 的 localStorage，安全性更高。
   - 走社区插件 `tauri-plugin-keyring-api`（Rust crate `tauri-plugin-keyring`，Cargo 版本 `0.1`；JS 包 `0.1.1`），调用 `getPassword` / `setPassword` / `deletePassword(service, user)`，密钥以字符串形式存取。
   - `capabilities/default.json` 放开 `keyring:allow-get-password` / `keyring:allow-set-password` / `keyring:allow-delete-password`。
   - 任何原生调用失败都**静默回退 localStorage**，密钥永不丢失（加密红线优先于「最精简」）。

2. **PDF 导出走系统保存框**（`src/utils/pdf.ts`）
   - Tauri 模式用 `@tauri-apps/plugin-dialog` 的 `save()` 弹出系统保存对话框，再用 `@tauri-apps/plugin-fs` 的 `writeFile()` 把 jsPDF 字节写入用户选定路径；体验优于浏览器「下载」弹层。
   - 用户在对话框取消则**不落盘**；原生调用失败自动回退浏览器 `pdf.save()`。

3. **外链调起系统浏览器**（`src/native/openExternal.ts` + `CreditsPopup.vue`）
   - **根因**：原生壳 WebView 里直接写 `<a target="_blank">` 不会被系统浏览器接管。Android 侧走 `WebChromeClient.onCreateWindow`，结果是「在同一个 WebView 内导航」过去——没有地址栏、没有返回键、回不到 App，正是鸣谢等外链在原生壳里表现「怪异」的原因。
   - **方案**：Tauri 模式经 `tauri-plugin-opener` 的 `openUrl()` 调起系统默认浏览器（Android = `ACTION_VIEW` → Chrome Custom Tabs / 默认浏览器；桌面 = 默认浏览器），离开 App 但可一键返回。Web 模式回退 `window.open`（新标签），失败给「复制链接」兜底。
   - `main.ts` 在入口安装 `installExternalLinkInterceptor()`：在 `document` 上做 click 委托，命中 `<a href="http(s)://">` 就 `preventDefault` 并转 `openExternal()`，全站外链统一走系统浏览器，无需逐个改造 `<a>`。
   - 权限仅 `opener:default`（已含 `allow-open-url` / `allow-default-urls`，放行 https/http）。

### Web 包保持最精简（关键约束）

`secureKey.ts` / `pdf.ts` / `openExternal.ts` 对 Tauri 专有包（`@tauri-apps/plugin-dialog`、`@tauri-apps/plugin-fs`、`tauri-plugin-keyring-api`、`@tauri-apps/plugin-opener`）均用**字面量动态 `import()`**，并在 `vite.config.ts` 中：
- **Web/PWA 构建**（`!TAURI_BUILD`）：把这些 specifier 列入 `build.rollupOptions.external`，Rollup 不解析、不打包它们；且调用点被 `isTauriShell()` 守卫，浏览器运行期永不执行 → web 包不掺任何 Tauri 代码。
- **Tauri 构建**（`TAURI_BUILD=1`）：不 external，字面量被正常打包进原生壳供运行期使用。

> 因此同一份 `src/` 在两种构建下都能通过类型检查与打包，且 web 产物依旧是纯 PWA。

## 可选扩展（保持「按需、最小」）

若需更强体验，在 `src-tauri/src/lib.rs` 追加插件，并在 `capabilities/default.json` 放开权限：

- **开机自启**：`@tauri-apps/plugin-autostart`。
- **生物识别解锁**：`@tauri-apps/plugin-biometric`（桌面/移动）。
- **系统托盘 / 全局快捷键**：`@tauri-apps/plugin-tray-icon` / `global-shortcut`。

## 已知边界

- **移动端生态较年轻**：Tauri 2 的 iOS/Android 已稳定，但插件生态不如 Capacitor 成熟。若 App Store 上架遇阻，Capacitor 移动端可作为退路（桌面仍推荐 Tauri）。
- **CSP 仅放宽是够用的**：当前 `connect-src` 放开到 `https:` 通配。若追求更严，可在 `tauri.conf.json` 的 `app.security.csp` 改为仅白名单你的 WebDAV 域名。
- **数据目录**：IndexedDB 账本存于 WebView 数据目录，清除应用数据即清空；现有 WebDAV 同步 + 设备密钥备份已覆盖恢复路径。

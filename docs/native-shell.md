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
├─ Cargo.toml             # Rust 依赖：tauri + tauri-plugin-dialog（按需，仅此一个插件）
├─ tauri.conf.json        # 产物名 Tallyo、identifier com.tallyo.app、前端指向 ../dist
├─ build.rs
├─ capabilities/default.json   # 权限：core:default + dialog:default（最小权限）
├─ icons/icon.png         # 图标源（复用 PWA 图标，需一键生成各平台图标）
└─ src/{main.rs,lib.rs}   # 入口：仅挂载 WebView 与 dialog 插件
```

## 环境准备（一次性）

1. 安装 **Rust 工具链**：https://rustup.rs （`rustup` 默认 stable 即可）。
2. 安装系统依赖（按平台）：
   - Windows：Visual Studio Build Tools（勾选「C++ 桌面开发」）+ WebView2（Win11 自带）。
   - macOS：`xcode-select --install`。
   - Linux：见 Tauri 官方「prerequisites」（webkit2gtk 等）。
3. 安装前端依赖：`npm install`（会拉取 `@tauri-apps/cli`、`@tauri-apps/api`、`@tauri-apps/plugin-dialog`、`cross-env`）。

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

> 这两个脚本经由 `cross-env TAURI_BUILD=1` 设置环境变量，触发 `vite.config.ts` 中的「Tauri 模式」：
> 1. **CSP 放宽**：`connect-src` 由 `'self'` 放宽为 `'self' https: wss: ws:`，允许原生壳**直连 WebDAV**（见下）。
> 2. **禁用 PWA SW**：资源已本地打包，无需 Service Worker。
> 3. **守卫 `registerSW`**：`main.ts` 中仅在非 Tauri 时注册 SW。

## WebDAV 直连（顺带解决「是否必须 Nginx」）

浏览器有 CORS 限制，所以 Web/PWA 版必须走同源反代（`/dav/` → 坚果云）。但 **Tauri 原生壳没有浏览器 CORS 概念**，HTTP 层由 Rust 直接发起，因此 App 可**直连你的 WebDAV 地址**（如 `https://dav.jianguoyun.com/...`），不再需要部署 Nginx 反代。

- 在原生壳里，把同步设置中的服务器地址填为 WebDAV 完整 HTTPS 地址即可。
- 对应 CSP 已在 Tauri 模式放开 `connect-src https:`，不会被拦。

## 可选的原生增强（保持「按需、最小」）

当前仅挂载 `dialog` 插件（PDF 导出走系统保存框）。若需更强体验，在 `src-tauri/src/lib.rs` 追加插件，并在 `capabilities/default.json` 放开权限：

- **密钥进系统钥匙串**：`@tauri-apps/plugin-keyring` / 安全存储，把应用锁设备密钥从 IndexedDB 迁到 Keychain/Keystore，更安全、更省 Web 存储。
- **开机自启**：`@tauri-apps/plugin-autostart`。
- **生物识别解锁**：`@tauri-apps/plugin-biometric`（桌面/移动）。
- **系统托盘 / 全局快捷键**：`@tauri-apps/plugin-tray-icon` / `global-shortcut`。

## 已知边界

- **移动端生态较年轻**：Tauri 2 的 iOS/Android 已稳定，但插件生态不如 Capacitor 成熟。若 App Store 上架遇阻，Capacitor 移动端可作为退路（桌面仍推荐 Tauri）。
- **CSP 仅放宽是够用的**：当前 `connect-src` 放开到 `https:` 通配。若追求更严，可在 `tauri.conf.json` 的 `app.security.csp` 改为仅白名单你的 WebDAV 域名。
- **数据目录**：IndexedDB 账本存于 WebView 数据目录，清除应用数据即清空；现有 WebDAV 同步 + 设备密钥备份已覆盖恢复路径。

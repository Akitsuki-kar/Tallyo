// Tallyo 原生壳入口（Tauri 2）。
// 仅做「承载 Vue 应用」与「挂载按需原生插件」两件事，业务全部在 Web 层（Vue/TS）。
// - dialog + fs：账单 PDF 导出走系统保存框，体验优于浏览器下载（桌面/移动均可用）。
// - keyring：设备加密密钥存系统 Keychain/凭据管理器，仅桌面注册（移动端无后端，
//   JS 层 secureKey.ts 自动回退 localStorage，功能不受损）。

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // 原生 HTTP（WebDAV 同步用）：走 Rust reqwest，无浏览器 CORS/CSP 限制，
        // 桌面/移动壳可直连 https://dav.jianguoyun.com/dav/...（前端 httpTransport.ts 自动切换）。
        .plugin(tauri_plugin_http::init())
        // 外链调起系统默认浏览器（Android → ACTION_VIEW / Custom Tabs，桌面 → 默认浏览器），
        // 避免原生壳 WebView 内导航「无地址栏、回不到 App」（鸣谢等外链；前端 openExternal.ts 调用）。
        .plugin(tauri_plugin_opener::init());

    // keyring 依赖见 Cargo.toml 的桌面专属依赖表：安卓/iOS 目标不编译该 crate，
    // 此处用 tauri-build 提供的 desktop cfg 同步门控注册，避免移动端链接失败。
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_keyring::init());

    builder
        .run(tauri::generate_context!())
        .expect("error while running tallyo");
}

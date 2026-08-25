// Tallyo 原生壳入口（Tauri 2）。
// 仅做「承载 Vue 应用」与「挂载按需原生插件」两件事，业务全部在 Web 层（Vue/TS）。
// 当前仅挂 dialog 插件：账单 PDF 导出可走系统保存框，体验优于浏览器下载。
// 如需更多原生能力（密钥进系统 Keychain/Keystore、开机自启、生物识别等），
// 在此追加对应 plugin 并在 capabilities/default.json 放开权限即可，保持「按需、最小」。

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_keyring::init())
        .run(tauri::generate_context!())
        .expect("error while running tallyo");
}

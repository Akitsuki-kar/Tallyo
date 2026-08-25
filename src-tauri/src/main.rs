// 发布（非 debug）构建下隐藏 Windows 控制台窗口，保持原生应用观感。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // 真正的应用入口在 lib.rs（Tauri 2 桌面/移动统一结构），便于移动端复用。
    tallyo_lib::run()
}

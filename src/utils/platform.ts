/**
 * 运行环境判断：当前是否在 Tauri 原生壳中。
 *
 * 用于在「按需原生能力」（系统 Keychain/Keystore、系统保存对话框等）与 Web 行为之间分流，
 * 保证 Web/PWA 构建与运行完全不受 Tauri 代码影响（这些原生 API 仅在原生壳内才存在）。
 */
export function isTauriShell(): boolean {
  if (typeof window === 'undefined') return false;
  // Tauri v2 注入 __TAURI_INTERNALS__；v1 注入 __TAURI__。两者都识别，向前兼容。
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}

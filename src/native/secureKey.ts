/**
 * 原生密钥安全存储（仅 Tauri 原生壳内生效）
 *
 * 目标：把设备加密密钥（AES-256-GCM 的 base64 主密钥）存进**系统 Keychain / Keystore**
 * （macOS Keychain、Windows 凭据管理器、Android Keystore、Linux Secret Service），
 * 而非 WebView 的 localStorage，安全性更高。
 *
 * 设计要点：
 * - 本模块仅在 Tauri 模式被调用（crypto.ts 已用 isTauriShell() 守卫），Web 模式由 crypto.ts 走 localStorage。
 * - 经社区插件 `tauri-plugin-keyring-api`（对应 Rust crate `tauri-plugin-keyring`）的
 *   getPassword / setPassword / deletePassword(service, user) 以字符串形式存取 base64 密钥。
 * - 因 Web 构建把该包标为 external、且被 isTauriShell() 守卫，浏览器运行期永不执行，web 包最精简。
 * - 任何原生调用失败都**静默回退 localStorage**，确保密钥永不丢失（加密红线优先于「最精简」）。
 */
import { isTauriShell } from '@/utils/platform';
import type { getPassword, setPassword, deletePassword } from 'tauri-plugin-keyring-api';

// 与 Tauri 端 identifier（com.tallyo.app）对应的 service 名；entry 为该密钥的 username 槽位。
const KEYRING_SERVICE = 'com.tallyo.app';
const KEYRING_ENTRY = 'device-key';
const STORAGE_FALLBACK_KEY = 'sdb:crypto:key';

// 仅缓存一次模块加载，避免重复 import。
let keyringPromise: Promise<{
  getPassword: typeof getPassword;
  setPassword: typeof setPassword;
  deletePassword: typeof deletePassword;
}> | null = null;

function loadKeyring() {
  if (!keyringPromise) {
    // 字面量 specifier：Tauri 构建期由 Vite 正常打包进原生壳；Web 构建期被 vite.config 的
    // rollupOptions.external 标为外部（不解析/不打包）。本函数仅 Tauri 运行期经 isTauriShell() 进入。
    keyringPromise = import('tauri-plugin-keyring-api');
  }
  return keyringPromise;
}

/** 从系统 Keychain/Keystore 读取设备密钥（base64）。无或失败则回退 localStorage，再无则返回 null。 */
export async function readDeviceKeyB64(): Promise<string | null> {
  if (!isTauriShell()) return null;
  try {
    const mod = await loadKeyring();
    const pass = await mod.getPassword(KEYRING_SERVICE, KEYRING_ENTRY);
    if (pass) return pass;
  } catch {
    /* 原生读取失败，继续回退 */
  }
  try {
    return localStorage.getItem(STORAGE_FALLBACK_KEY);
  } catch {
    return null;
  }
}

/** 把设备密钥写入系统 Keychain/Keystore。原生失败则回退 localStorage，保证密钥不丢。 */
export async function writeDeviceKeyB64(raw: string): Promise<void> {
  if (!isTauriShell()) return;
  try {
    const mod = await loadKeyring();
    await mod.setPassword(KEYRING_SERVICE, KEYRING_ENTRY, raw);
    return;
  } catch {
    /* 原生写入失败，回退 localStorage */
  }
  try {
    localStorage.setItem(STORAGE_FALLBACK_KEY, raw);
  } catch {
    /* 隐私模式等场景忽略 */
  }
}

/** 从系统 Keychain/Keystore 删除设备密钥（原生失败则忽略）。 */
export async function clearDeviceKeyB64(): Promise<void> {
  if (!isTauriShell()) return;
  try {
    const mod = await loadKeyring();
    await mod.deletePassword(KEYRING_SERVICE, KEYRING_ENTRY);
  } catch {
    /* 忽略 */
  }
}

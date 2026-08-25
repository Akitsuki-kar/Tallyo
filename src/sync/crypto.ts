/**
 * 加密工具（D4：设备本地随机密钥，AES-256-GCM）
 *
 * 安全红线：
 * - 密钥仅在设备本地生成，base64 的 32 字节。
 * - Web 模式：存于 localStorage['sdb:crypto:key']。
 * - Tauri 原生壳模式：存于**系统 Keychain/Keystore**（见 src/native/secureKey.ts），更安全。
 * - 密钥永不进 IndexedDB、永不进上传快照、永不进日志。
 * - 明文密码只在内存中短暂存在（saveConfig 时加密后立即丢弃），不进 state / 日志 / 快照。
 */
import { bytesToBase64, base64ToBytes } from '@/utils/base64';
import { SdbError } from '@/sync/errors';
import { ERROR_CODES } from '@/utils/errorCodes';
import { isTauriShell } from '@/utils/platform';
import { readDeviceKeyB64, writeDeviceKeyB64 } from '@/native/secureKey';

const STORAGE_KEY = 'sdb:crypto:key';

/**
 * 生成并持久化设备本地随机密钥（256-bit），返回可用的 CryptoKey。
 * 若已存在则直接读取并 importKey。
 */
export async function ensureDeviceKey(): Promise<CryptoKey> {
  let rawB64 = '';
  try {
    rawB64 = (await getRawDeviceKeyB64()) ?? '';
  } catch {
    rawB64 = '';
  }
  if (!rawB64) {
    // 设备本地随机生成 256-bit 密钥
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    rawB64 = bytesToBase64(bytes);
    try {
      await setRawDeviceKeyB64(rawB64);
    } catch {
      /* 隐私模式等场景忽略写入失败（密钥将仅存于本次会话内存） */
    }
  }
  const raw = base64ToBytes(rawB64);
  const key = await crypto.subtle.importKey('raw', raw as unknown as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return key;
}

/** AES-256-GCM 加密密码，返回 base64(iv) + '|' + base64(ciphertext) */
export async function encryptPassword(password: string): Promise<string> {
  if (!password) return '';
  const key = await ensureDeviceKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    new TextEncoder().encode(password) as unknown as BufferSource,
  );
  return bytesToBase64(iv) + '|' + bytesToBase64(new Uint8Array(ct));
}

/** 解密密码密文，返回明文。格式非法或解密失败抛带 SDB_CRYPTO_FAIL 的错误。 */
export async function decryptPassword(cipher: string): Promise<string> {
  if (!cipher || !cipher.includes('|')) {
    throw new SdbError(ERROR_CODES.SDB_CRYPTO_FAIL, 'crypto', '密码密文格式非法');
  }
  const key = await ensureDeviceKey();
  const [ivB64, ctB64] = cipher.split('|');
  let iv: Uint8Array;
  let ct: Uint8Array;
  try {
    iv = base64ToBytes(ivB64);
    ct = base64ToBytes(ctB64);
  } catch {
    throw new SdbError(ERROR_CODES.SDB_CRYPTO_FAIL, 'crypto', '密码密文解析失败');
  }
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as unknown as BufferSource }, key, ct as unknown as BufferSource);
    return new TextDecoder().decode(plain);
  } catch {
    // 密钥仅存于本机 localStorage，清除站点数据 / 换设备后会丢失，导致已存密文无法解密。
    // 给出可操作的指引，而非笼统的「解密失败」。
    throw new SdbError(
      ERROR_CODES.SDB_CRYPTO_FAIL,
      'crypto',
      '密码解密失败：本机加密密钥已变更（可能因清除站点数据或更换设备），请在「同步设置」中重新填写应用密码',
    );
  }
}

/**
 * 设备密钥云备份（体验⑭）
 *
 * 背景：设备密钥仅存 localStorage（D4），清除站点数据 / 换设备后，已存的 WebDAV 密码密文无法解密。
 * 解决：把「设备密钥」再用一个**用户口令**加密导出（PBKDF2-SHA256 + AES-256-GCM），形成可携带的备份壳。
 *  - 备份文件本身受用户口令保护，即便泄露也无法解密（前提是口令足够强）。
 *  - 备份**不包含**设备密钥原文，也不进 IndexedDB / 快照 / 日志（仍遵守 D4 红线，只是多了一层口令保护壳）。
 *  - 这是**主动、可选**操作，UI 必须提示用户妥善保管口令；任何情况下设备密钥明文不离开本机内存。
 */

const KEY_BACKUP_V = 1;
const PBKDF2_ITER = 200_000;

/** 读取本机设备密钥（base64 32 字节）。无则返回 null。Tauri 优先读系统 Keychain/Keystore，Web 读 localStorage。 */
export async function getRawDeviceKeyB64(): Promise<string | null> {
  // Tauri 原生壳：优先从系统 Keychain/Keystore 读取
  if (isTauriShell()) return readDeviceKeyB64();
  // Web：localStorage
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** 写入本机设备密钥（base64 32 字节）。Tauri 写入系统 Keychain/Keystore（失败自动回退 localStorage）；Web 写入 localStorage。 */
export async function setRawDeviceKeyB64(raw: string): Promise<void> {
  // Tauri 原生壳：写入系统 Keychain/Keystore（secureKey 内部失败会回退 localStorage）
  if (isTauriShell()) {
    await writeDeviceKeyB64(raw);
    return;
  }
  // Web：localStorage
  try {
    localStorage.setItem(STORAGE_KEY, raw);
  } catch {
    /* 隐私模式等场景忽略写入失败 */
  }
}

async function deriveKeyFromPassphrase(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase) as unknown as BufferSource,
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: PBKDF2_ITER, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * 用用户口令加密一份设备密钥（纯函数，不触碰 localStorage，便于单测）。
 * @param rawKeyB64 设备密钥 base64（来自 getRawDeviceKeyB64）
 * @returns 可携带的备份 JSON 字符串
 */
export async function encryptKeyWithPassphrase(rawKeyB64: string, passphrase: string): Promise<string> {
  if (!passphrase) throw new SdbError(ERROR_CODES.SDB_CRYPTO_FAIL, 'crypto', '口令不能为空');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKeyFromPassphrase(passphrase, salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    new TextEncoder().encode(rawKeyB64) as unknown as BufferSource,
  );
  const backup = {
    v: KEY_BACKUP_V,
    alg: 'PBKDF2-SHA256-200000/AES-256-GCM',
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ct: bytesToBase64(new Uint8Array(ct)),
  };
  return JSON.stringify(backup);
}

/**
 * 用用户口令解密备份，恢复设备密钥 base64（纯函数，不触碰 localStorage）。
 * @throws 口令错误或文件损坏时抛 SDB_CRYPTO_FAIL
 */
export async function decryptKeyWithPassphrase(json: string, passphrase: string): Promise<string> {
  let backup: { v?: number; salt?: string; iv?: string; ct?: string };
  try {
    backup = JSON.parse(json);
  } catch {
    throw new SdbError(ERROR_CODES.SDB_CRYPTO_FAIL, 'crypto', '密钥备份文件格式非法');
  }
  if (!backup || !backup.salt || !backup.iv || !backup.ct) {
    throw new SdbError(ERROR_CODES.SDB_CRYPTO_FAIL, 'crypto', '密钥备份文件缺少必要字段');
  }
  const salt = base64ToBytes(backup.salt);
  const iv = base64ToBytes(backup.iv);
  const ct = base64ToBytes(backup.ct);
  const key = await deriveKeyFromPassphrase(passphrase, salt);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      key,
      ct as unknown as BufferSource,
    );
  } catch {
    throw new SdbError(ERROR_CODES.SDB_CRYPTO_FAIL, 'crypto', '密钥恢复失败：口令错误或备份已损坏');
  }
  const recovered = new TextDecoder().decode(plain);
  // 校验恢复的密钥确实是 32 字节 base64（防止格式错误写入本机）
  try {
    if (base64ToBytes(recovered).length !== 32) throw new Error('长度不符');
  } catch {
    throw new SdbError(ERROR_CODES.SDB_CRYPTO_FAIL, 'crypto', '恢复的密钥校验失败');
  }
  return recovered;
}

/** 便捷封装：导出本机密钥为备份 JSON（读取本机密钥，Tauri 来自 Keychain/Keystore，Web 来自 localStorage）。 */
export async function exportKeyBackup(passphrase: string): Promise<string> {
  const raw = await getRawDeviceKeyB64();
  if (!raw) throw new SdbError(ERROR_CODES.SDB_CRYPTO_FAIL, 'crypto', '本机尚未生成加密密钥，无需备份');
  return encryptKeyWithPassphrase(raw, passphrase);
}

/** 便捷封装：用备份恢复本机密钥（写入本机密钥存储，Tauri 进 Keychain/Keystore，Web 进 localStorage）。 */
export async function importKeyBackup(json: string, passphrase: string): Promise<void> {
  const recovered = await decryptKeyWithPassphrase(json, passphrase);
  await setRawDeviceKeyB64(recovered);
}

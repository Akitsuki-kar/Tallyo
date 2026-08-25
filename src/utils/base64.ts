/**
 * Uint8Array <-> base64 转换（浏览器/Node 通用，不使用 Node Buffer）。
 * 用于 AES-GCM 的 iv/ciphertext 与 Basic Auth 凭据的 base64 编码。
 */

/** 将字节数组编码为 base64 字符串 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  // 分块避免 String.fromCharCode.apply 的参数长度上限（约 65536）
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  return btoa(binary);
}

/** 将 base64 字符串解码为字节数组 */
export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

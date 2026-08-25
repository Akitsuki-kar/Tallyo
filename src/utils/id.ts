/**
 * 生成唯一 ID：优先使用 Web Crypto（UUID），降级到时间戳+随机串。
 */
export function genId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

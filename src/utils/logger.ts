/**
 * 统一日志（architecture.md §10.2）
 * - 统一 logger.info / warn / error(tag, msg, meta?)
 * - tag 形如 `[SDB:sync]`
 * - 绝不打印 passwordEnc 等敏感字段（自动脱敏）
 */
type LogLevel = 'info' | 'warn' | 'error';

const TAG_PREFIX = '[SDB';

/** 是否输出日志（生产环境可在此降级） */
function shouldLog(): boolean {
  return true;
}

/** 敏感字段脱敏 */
function safeMeta(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (/password|secret|token|key/i.test(k)) {
      cleaned[k] = '***redacted***';
    } else {
      cleaned[k] = v;
    }
  }
  return cleaned;
}

function formatTag(tag: string): string {
  return tag.startsWith('[') ? tag : `${TAG_PREFIX}:${tag}]`;
}

function emit(level: LogLevel, tag: string, msg: string, meta?: Record<string, unknown>): void {
  if (!shouldLog()) return;
  const fullTag = formatTag(tag);
  const payload = safeMeta(meta);
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
  (fn as (...args: unknown[]) => void)(
    fullTag,
    msg,
    ...(payload !== undefined ? [payload] : []),
  );
}

export const logger = {
  info: (tag: string, msg: string, meta?: Record<string, unknown>): void => emit('info', tag, msg, meta),
  warn: (tag: string, msg: string, meta?: Record<string, unknown>): void => emit('warn', tag, msg, meta),
  error: (tag: string, msg: string, meta?: Record<string, unknown>): void => emit('error', tag, msg, meta),
};

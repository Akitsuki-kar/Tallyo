/**
 * 同步模块统一错误类型（携带错误码与分类 kind，便于上层映射为用户提示）。
 * 该文件为纯类型/常量，不依赖 store / Vue，可被 webdavClient 等模块安全引用。
 */
import { ERROR_CODES } from '@/utils/errorCodes';

/** 错误分类，用于判断是否需要提示用户查看排查文档 */
export type SdbErrorKind =
  | 'auth' // 401/403 认证失败
  | 'notfound' // 远端文件不存在（GET 404）
  | 'conflict' // 412 并发冲突
  | 'network' // 断网 / CORS / 超时
  | 'server' // 5xx 服务端错误
  | 'storage' // 本地存储配额不足 / 持久化失败
  | 'crypto' // 加解密失败
  | 'remote' // 远端快照结构非法
  | 'locked' // 同步锁被占用
  | 'offline' // 设备离线
  | 'unknown';

export class SdbError extends Error {
  code: number;
  kind: SdbErrorKind;

  constructor(code: number, kind: SdbErrorKind, message: string) {
    super(message);
    this.name = 'SdbError';
    this.code = code;
    this.kind = kind;
  }
}

/** 类型守卫：判断未知错误是否为 SdbError */
export function isSdbError(err: unknown): err is SdbError {
  return err instanceof SdbError;
}

/** 构造网络/CORS 类错误的便捷工厂（提示查看 docs/webdav-setup.md） */
export function networkError(message: string): SdbError {
  return new SdbError(ERROR_CODES.SDB_SYNC_NETWORK_FAIL, 'network', message);
}

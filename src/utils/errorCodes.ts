/**
 * 错误码常量（对应 architecture.md §10.1）
 * 约定：0 表示成功，非 0 为业务/系统错误码。
 */
export const ERROR_CODES = {
  SDB_DB_OPEN_FAIL: 1001, // IndexedDB 打开失败
  SDB_DB_WRITE_FAIL: 1002, // 写入失败
  SDB_DB_QUOTA: 1003, // 本地存储配额不足（QuotaExceededError）
  SDB_SYNC_LOCKED: 2001, // 同步锁被占用
  SDB_WEBDAV_CONN: 2002, // WebDAV 连接/鉴权失败
  SDB_WEBDAV_PUT: 2003, // 上传失败
  SDB_CRYPTO_FAIL: 2004, // 加解密失败
  SDB_NET_OFFLINE: 2005, // 离线无法同步
  SDB_SYNC_NETWORK_FAIL: 2006, // 网络/CORS 失败
  SDB_SYNC_AUTH_FAIL: 2007, // WebDAV 认证失败（用户名/应用密码）
  SDB_SYNC_REMOTE_INVALID: 2008, // 远端快照结构非法
  SDB_VALIDATE: 3001, // 表单/参数校验失败
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** 根据错误码取回常量名（便于日志与调试） */
export function errorCodeName(code: number): string {
  const entry = Object.entries(ERROR_CODES).find(([, v]) => v === code);
  return entry ? entry[0] : 'UNKNOWN';
}

/**
 * 统一响应类型（architecture.md §10.4）
 */
import { ERROR_CODES, type ErrorCode } from './errorCodes';

export interface Result<T> {
  code: number; // 0 成功，非 0 见 errorCodes
  data?: T;
  message?: string;
}

export function ok<T>(data?: T, message?: string): Result<T> {
  return { code: 0, data, message };
}

export function fail<T = unknown>(code: ErrorCode | number, message?: string): Result<T> {
  return { code, message };
}

/** 同步相关结果（预留，Phase 3 使用） */
export interface SyncResult {
  status: 'idle' | 'syncing' | 'success' | 'error';
  pulled: number;
  pushed: number;
  error?: string;
}

export { ERROR_CODES };
export type { ErrorCode };

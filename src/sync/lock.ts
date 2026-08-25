/**
 * 同步锁（防并发，架构蓝图 §5.5）。
 *
 * 用 localStorage 存 { token, ts }，键 'sdb:sync:lock'。
 * 采用 compare-and-swap 模式避免多标签页竞态：
 *   1. 检查是否已有有效锁（未超时）→ 有则放弃
 *   2. 写入自己的 token
 *   3. 让出一个微任务回合（setTimeout 0），允许其他标签页的写入在此窗口内发生
 *   4. 读回：若 token 仍是自己的 → 获锁成功；若被其他标签页覆盖 → 获锁失败
 *
 * - acquire()：异步，成功返回 token，失败返回 null。
 * - release(token)：仅 token 匹配时清除。
 * - isLocked()：判断当前是否被他人/旧锁占用。
 * 所有同步路径必须在 try/finally 中 release。
 */
const LOCK_KEY = 'sdb:sync:lock';
const TIMEOUT_MS = 5 * 60 * 1000;
/** compare-and-swap 验证等待时间（ms），让其他标签页的写入有机会在此窗口内发生 */
const CAS_DELAY_MS = 0;

interface LockRecord {
  token: string;
  ts: number;
}

function readLock(): LockRecord | null {
  try {
    const raw = localStorage.getItem(LOCK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LockRecord;
    if (typeof parsed.token === 'string' && typeof parsed.ts === 'number') return parsed;
    return null;
  } catch {
    return null;
  }
}

function writeLock(rec: LockRecord): void {
  try {
    localStorage.setItem(LOCK_KEY, JSON.stringify(rec));
  } catch {
    /* 忽略写入失败 */
  }
}

function clearLock(): void {
  try {
    localStorage.removeItem(LOCK_KEY);
  } catch {
    /* 忽略 */
  }
}

function genToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `lock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * 尝试获取锁（compare-and-swap）。
 * 成功返回 token，失败（被占用且未超时 / 被其他标签页竞态覆盖）返回 null。
 *
 * 注意：此函数是异步的——调用方需 await。
 */
export async function acquireLock(): Promise<string | null> {
  const existing = readLock();
  const now = Date.now();
  // 已有有效锁（未超时）→ 放弃
  if (existing && now - existing.ts <= TIMEOUT_MS) {
    return null;
  }

  const token = genToken();
  writeLock({ token, ts: now });

  // 让出一个微任务回合，允许其他标签页在此窗口内也写入
  // 之后读回：若 token 仍是自己的说明没有其他标签页竞争（或自己是最后一个写入者）
  await new Promise<void>((resolve) => setTimeout(resolve, CAS_DELAY_MS));

  const readback = readLock();
  if (readback && readback.token === token) {
    return token; // 获锁成功
  }
  // 被其他标签页覆盖 → 获锁失败
  return null;
}

/** 释放锁（仅当 token 匹配时） */
export function releaseLock(token: string): void {
  const existing = readLock();
  if (existing && existing.token === token) {
    clearLock();
  }
}

/** 判断当前是否处于锁定状态（含超时自动清理） */
export function isLocked(): boolean {
  const existing = readLock();
  if (!existing) return false;
  if (Date.now() - existing.ts > TIMEOUT_MS) {
    clearLock();
    return false;
  }
  return true;
}

// SPDX-License-Identifier: Apache-2.0
/**
 * 启动数据就绪信号。
 *
 * 存在意义：App.vue 的 onMounted 早于 main.ts 的 bootstrap() 完成（app.mount 在前、bootstrap 在后），
 * 两侧又是并发的异步链。此前 App.vue 只 await 了 settings.load()，就立刻读
 * premises.currentPremiseId —— 而 premises 是由 bootstrap 自己加载的，
 * 微任务队列里 App.vue 的续体还排在 bootstrap 前面，于是拿到的恒为空字符串，
 * 「月初弹上月账单」因此永远走到 `if (!premiseId) return` 静默跳过。
 *
 * 与其在每个调用点补一串 await（还容易漏、且顺序一变就失效），
 * 不如让 bootstrap 在「账单已重算」这个明确的时点发一次信号，
 * 关心数据的调用方统一 await 它 —— 顺序由 bootstrap 一处保证，不会漏。
 *
 * 只表达「核心数据可用」这一个语义：settings / premises / readings / bills 均已装载且账单已自愈重算。
 * 自清洗、自动备份、持久化授权等 best-effort 任务不纳入，避免它们拖慢/阻塞调用方。
 */

type ResolveFn = () => void;
type RejectFn = (reason: unknown) => void;

let resolveReady: ResolveFn = () => {};
let rejectReady: RejectFn = () => {};

const readyPromise = new Promise<void>((resolve, reject) => {
  resolveReady = resolve;
  rejectReady = reject;
});

let settled = false;

/** 标记核心数据已就绪（幂等，重复调用无副作用） */
export function markDataReady(): void {
  if (settled) return;
  settled = true;
  resolveReady();
}

/** 标记启动失败，唤醒所有等待方（否则调用方会永远挂起） */
export function markBootstrapFailed(reason: unknown): void {
  if (settled) return;
  settled = true;
  rejectReady(reason);
}

/**
 * 等待核心数据就绪。
 *
 * 调用方必须 try/catch：bootstrap 失败时这里会 reject。
 * 这是刻意设计的 —— 失败时与其让调用方拿着半截数据继续跑（可能读到空房源、空账单），
 * 不如显式抛给调用方去降级（弹层类功能选择「本次不弹」，完全合理）。
 */
export function whenDataReady(): Promise<void> {
  return readyPromise;
}

/** 是否已就绪（同步查询，供不需要等待的场景做快速判断） */
export function isDataReady(): boolean {
  return settled;
}

// SPDX-License-Identifier: Apache-2.0
/**
 * 账单 store 的「装载结果作废」判定（纯函数，便于单测，见 scripts/test-pure-functions.ts）。
 *
 * 背景：bills.load() 是整表替换（bills.value = map），recomputeAll() 是逐月增量赋值
 * （bills.value[id] = bill）。两者一旦交错，整表替换会把重算结果从内存抹掉，
 * 进而让后续 computeBill 读到旧版 existing → syncVersion 从旧值重新起步 →
 * 增量同步漏推 + 被远端旧账单按 LWW 覆盖回来。
 *
 * 每次 load() 领一个 loadGeneration，每次重算令 recomputeSeq + 1 并置 recomputeActive。
 * 某次 load() 的 IDB 读回后，命中以下任一就丢弃、不写内存（详见 stores/bills.ts）：
 *   ① superseded-load  —— 期间发起了更新的 load()（整表替换应由最新那次负责）
 *   ② recompute-changed —— 期间有任何重算开始或结束（读到的是重算前的快照）
 *   ③ recompute-active  —— 此刻正有重算在跑（同上，快照已过期）
 * 三条都不命中才落库。
 */
export type DiscardReason = 'superseded-load' | 'recompute-changed' | 'recompute-active';

export interface LoadGuardState {
  /** 本次 load() 领到的代际号 */
  generation: number;
  /** 当前最新的 load() 代际号 */
  latestGeneration: number;
  /** 本次 load() 开始时的 recomputeSeq 快照 */
  recomputeSnapshot: number;
  /** 当前 recomputeSeq */
  recomputeSeq: number;
  /** 此刻是否有重算在跑 */
  recomputeActive: boolean;
}

/** 返回应丢弃的理由；null 表示结果有效、可写内存 */
export function shouldDiscardLoad(s: LoadGuardState): DiscardReason | null {
  if (s.generation !== s.latestGeneration) return 'superseded-load';
  if (s.recomputeSnapshot !== s.recomputeSeq) return 'recompute-changed';
  if (s.recomputeActive) return 'recompute-active';
  return null;
}

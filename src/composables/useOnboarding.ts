/**
 * 新手引导状态（首启检测）
 *
 * 标记持久化于 localStorage（sdb:onboarded）：
 * - 首次打开（无标记）→ App.vue 启动 OnboardingFlow 沉浸式引导
 * - 完成或跳过 → 写入标记，后续启动不再打扰
 * - 设置页「重看新手引导」→ resetOnboarding() 后由事件触发重开
 *
 * 注意：隐私模式等场景 localStorage 可能抛错，全部静默兜底（视为未引导，
 * 最坏情况是每次启动都看到引导，不会阻断使用）。
 */

const ONBOARDED_KEY = 'sdb:onboarded';

/** 是否已完成引导（任何异常均视为未完成，保证新用户一定能看到引导） */
export function isOnboarded(): boolean {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === '1';
  } catch {
    return false;
  }
}

/** 标记引导完成（完成或主动跳过均调用） */
export function completeOnboarding(): void {
  try {
    localStorage.setItem(ONBOARDED_KEY, '1');
  } catch {
    /* 忽略写入失败 */
  }
}

/** 清除标记（重看引导用） */
export function resetOnboarding(): void {
  try {
    localStorage.removeItem(ONBOARDED_KEY);
  } catch {
    /* 忽略 */
  }
}

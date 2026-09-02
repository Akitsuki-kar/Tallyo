/**
 * 轻量事件总线（mitt 风格，architecture.md §10.3）
 * 约定事件：reading:changed / bill:recalculated / budget:changed /
 *          premise:changed / price:changed / theme:changed / sync:done / online:changed
 *
 * ⚠️ 凡是会写 IndexedDB 并需要跨设备传播的变更，都必须 emit 对应事件。
 * useAutoSync 只监听本表事件来触发防抖推送，useSyncStatus 只据此统计「待同步」条数；
 * 漏发事件 = 该变更永远滞留本地，直到下一次别的改动顺带把它带上。
 */
export type EventHandler<T = unknown> = (payload?: T) => void;

export const EVENTS = {
  READING_CHANGED: 'reading:changed',
  BILL_RECALCULATED: 'bill:recalculated',
  BUDGET_CHANGED: 'budget:changed',
  PREMISE_CHANGED: 'premise:changed',
  PRICE_CHANGED: 'price:changed',
  THEME_CHANGED: 'theme:changed',
  SYNC_DONE: 'sync:done',
  ONLINE_CHANGED: 'online:changed',
  /**
   * 敏感操作（删除房源 / 永久删除 / 清空回收站 / 恢复 / 自清洗清理墓碑）后请求**立即同步**。
   *
   * 为什么需要它：删除类操作是「不可逆意图」，若只走常规 30s 防抖 + 60s 节流，
   * 云端会长时间停留旧数据；若这期间对端改动过同一记录（updatedAt 更新），
   * LWW 下本地删除意图会被「更新的改动」推翻，甚至被云端旧记录覆盖（0.1.1 无墓碑协议时的经典事故）。
   * 紧急同步只绕过防抖、仍尊重 60s 最小间隔（坚果云限频），被节流拦下时排补偿任务、绝不丢弃。
   *
   * ⚠️ 本事件**不是落库实体**（不写 IndexedDB），因此**不接入** useSyncStatus 的「待同步计数」；
   * 只有 READING/BILL/BUDGET/PREMISE/PRICE 五类实体事件才需要三处订阅。本事件仅由 useAutoSync 订阅。
   */
  SYNC_REQUESTED: 'sync:requested',
  QUICK_RECORD: 'quick:record', // 侧栏「记一笔」→ App.vue 打开全局快速记录弹窗
  ONBOARDING_REPLAY: 'onboarding:replay', // 设置页「重看新手引导」→ App.vue 重启引导流
  /**
   * 设置页「查看上月结算单」→ App.vue 主动唤起月初账单弹层。
   *
   * 注意：这是纯 UI 指令事件，**不是**同步实体事件 —— 它不写 IndexedDB，
   * 因此不需要接入 useAutoSync（推送）与 useSyncStatus（待同步计数）。
   * 别把它和上面五类会落库的实体事件混为一谈。
   */
  REQUEST_MONTHLY_BILL: 'ui:requestMonthlyBill',
} as const;

class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();

  on<T = unknown>(event: string, handler: EventHandler<T>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set<EventHandler>();
      this.handlers.set(event, set);
    }
    set.add(handler as EventHandler);
    return () => this.off(event, handler);
  }

  off<T = unknown>(event: string, handler: EventHandler<T>): void {
    const set = this.handlers.get(event);
    if (set) {
      set.delete(handler as EventHandler);
      if (set.size === 0) this.handlers.delete(event);
    }
  }

  emit<T = unknown>(event: string, payload?: T): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        (handler as EventHandler<T>)(payload);
      } catch (err) {
        // 单个监听器异常不影响其他监听器
        console.error('[SDB:eventBus] handler error', event, err);
      }
    }
  }
}

export const eventBus = new EventBus();

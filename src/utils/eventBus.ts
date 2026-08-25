/**
 * 轻量事件总线（mitt 风格，architecture.md §10.3）
 * 约定事件：reading:changed / bill:recalculated / theme:changed / sync:done / online:changed
 */
export type EventHandler<T = unknown> = (payload?: T) => void;

export const EVENTS = {
  READING_CHANGED: 'reading:changed',
  BILL_RECALCULATED: 'bill:recalculated',
  BUDGET_CHANGED: 'budget:changed',
  THEME_CHANGED: 'theme:changed',
  SYNC_DONE: 'sync:done',
  ONLINE_CHANGED: 'online:changed',
  QUICK_RECORD: 'quick:record', // 侧栏「记一笔」→ App.vue 打开全局快速记录弹窗
  ONBOARDING_REPLAY: 'onboarding:replay', // 设置页「重看新手引导」→ App.vue 重启引导流
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

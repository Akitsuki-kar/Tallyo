/**
 * 自动同步 composable（决策 2：手动 + 启动自动拉 + 变更防抖自动推）。
 *
 * - 启动自动拉：挂载后若已配置且在线，延迟约 1.5s 触发一次 sync()（避开首屏渲染）。
 * - 变更防抖自动推：监听 READING_CHANGED / BILL_RECALCULATED / BUDGET_CHANGED 等事件，防抖 30s 后触发 sync()。
 * - 同步期事件抑制（死循环第三层防护）：sync() 运行期间自身产生的事件不会同步调度新同步，
 *   避免「应用远端 → 重算 → 事件 → 新同步」的跨设备乒乓；sync 期间发生的真实本地编辑会在 sync 结束后补推一次。
 * - 最小同步间隔节流（60s）：坚果云有频率限制，避免高频请求。
 * - 页面隐藏 / beforeunload：flush 待执行的防抖任务。
 * - 恢复联网：补推离线期间积压的变更。
 * - 失败重试：指数退避，最多 3 次；全部失败写入 sync store 的 error 供 UI 展示。
 * - 组件卸载时清理所有定时器与事件监听，避免泄漏。
 */
import { onMounted, onUnmounted, ref } from 'vue';
import { useSyncStore } from '@/stores/sync';
import { eventBus, EVENTS } from '@/utils/eventBus';
import { logger } from '@/utils/logger';

const STARTUP_DELAY_MS = 1500;
const DEBOUNCE_MS = 30_000;
const MIN_INTERVAL_MS = 60_000;
const MAX_RETRIES = 3;

export function useAutoSync(): { flush: () => void } {
  const syncStore = useSyncStore();
  const pending = ref(false);
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  /** 被最小间隔节流拦下后的「补偿调度」定时器（见 waitForThrottle） */
  let throttleTimer: ReturnType<typeof setTimeout> | undefined;
  /** 启动自动拉取的延迟定时器（挂载后 1.5s 触发，组件卸载时须一并清理） */
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  let lastSyncTs = 0;
  let retries = 0;
  // 同步期事件抑制（死循环第三层防护）：sync() 执行期间置位 syncing。
  // 此期间由 sync 内部（applySnapshot / recompute）产生的事件不应立即调度新同步，
  // 否则会与「重算自增版本」形成跨设备乒乓（已在 bills.recompute 幂等短路、snapshot.needRecompute 中根除根因，此处为防御层）。
  let syncing = false;
  // sync 期间发生的真实本地编辑：先标记，待 sync 结束后补推一次，避免编辑丢失。
  let dirtyDuringSync = false;

  /**
   * 被最小间隔拦下时补一次调度，而不是丢弃本次同步。
   *
   * 为什么必须补：节流直接 return 会让三类改动静默卡死——
   *   ① sync 期间发生的本地编辑（dirtyDuringSync 的补推）；
   *   ② 恢复联网时的积压补推（onOnline）；
   *   ③ 正常编辑后 30s 防抖到期但距上次同步不足 60s。
   * 它们的共同点是「没有后续事件再来触发」，一旦丢弃，
   * UI 的「有 N 项改动待同步」横幅会一直挂着，改动要等到下一次别的编辑才顺带上传。
   */
  function waitForThrottle(): void {
    // 页面已隐藏时不排补偿任务：回到前台时 onVisibility 会重新调度，
    // 后台挂一个定时器只是白耗电。
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (throttleTimer) return; // 已有一个等待窗口的补偿任务，不重复排队
    const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastSyncTs));
    throttleTimer = setTimeout(() => {
      throttleTimer = undefined;
      void doSync();
    }, wait);
  }

  /**
   * 敏感操作紧急同步：绕过 30s 防抖，立即发起（仍受 60s 最小间隔约束）。
   *
   * 被节流拦下时的处理分两种（都不丢意图）：
   *  - 页面可见 → waitForThrottle 排补偿任务，到期后 doSync；
   *  - 页面隐藏 → waitForThrottle 不排定时器（省电），但这里先把 pending 置位，
   *    回前台时 onVisibility 会因 pending 补推一次 —— 这正是「删除/清空后立刻切后台」
   *    场景下同步不被吞掉的保证（旧实现里该窗口会永久卡住，直到下一次别的编辑）。
   */
  function requestSync(): void {
    // 同步进行中：交由 dirtyDuringSync 在 sync 结束后补推，避免并发两轮同步
    if (syncing) {
      dirtyDuringSync = true;
      return;
    }
    if (!syncStore.isConfigured) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return; // 离线积压，联网后补推
    pending.value = true; // 兜底标记：页面隐藏/同步失败时靠 onVisibility 与重试路径补推
    void doSync();
  }

  async function doSync(): Promise<void> {
    const now = Date.now();
    // 后台冻结：App 在后台（被切走/锁屏）时不发起同步网络请求，
    // 避免唤醒射频做 WebDAV 通信；回到前台后再补推（见 onVisibility）。
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (!syncStore.isConfigured) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    // 最小同步间隔节流：被拦下时排一个补偿任务，而不是丢弃（见 waitForThrottle）
    if (now - lastSyncTs < MIN_INTERVAL_MS) {
      waitForThrottle();
      return;
    }

    lastSyncTs = now;
    syncing = true;
    dirtyDuringSync = false;
    try {
      const res = await syncStore.sync();
      if (res.code === 0) {
        retries = 0;
        pending.value = false; // 本轮已把全部本地改动推上去，清除待同步标记（requestSync 置位后在此收敛）
        return;
      }
      // 失败指数退避重试（最多 MAX_RETRIES 次）
      if (retries < MAX_RETRIES) {
        retries++;
        const delay = 2 ** retries * 1000;
        logger.warn('[SDB:autosync]', `同步失败，${delay}ms 后第 ${retries} 次重试`, { message: res.message });
        retryTimer = setTimeout(() => void doSync(), delay);
      } else {
        retries = 0;
        logger.error('[SDB:autosync]', '同步多次重试失败，已停止自动重试', { message: res.message });
      }
    } finally {
      // 无论成功/失败/重试，sync 调用自身已结束，解除抑制。
      syncing = false;
      // 仅在 sync 期间确有真实本地编辑发生时，才补推一次（远端自身数据不会触发，因其重算已幂等）。
      if (dirtyDuringSync) {
        dirtyDuringSync = false;
        scheduleSync();
      }
    }
  }

  function scheduleSync(): void {
    // 同步进行中：忽略 sync 自身产生的事件，避免死循环；真实本地编辑改由 dirtyDuringSync 在 sync 后补推。
    if (syncing) {
      dirtyDuringSync = true;
      return;
    }
    if (!syncStore.isConfigured) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return; // 离线积压，联网后补推
    pending.value = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      pending.value = false;
      void doSync();
    }, DEBOUNCE_MS);
  }

  function flush(): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = undefined;
    }
    if (pending.value) {
      pending.value = false;
      void doSync();
    }
  }

  // 监听全部会写 IndexedDB 的变更事件；漏掉任何一类，该类改动就永远不会自动推送。
  const offReading = eventBus.on(EVENTS.READING_CHANGED, scheduleSync);
  const offBill = eventBus.on(EVENTS.BILL_RECALCULATED, scheduleSync);
  const offBudget = eventBus.on(EVENTS.BUDGET_CHANGED, scheduleSync);
  const offPremise = eventBus.on(EVENTS.PREMISE_CHANGED, scheduleSync);
  const offPrice = eventBus.on(EVENTS.PRICE_CHANGED, scheduleSync);
  // 敏感操作紧急同步：绕过防抖立即推（见 requestSync 注释）。非落库实体，不进 useSyncStatus 计数。
  const offSyncRequested = eventBus.on(EVENTS.SYNC_REQUESTED, requestSync);

  function onOnline(): void {
    if (syncStore.isConfigured) void doSync(); // 补推离线期间积压的变更
  }
  function onVisibility(): void {
    if (typeof document === 'undefined') return;
    if (document.visibilityState === 'hidden') {
      // 进入后台：取消待执行的防抖定时器（不发起网络请求），保留 pending 标记，
      // 以便回到前台后补推积压的改动。这比原先「隐藏即 flush」更省电。
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = undefined;
      }
    } else {
      // 回到前台：若隐藏前有未推送的改动，重新排程一次自动同步。
      if (pending.value) scheduleSync();
    }
  }
  function onBeforeUnload(): void {
    flush();
  }

  onMounted(async () => {
    // 确保配置已加载
    await syncStore.loadConfig();
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', onBeforeUnload);
    // 启动自动拉
    if (syncStore.isConfigured) {
      startupTimer = setTimeout(() => {
        startupTimer = undefined;
        void doSync();
      }, STARTUP_DELAY_MS);
    }
  });

  onUnmounted(() => {
    offReading();
    offBill();
    offBudget();
    offPremise();
    offPrice();
    offSyncRequested();
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('beforeunload', onBeforeUnload);
    if (debounceTimer) clearTimeout(debounceTimer);
    if (retryTimer) clearTimeout(retryTimer);
    if (throttleTimer) clearTimeout(throttleTimer);
    if (startupTimer) clearTimeout(startupTimer);
  });

  return { flush };
}

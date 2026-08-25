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
  let lastSyncTs = 0;
  let retries = 0;
  // 同步期事件抑制（死循环第三层防护）：sync() 执行期间置位 syncing。
  // 此期间由 sync 内部（applySnapshot / recompute）产生的事件不应立即调度新同步，
  // 否则会与「重算自增版本」形成跨设备乒乓（已在 bills.recompute 幂等短路、snapshot.needRecompute 中根除根因，此处为防御层）。
  let syncing = false;
  // sync 期间发生的真实本地编辑：先标记，待 sync 结束后补推一次，避免编辑丢失。
  let dirtyDuringSync = false;

  async function doSync(): Promise<void> {
    const now = Date.now();
    // 最小同步间隔节流
    if (now - lastSyncTs < MIN_INTERVAL_MS) return;
    if (!syncStore.isConfigured) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

    lastSyncTs = now;
    syncing = true;
    dirtyDuringSync = false;
    try {
      const res = await syncStore.sync();
      if (res.code === 0) {
        retries = 0;
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

  const offReading = eventBus.on(EVENTS.READING_CHANGED, scheduleSync);
  const offBill = eventBus.on(EVENTS.BILL_RECALCULATED, scheduleSync);
  const offBudget = eventBus.on(EVENTS.BUDGET_CHANGED, scheduleSync);

  function onOnline(): void {
    if (syncStore.isConfigured) void doSync(); // 补推离线期间积压的变更
  }
  function onVisibility(): void {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') flush();
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
      setTimeout(() => void doSync(), STARTUP_DELAY_MS);
    }
  });

  onUnmounted(() => {
    offReading();
    offBill();
    offBudget();
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('beforeunload', onBeforeUnload);
    if (debounceTimer) clearTimeout(debounceTimer);
    if (retryTimer) clearTimeout(retryTimer);
  });

  return { flush };
}

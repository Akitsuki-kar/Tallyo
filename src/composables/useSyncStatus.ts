/**
 * 同步状态（体验⑪）：在线状态 + 待推送本地改动计数。
 * - online：监听 navigator.onLine 与 window 的 online/offline 事件。
 * - pendingCount：本地数据变更事件（读数/账单/预算/房源/单价）发生时 +1，
 *   同步成功（SYNC_DONE）时归零，用于横幅提示「N 项改动待同步」。
 * 模块级单例，App 与 Sync 页共享同一份状态。
 */
import { ref } from 'vue';
import { eventBus, EVENTS } from '@/utils/eventBus';

const online = ref(typeof navigator !== 'undefined' ? navigator.onLine : true);
const pendingCount = ref(0);
let installed = false;

export function useSyncStatus() {
  if (!installed) {
    installed = true;
    const inc = (): void => {
      pendingCount.value++;
    };
    eventBus.on(EVENTS.READING_CHANGED, inc);
    eventBus.on(EVENTS.BILL_RECALCULATED, inc);
    eventBus.on(EVENTS.BUDGET_CHANGED, inc);
    // 房源与单价同样是需要跨设备传播的本地变更，漏统计会让「N 项改动待同步」与实际不符
    eventBus.on(EVENTS.PREMISE_CHANGED, inc);
    eventBus.on(EVENTS.PRICE_CHANGED, inc);
    eventBus.on(EVENTS.SYNC_DONE, () => {
      pendingCount.value = 0;
    });
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        online.value = true;
      });
      window.addEventListener('offline', () => {
        online.value = false;
      });
    }
  }
  return { online, pendingCount };
}

// SPDX-License-Identifier: Apache-2.0
/**
 * 应用入口：挂载 Pinia / Router / PWA，启动初始化（预置默认房源、加载各 store）
 */
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import Vant from 'vant';
import { showToast, showDialog } from 'vant';
import 'vant/lib/index.css';
import App from './App.vue';
import router from './router';
import { registerSW } from 'virtual:pwa-register';

import './styles/variables.css';
import './styles/theme.css';
import './styles/global.css';
import './styles/vant.css'; // Vant 控件深度定制（须位于 vant 默认样式之后）

import { useSettingsStore } from '@/stores/settings';
import { usePremisesStore } from '@/stores/premises';
import { usePricesStore } from '@/stores/prices';
import { useBudgetsStore } from '@/stores/budgets';
import { useReadingsStore } from '@/stores/readings';
import { useBillsStore } from '@/stores/bills';
import { useSyncStore } from '@/stores/sync';
import { useTrashStore } from '@/stores/trash';
import { installExternalLinkInterceptor } from '@/native/openExternal';
import { requestPersistentStorage } from '@/db/database';
import { logger } from '@/utils/logger';
import { markBootstrapFailed, markDataReady } from '@/utils/bootstrapReady';

// 是否生产构建（import.meta.env 在各构建目标均有定义，此处做安全取值）
const IS_PROD = (import.meta as { env?: { PROD?: boolean } }).env?.PROD ?? false;

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(Vant);

// 全局错误兜底：避免渲染 / 运行期异常在生产环境直接白屏。
// 日志始终记录；仅在生产环境弹出轻提示，便于用户感知而非被静默崩溃。
app.config.errorHandler = (err, _instance, info) => {
  const message = err instanceof Error ? err.message : String(err);
  logger.error('[SDB:global]', '渲染/运行异常', { message, info });
  if (IS_PROD) showToast('发生未知错误，请刷新重试');
};
// 未处理的 Promise 异常与全局错误也统一落日志，方便上线后排查。
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason instanceof Error ? event.reason.message : String(event.reason);
  logger.error('[SDB:global]', '未处理的 Promise 异常', { message: reason });
});
window.addEventListener('error', (event) => {
  logger.error('[SDB:global]', '全局错误', { message: event.message });
});

app.mount('#app');

// 全局外链拦截：原生壳里所有 <a href="http(s)://"> 统一调起系统浏览器，
// 避免 WebView 内导航（鸣谢等外链在 Android 上「回不到 App」的根因）。Web 端回退新标签。
installExternalLinkInterceptor();

// 注册 PWA Service Worker（autoUpdate：后台自动更新）。
// Tauri 原生壳下由本地打包保证离线，且 WebView 对 SW 支持有限，故跳过注册。
if (!import.meta.env.TAURI_BUILD) {
  registerSW({ immediate: true });
}

/**
 * 启动初始化：分两阶段加载
 * 1. 首屏必需：settings（主题/defaultView）+ premises（当前房源）
 * 2. 数据加载：prices/budgets/readings 并行 → bills 依赖 readings 后加载
 */
async function bootstrap(): Promise<void> {
  // ── 阶段 1：首屏必需 store（顺序依赖：settings → premises → seedIfEmpty） ──
  const settings = useSettingsStore();
  await settings.load();

  const premises = usePremisesStore();
  await premises.load();
  await premises.seedIfEmpty();

  // 接线 defaultView：尽早跳转，不等待数据 store 加载
  if (settings.defaultView && settings.defaultView !== 'home') {
    router.replace({ name: settings.defaultView });
  }

  // ── 阶段 2：数据 store（并行加载，bills 依赖 readings 最后加载） ──
  const prices = usePricesStore();
  const budgets = useBudgetsStore();
  const readings = useReadingsStore();
  const pid = premises.currentPremiseId;

  await Promise.all([
    prices.load().then(() => (pid ? prices.ensureDefault(pid) : undefined)),
    budgets.load().then(() => (pid ? budgets.ensureDefault(pid) : undefined)),
    readings.load(),
  ]);

  // bills 依赖 readings（recompute 需要），故在 readings 后加载
  const bills = useBillsStore();
  await bills.load();

  // 启动自愈：账单是「读数 × 单价 → 结算取整 → +房租」的派生结果，不是用户录入的事实数据。
  // 任何一次漏重算（版本升级改了计算口径、同步合并时被远端旧账单盖回、异常中断）都会让
  // 库里的账单与当前读数对不上，而此前没有任何入口能纠正它 —— 用户改读数发现账单不变时，
  // 实际看到的往往就是这个历史脏值。这里全量重算一次即可自愈。
  // recomputeAll 幂等：金额没变的月份不写库、不发事件，不会凭空制造同步流量。
  try {
    await bills.recomputeAll();
  } catch (err) {
    // 自愈失败不阻断启动（账单页仍会展示库里的值）
    logger.error('[SDB:bootstrap]', '启动账单自愈重算失败', {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // 发出「核心数据已就绪」信号：settings / premises / readings / bills 均已装载且账单已自愈。
  // 必须早于下面的自清洗与自动备份 —— 那些是 best-effort 后台任务（且自动备份要走网络），
  // 不该让等数据的调用方一起干等。月初账单弹层正是靠这个信号避免读到空房源/未重算的账单，
  // 详见 utils/bootstrapReady.ts 与 composables/useMonthlyBillPrompt.ts。
  markDataReady();

  // 体验⑭：启动自清洗（周清/月清，见 stores/trash.ts）。best-effort，失败不影响主流程。
  // 放在启动账单自愈之后：自愈已把账单口径拉齐，这里再跑去重/重算不会重复做功；
  // 清理产生的永久删除先落本地（含 PurgeMarker），再随随后的自动同步推到各端，
  // 避免出现「本地删了、远端没删」的窗口。频率=off（默认）或从未到期限时本步直接跳过。
  try {
    const trashStore = useTrashStore();
    await trashStore.runAutoCleanupIfDue();
  } catch (err) {
    logger.warn('[SDB:bootstrap]', '启动自清洗跳过', {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // 高优①：申请 IndexedDB 持久化存储，降低浏览器静默清除本地账本的风险（结果已落日志）
  void requestPersistentStorage().then((status) => {
    logger.info('[SDB:bootstrap]', '持久化存储授权结果', { status });
  });

  // 体验⑬：每周自动备份（已配置且用户启用时）。best-effort，失败不影响主流程。
  try {
    const syncStore = useSyncStore();
    // 必须先 loadConfig：runAutoBackup 靠 isConfigured（读 config.enabled）判断，
    // 而配置只在 App.vue 的 useAutoSync.onMounted 里异步加载。
    // 此前两者是并发的，谁先跑完取决于 IndexedDB 往返时序——
    // 配置后到就永远走不到备份分支，等于「每周自动备份」形同虚设。
    await syncStore.loadConfig();
    await syncStore.runAutoBackup();
  } catch (err) {
    logger.warn('[SDB:bootstrap]', '启动时自动备份跳过', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

// 初始化失败也应优雅提示（而非白屏），并落日志便于排查。
bootstrap()
  .catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[SDB:bootstrap]', '初始化失败', { message });
    showDialog({ title: '启动失败', message: '初始化数据失败，请刷新页面重试' }).catch(() => {});
  })
  .finally(() => {
    // 兜底：bootstrap 自身抛错时上面的 markDataReady 不会执行，
    // 这里补一次标记，避免所有 await whenDataReady() 的调用方（月初账单弹层）永久挂起。
    // 已就绪时 markBootstrapFailed 内部会直接返回，不会覆盖成功状态。
    markBootstrapFailed(new Error('bootstrap 未完成'));
  });

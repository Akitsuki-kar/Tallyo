<script setup lang="ts">
// 应用根组件：布局壳 = 全局顶栏 + <router-view> + 底部/侧边 TabBar
// 接入 PWA 安装提示；监听 theme:changed 同步主题状态。
// 首启检测：未完成新手引导时启动 OnboardingFlow（沉浸式卡片向导），
// 向导走完全程后接 TourOverlay（聚光灯交互导览）。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import AppHeader from '@/components/common/AppHeader.vue';
import AppTabBar from '@/components/common/AppTabBar.vue';
import OnboardingFlow from '@/components/onboarding/OnboardingFlow.vue';
import TourOverlay from '@/components/onboarding/TourOverlay.vue';
import type { TourStep } from '@/components/onboarding/TourOverlay.vue';
import { usePWAInstall } from '@/composables/usePWAInstall';
import { useTheme } from '@/composables/useTheme';
import { useAutoSync } from '@/composables/useAutoSync';
import { isOnboarded } from '@/composables/useOnboarding';
import { useMonthlyBillPrompt } from '@/composables/useMonthlyBillPrompt';
import type { ShowLastMonthResult } from '@/composables/useMonthlyBillPrompt';
import { useSettingsStore } from '@/stores/settings';
import { usePremisesStore } from '@/stores/premises';
import { showToast } from 'vant';
import { eventBus, EVENTS } from '@/utils/eventBus';
import { logger } from '@/utils/logger';
import { dateKey } from '@/utils/dayjs';
import type { ThemeMode } from '@/types';
import { useSyncStatus } from '@/composables/useSyncStatus';
import { useUndo } from '@/composables/useUndo';
import { useStoragePersistence } from '@/composables/useStoragePersistence';
import QuickRecordPopup from '@/components/readings/QuickRecordPopup.vue';
import MonthlyBillModal from '@/components/bills/MonthlyBillModal.vue';

const router = useRouter();
const { canInstall, prompt } = usePWAInstall();
const { toggle } = useTheme();
const settings = useSettingsStore();
const premises = usePremisesStore();
// 体验⑪：在线状态 + 待同步改动计数（横幅展示）
const { online, pendingCount } = useSyncStatus();
// 体验⑫：撤销条（删除操作后出现的 5 秒撤销）
// 注意：必须解构成顶层 ref，Vue 模板才会自动解包；若直接 v-if="undo.visible"，
// 访问的是未解包的 ref 对象（恒为真），会导致撤销条误全局常驻显示。
const { visible: undoVisible, label: undoLabel, run: undoRun } = useUndo();
// 高优①：持久化存储授权状态（未授权时提示用户手动开启）
const { status: storageStatus } = useStoragePersistence();

const STORAGE_BANNER_KEY = 'sdb:storageBannerDismissed';
const storageDismissed = ref(false);
try {
  storageDismissed.value = localStorage.getItem(STORAGE_BANNER_KEY) === '1';
} catch {
  /* 隐私模式忽略 */
}
const showStorageBanner = computed(
  () => !storageDismissed.value && (storageStatus.value === 'prompt' || storageStatus.value === 'denied'),
);
function dismissStorageBanner(): void {
  storageDismissed.value = true;
  try {
    localStorage.setItem(STORAGE_BANNER_KEY, '1');
  } catch {
    /* 忽略写入失败 */
  }
}

const showSyncBanner = computed(() => !online.value || pendingCount.value > 0);
const syncBannerText = computed(() =>
  !online.value ? '当前离线，改动将在联网后自动同步' : `有 ${pendingCount.value} 项改动待同步`,
);
// 接入自动同步（启动拉取 + 变更防抖推送），不改变既有 PWA / 主题 / 快速记录逻辑
useAutoSync();
const theme = ref<ThemeMode>('light');
const installDismissed = ref(false);
const installVisible = ref(false);

// ---- 新手引导状态 ----
const showOnboarding = ref(false);
const showTour = ref(false);

/** Tour 步骤（首页视角）：房源切换 → 记一笔 → 主导航 */
const tourSteps: TourStep[] = [
  {
    selector: '.sdb-home__top',
    title: '切换房源',
    text: '多套房子分开记。点这里的胶囊就能切换，新房可在设置里添加。',
  },
  {
    selector: '.sdb-home__actions',
    title: '记一笔读数',
    text: '看到电表/水表上的数字，点这里记下来，费用自动算好。',
  },
  {
    selector: '.sdb-tabbar',
    title: '这里都能去',
    text: '账单、统计图表、预算预警、设置都在这个导航里。',
  },
];

// 全局快速记录弹窗引用；'daily' 档的防重复标记按「日期」持久化（每天最多弹一次）
const QUICK_POP_KEY = 'sdb:lastQuickPopDate';
const quickRef = ref<InstanceType<typeof QuickRecordPopup> | null>(null);

function getLastQuickPopDate(): string {
  try {
    return localStorage.getItem(QUICK_POP_KEY) ?? '';
  } catch {
    return '';
  }
}
function setLastQuickPopDate(value: string): void {
  try {
    localStorage.setItem(QUICK_POP_KEY, value);
  } catch {
    /* 隐私模式等场景忽略写入失败 */
  }
}

// ---- 月初账单弹层（0.1.1 功能 5）----
// 判定逻辑已抽到 composables/useMonthlyBillPrompt.ts。抽出来的原因是实现有四道硬伤，
// 靠在 onMounted 里补 await 修不好（调用点一多就会漏）：
//   ① 原先直接读 premises.currentPremiseId，而房源是 bootstrap 自己加载的，
//      App.vue 的微任务还排在 bootstrap 前面 —— 拿到恒为空串，功能 100% 失效；
//      现在统一 await「启动数据就绪」信号，顺序由 bootstrap 一处保证。
//   ② 原先严格限定 1 号，用户 2、3 号才打开就永远看不到；现在放宽到月初 1~3 号窗口。
//   ③ 原先只在 onMounted 判一次，桌面端/手机常驻跨过月末零点后不再触发；
//      现在常驻监听跨日与回前台。
//   ④ 原先读到的是账单自愈重算之前的值；现在弹出前对上月做一次定向重算。
const {
  bill: monthlyBill,
  visible: showMonthlyBill,
  close: closeMonthlyBill,
  start: startMonthlyPrompt,
  stop: stopMonthlyPrompt,
  showLastMonthBill,
} = useMonthlyBillPrompt({
  // 引导 / Tour 占屏时不叠加弹层
  canShow: () => !showOnboarding.value && !showTour.value,
});

/**
 * 设置页「查看上月结算单」→ 主动唤起同一个弹层。
 *
 * 弹层由 App.vue 持有（覆盖全屏、层级统一），设置页只发一条指令事件，
 * 不自己再挂一份 MonthlyBillModal —— 两份实例会有两套打印动画状态与层级冲突。
 * 失败必须给回执：静默失败最容易让人以为「点了没反应」。
 */
const SHOW_RESULT_MESSAGE: Record<Exclude<ShowLastMonthResult, 'shown' | 'busy'>, string> = {
  'not-ready': '数据还在加载，请稍后再试',
  'no-premise': '还没有房源，先添加一套房子吧',
  'no-bill': '上月没有读数记录，暂时没有结算单',
  empty: '上月账单没有金额也没有用量，无需展示',
};
async function onRequestMonthlyBill(): Promise<void> {
  const result = await showLastMonthBill();
  // 收窄掉无需提示的两态，剩下的按表回执；不用类型断言，避免以后新增状态时静默漏配文案
  if (result === 'shown' || result === 'busy') return;
  showToast(SHOW_RESULT_MESSAGE[result]);
}

const showInstall = computed(() => canInstall.value && !installDismissed.value);

watch(canInstall, (v) => {
  if (v) installVisible.value = true;
});

function onThemeChanged(mode: unknown): void {
  theme.value = (mode as ThemeMode) ?? 'light';
}
// 后台冻结：App 隐藏/显示时给 <html> 切换 .is-hidden，
// 配合 global.css 暂停所有 CSS 动画（省电，见功耗优化）。
function onVisibilityPause(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('is-hidden', document.visibilityState === 'hidden');
}
/**
 * 顶栏主题切换。
 *
 * 仅调 useTheme().toggle() 是不够的：它只写 localStorage['sdb:theme'] 与 data-theme，
 * 不动 settings store，也不进 IndexedDB。后果有三：
 *   ① 刷新后 settings.load() 会用库里的旧主题重新 applyThemeMode，视觉上「切完又跳回去」；
 *   ② 设置页的主题分段控件仍显示旧值，与顶栏状态对不上；
 *   ③ 主题永远不会同步到其它设备（同步读的是库里的 settings）。
 * 因此切换后必须回写 settings store，让 IndexedDB 成为主题的唯一事实来源。
 */
async function onToggleTheme(): Promise<void> {
  const next = toggle();
  try {
    await settings.update({ theme: next });
  } catch (err) {
    logger.error('app', '保存主题失败', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
function onInstall(): void {
  void prompt();
  installVisible.value = false;
}
function onDismissInstall(): void {
  installVisible.value = false;
  installDismissed.value = true;
}

// ---- 侧栏「记一笔」：打开全局快速记录弹窗 ----
function onQuickRecord(): void {
  quickRef.value?.open();
}

// ---- 新手引导流转 ----
/** 向导完成/跳过；全程走完（tour=true）→ 回首页接交互式 Tour（等路由与 DOM 就绪再挂载） */
async function onOnboardingDone(opts: { tour: boolean }): Promise<void> {
  showOnboarding.value = false;
  if (opts.tour) {
    await router.push('/');
    await nextTick();
    showTour.value = true;
  }
}
function onTourFinish(): void {
  showTour.value = false;
}
/** 设置页「重看新手引导」：清标记（已由设置页完成）后重开向导 */
function onOnboardingReplay(): void {
  showTour.value = false;
  showOnboarding.value = true;
}

onMounted(async () => {
  const saved = (typeof document !== 'undefined'
    ? document.documentElement.getAttribute('data-theme')
    : null) as ThemeMode | null;
  theme.value = saved ?? 'light';
  eventBus.on(EVENTS.THEME_CHANGED, onThemeChanged);
  eventBus.on(EVENTS.QUICK_RECORD, onQuickRecord);
  eventBus.on(EVENTS.ONBOARDING_REPLAY, onOnboardingReplay);
  eventBus.on(EVENTS.REQUEST_MONTHLY_BILL, onRequestMonthlyBill);
  document.addEventListener('visibilitychange', onVisibilityPause);
  onVisibilityPause(); // 初始化时同步一次（处理已处于后台的极端情况）

  // 首启：未完成引导 → 直接进入沉浸式向导（当日不再弹快速记录，避免叠加打扰）
  const onboarded = isOnboarded();
  if (!onboarded) {
    showOnboarding.value = true;
  }

  // 启动自动弹出。设置未就绪时先补一次 load，
  // 否则首屏读到的是 store 默认值，用户开过的档位会被当成「关闭」而漏弹。
  try {
    if (!settings.loaded) {
      await settings.load();
    }
    // 月初账单：与是否进入引导无关地常驻启动（判定内部还会再挡一次引导状态），
    // 这样用户中途完成引导后，跨日 / 回前台时依然能正常补弹。
    startMonthlyPrompt();
    if (onboarded) {
      // ① 快速记录：off 不弹 / daily 每天首次 / always 每次启动都弹
      const mode = settings.quickRecordPop;
      if (mode === 'always') {
        quickRef.value?.open();
      } else if (mode === 'daily') {
        const today = dateKey();
        if (getLastQuickPopDate() !== today) {
          setLastQuickPopDate(today);
          quickRef.value?.open();
        }
      }
    }
  } catch (err) {
    logger.error('app', '读取设置或启动自动弹窗失败', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

onBeforeUnmount(() => {
  eventBus.off(EVENTS.THEME_CHANGED, onThemeChanged);
  eventBus.off(EVENTS.QUICK_RECORD, onQuickRecord);
  eventBus.off(EVENTS.ONBOARDING_REPLAY, onOnboardingReplay);
  eventBus.off(EVENTS.REQUEST_MONTHLY_BILL, onRequestMonthlyBill);
  document.removeEventListener('visibilitychange', onVisibilityPause);
  stopMonthlyPrompt();
});
</script>

<template>
  <div class="sdb-shell">
    <AppHeader>
      <template #actions>
        <button
          class="sdb-header__btn"
          type="button"
          :aria-label="theme === 'dark' ? '切换浅色' : '切换深色'"
          @click="onToggleTheme"
        >
          <van-icon :name="theme === 'dark' ? 'sunny-o' : 'moon-o'" />
        </button>
      </template>
    </AppHeader>

    <!-- 高优①：持久化存储未授权提示（可关闭，仅提示不阻断） -->
    <div v-if="showStorageBanner" class="sdb-banner sdb-banner--info">
      <span class="sdb-banner__text">建议允许浏览器「永久保存站点数据」，避免账本被清理。可在浏览器站点设置中开启。</span>
      <button class="sdb-banner__close" type="button" aria-label="关闭提示" @click="dismissStorageBanner">×</button>
    </div>

    <!-- 体验⑪：离线 / 待同步横幅 -->
    <div v-if="showSyncBanner" class="sdb-banner sdb-banner--warn">
      <van-icon :name="online ? 'upgrade' : 'pause-circle-o'" />
      <span class="sdb-banner__text">{{ syncBannerText }}</span>
    </div>

    <main class="sdb-main">
      <router-view />
    </main>

    <AppTabBar />

    <!-- 体验⑫：删除操作后的撤销条（仅在真实删除后由 useUndo.offer 触发显示，5 秒自动消失） -->
    <div v-if="undoVisible" class="sdb-undo-snackbar" role="status">
      <span class="sdb-undo-snackbar__text">{{ undoLabel }}</span>
      <button class="sdb-undo-snackbar__btn" type="button" @click="undoRun">撤销</button>
    </div>

    <van-dialog
      v-model:show="installVisible"
      title="安装到主屏"
      message="将「水电动账」安装到手机主屏，离线也能快速记账。"
      confirm-button-text="安装"
      cancel-button-text="暂不"
      show-cancel-button
      confirm-button-color="var(--sdb-primary)"
      @confirm="onInstall"
      @cancel="onDismissInstall"
    />

    <!-- 全局快速记录弹窗（启动可按设置自动弹出） -->
    <QuickRecordPopup ref="quickRef" />

    <!-- 月初账单弹层：每月 1 号自动弹出上月结算单（打印特效 + 导出 PDF） -->
    <MonthlyBillModal
      v-if="showMonthlyBill && monthlyBill"
      :bill="monthlyBill"
      :premise-name="premises.currentPremise?.name ?? ''"
      :template-id="settings.templateId"
      @close="closeMonthlyBill"
    />

    <!-- 新手引导：沉浸式卡片向导（首启 / 设置页重看） -->
    <OnboardingFlow v-if="showOnboarding" @done="onOnboardingDone" />

    <!-- 交互式 Tour（向导全程走完后，在首页高亮关键功能区） -->
    <TourOverlay v-if="showTour" :steps="tourSteps" @finish="onTourFinish" />
  </div>
</template>

<style scoped>
.sdb-shell{
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  /* 壳固定视口高、自身不滚动；改为 flex 列：顶栏(固定) + 主内容区(可滚动) + 底栏(fixed) */
  display: flex;
  flex-direction: column;
}

.sdb-header__btn {
  background: transparent;
  border: none;
  color: var(--sdb-text);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
}

/* 顶部提示横幅（持久化提示 / 离线·待同步） */
.sdb-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  font-size: 13px;
  line-height: 1.4;
}
.sdb-banner--info {
  background: color-mix(in oklch, var(--sdb-honey, #e8b04b) 22%, var(--sdb-paper, #faf6ee));
  color: var(--sdb-text, #3a332b);
}
.sdb-banner--warn {
  background: color-mix(in oklch, var(--sdb-terracotta, #ef7a2e) 18%, var(--sdb-paper, #faf6ee));
  color: var(--sdb-text, #3a332b);
}
.sdb-banner__text {
  flex: 1;
}
.sdb-banner__close {
  background: transparent;
  border: none;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  color: var(--sdb-text-tertiary, #8a8073);
}

/* 删除撤销条 */
.sdb-undo-snackbar {
  position: fixed;
  left: 50%;
  bottom: calc(64px + env(safe-area-inset-bottom, 0px));
  transform: translateX(-50%);
  z-index: 2000;
  display: flex;
  align-items: center;
  gap: 14px;
  max-width: calc(100vw - 32px);
  padding: 10px 14px;
  border-radius: 12px;
  background: var(--sdb-ink, #2c2722);
  color: #fff;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
}
.sdb-undo-snackbar__text {
  font-size: 14px;
}
.sdb-undo-snackbar__btn {
  flex-shrink: 0;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.5);
  color: #fff;
  border-radius: 8px;
  padding: 4px 12px;
  font-size: 14px;
  cursor: pointer;
}
</style>

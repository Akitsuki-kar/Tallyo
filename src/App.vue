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
import { useSettingsStore } from '@/stores/settings';
import { eventBus, EVENTS } from '@/utils/eventBus';
import { logger } from '@/utils/logger';
import { dateKey } from '@/utils/dayjs';
import type { ThemeMode } from '@/types';
import { useSyncStatus } from '@/composables/useSyncStatus';
import { useUndo } from '@/composables/useUndo';
import { useStoragePersistence } from '@/composables/useStoragePersistence';
import QuickRecordPopup from '@/components/readings/QuickRecordPopup.vue';

const router = useRouter();
const { canInstall, prompt } = usePWAInstall();
const { toggle } = useTheme();
const settings = useSettingsStore();
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

// 全局快速记录弹窗引用；自动弹防重复：按「日期」持久化（每天最多弹一次）
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

const showInstall = computed(() => canInstall.value && !installDismissed.value);

watch(canInstall, (v) => {
  if (v) installVisible.value = true;
});

function onThemeChanged(mode: unknown): void {
  theme.value = (mode as ThemeMode) ?? 'light';
}
function onToggleTheme(): void {
  toggle();
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

  // 首启：未完成引导 → 直接进入沉浸式向导（当日不再弹快速记录，避免叠加打扰）
  const onboarded = isOnboarded();
  if (!onboarded) {
    showOnboarding.value = true;
  }

  // 启动自动弹出快速记录（若设置开启，且未进入新手引导）。按日期持久化，避免每天重复弹。
  try {
    if (!settings.autoPopQuickRecord) {
      await settings.load();
    }
    if (settings.autoPopQuickRecord && onboarded) {
      const today = dateKey();
      if (getLastQuickPopDate() !== today) {
        setLastQuickPopDate(today);
        quickRef.value?.open();
      }
    }
  } catch (err) {
    logger.error('app', '读取设置或弹出快速记录失败', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

onBeforeUnmount(() => {
  eventBus.off(EVENTS.THEME_CHANGED, onThemeChanged);
  eventBus.off(EVENTS.QUICK_RECORD, onQuickRecord);
  eventBus.off(EVENTS.ONBOARDING_REPLAY, onOnboardingReplay);
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

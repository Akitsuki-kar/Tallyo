<script setup lang="ts">
/**
 * 个性化设置页（重排版 · 分区卡片流）
 *
 * 信息架构（按 docs/prototypes/settings-redesign.html 原型落地）：
 * 1. 概览卡：进设置先回答「我在记哪本账」——当前房源 + 读数/账单/房源/上次同步四项指标 + 同步状态点。
 * 2. 房源（跨两列，最高频）：bare 模式嵌入 PremiseManager。
 * 3. 外观：主题三档改卡内分段控件（少一次点击）。
 * 4. 行为：自动弹开关 + 默认视图（保留 action-sheet，5 项需上下文）。
 * 5. 账单：默认模板改 4 个缩略磁贴，一眼挑。
 * 6. 数据：单价/同步/导出/导入 + 设备密钥备份（低频带风险，默认折叠，bare 模式嵌入 DeviceKeyBackup）。
 * 7. 关于：版本 + 作者/鸣谢/引导/安装 压成一行胶囊 chips。
 *
 * 严格手作美学 token + Vant 深度定制；桌面 ≥1024 分组双栏，平板 ≥768 出侧栏（壳层）。
 */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import dayjs from 'dayjs';
import { showSuccessToast, showToast, showConfirmDialog } from 'vant';
import { useSettingsStore } from '@/stores/settings';
import { usePremisesStore } from '@/stores/premises';
import { usePricesStore } from '@/stores/prices';
import { useReadingsStore } from '@/stores/readings';
import { useBillsStore } from '@/stores/bills';
import { useSyncStore } from '@/stores/sync';
import { usePWAInstall } from '@/composables/usePWAInstall';
import { useSyncStatus } from '@/composables/useSyncStatus';
import { useTrashStore } from '@/stores/trash';
import { exportData, importData } from '@/utils/dataExport';
import { logger } from '@/utils/logger';
import { formatMonthLabel, monthKey, prevMonthKey } from '@/utils/dayjs';
import type { DefaultView, BillTemplateId, ThemeMode, QuickRecordPop } from '@/types';
import PriceSettingPanel from '@/components/settings/PriceSettingPanel.vue';
import PremiseManager from '@/components/settings/PremiseManager.vue';
import DeviceKeyBackup from '@/components/settings/DeviceKeyBackup.vue';
import CreditsPopup from '@/components/settings/CreditsPopup.vue';
import { eventBus, EVENTS } from '@/utils/eventBus';

const router = useRouter();
const settingsStore = useSettingsStore();
const premises = usePremisesStore();
const prices = usePricesStore();
const readings = useReadingsStore();
const bills = useBillsStore();
const syncStore = useSyncStore();
const trashStore = useTrashStore();
const { canInstall, prompt: promptInstall } = usePWAInstall();
const { online } = useSyncStatus();
// 版本号由 vite 构建时从 package.json 注入（__APP_VERSION__），唯一事实来源，改版本只动 package.json。
const appVersion = __APP_VERSION__;

const { theme, quickRecordPop, autoMonthlyBill, defaultView, templateId } = storeToRefs(settingsStore);

const pricePanelRef = ref<InstanceType<typeof PriceSettingPanel> | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const exporting = ref(false);
const importing = ref(false);
// 开源致谢弹层显隐
const showCredits = ref(false);
// 作者信息弹层显隐
const showAuthorSheet = ref(false);
// 作者信息（静态展示，不跳转外部链接）
const AUTHOR_NAME = 'Akitsuki-Kar';
const AUTHOR_SIGNATURE = '挑灯醉看星如海，岁岁长随若有缘';

// ---- 概览卡数据 ----
const currentPremise = computed(() => premises.list.find((p) => p.id === premises.currentPremiseId) ?? null);
const currentInitial = computed(() => currentPremise.value?.name?.charAt(0) ?? '账');
const premiseCount = computed(() => premises.list.length);
const readingsTotal = computed(() => readings.items.filter((r) => !r.isDeleted).length);
const billsTotal = computed(() => bills.billList.length);
// ---- 回收站入口摘要 ----
// 设置页只做「概览」：具体的恢复 / 清理动作都在回收站页，避免这里出现高危操作入口。
const trashCount = computed(() => trashStore.count);
const trashHint = computed(() => {
  if (trashCount.value === 0) return '没有待处理的删除记录';
  if (trashStore.expiringCount > 0) return `${trashStore.expiringCount} 条已到期，可清理`;
  return '可恢复或彻底删除';
});
const lastSyncLabel = computed(() => {
  const t = syncStore.lastSyncAt;
  if (!t) return '未同步';
  return dayjs(t).format('MM-DD HH:mm');
});

// ---- 默认视图选择器 ----
const showViewPicker = ref(false);
const viewActions = [
  { name: '首页', value: 'home' as const },
  { name: '读数', value: 'readings' as const },
  { name: '账单', value: 'bills' as const },
  { name: '统计', value: 'stats' as const },
  { name: '预算', value: 'budget' as const },
];
const viewLabel = computed(() => {
  const a = viewActions.find((x) => x.value === defaultView.value);
  return a ? a.name : '首页';
});
function onViewSelect(action: { value: DefaultView }): void {
  settingsStore.update({ defaultView: action.value });
  showViewPicker.value = false;
}

// ---- 主题切换（卡内三段控件）----
const themeDefs: { name: string; value: ThemeMode }[] = [
  { name: '浅色', value: 'light' },
  { name: '深色', value: 'dark' },
  { name: '跟随系统', value: 'auto' },
];
function onThemeSelect(value: ThemeMode): void {
  settingsStore.update({ theme: value });
}

// ---- 模板磁贴 ----
const templateDefs: { name: string; value: BillTemplateId }[] = [
  { name: '小票风', value: 'receipt' },
  { name: '极简风', value: 'minimal' },
  { name: '卡片风', value: 'card' },
  { name: '报表风', value: 'report' },
];

// ---- 启动自动弹快速记录（0.1.1：关闭 / 每天首次 / 每次打开 三档） ----
// 沿用「默认视图」的行 + action-sheet 形态而非分段控件：三个选项文案偏长，
// 塞进一行分段控件在窄屏会截断，且这项是低频设置，多一次点击换来可读性是值得的。
const showQuickPopPicker = ref(false);
const quickPopActions: { name: string; value: QuickRecordPop; desc: string }[] = [
  { name: '关闭', value: 'off', desc: '启动时不打扰' },
  { name: '每天首次打开', value: 'daily', desc: '每天第一次进入时弹一次' },
  { name: '每次打开', value: 'always', desc: '每次进入应用都弹' },
];
const quickPopLabel = computed(
  () => quickPopActions.find((a) => a.value === quickRecordPop.value)?.name ?? '关闭',
);
const quickPopDesc = computed(
  () => quickPopActions.find((a) => a.value === quickRecordPop.value)?.desc ?? '启动时不打扰',
);
function onQuickPopSelect(value: QuickRecordPop): void {
  settingsStore.update({ quickRecordPop: value });
  showQuickPopPicker.value = false;
}

// ---- 月初自动弹上月账单 ----
function onMonthlyBillToggle(val: boolean): void {
  settingsStore.update({ autoMonthlyBill: val });
}

/**
 * 主动唤起上月结算单（与月初自动弹出完全同一套打印特效）。
 *
 * 弹层由 App.vue 持有，这里只发一条指令事件，回执（无房源 / 无账单 / 空账单）
 * 也由 App.vue 统一 toast —— 设置页不需要为了弹一个浮层去重复持有账单计算与模板状态。
 */
function onShowLastMonthBill(): void {
  eventBus.emit(EVENTS.REQUEST_MONTHLY_BILL);
}
/**
 * 「查看上月结算单」副标题：把具体月份说出来，用户点之前就知道会看到哪张票。
 *
 * 刻意用函数而不是 computed —— computed 只依赖「当前时间」，没有任何响应式依赖，
 * 求值一次就会被永久缓存，页面停留在设置页跨过月末后标签不会更新（时间不是响应式数据）。
 * 放在模板里每次渲染现算，成本可忽略。
 */
function prevMonthLabel(): string {
  return formatMonthLabel(prevMonthKey(monthKey()));
}

// ---- 导出数据 ----
async function onExport(): Promise<void> {
  exporting.value = true;
  try {
    const res = await exportData();
    if (res.outcome === 'saved') {
      showSuccessToast(`已导出：${res.path}`);
    } else if (res.outcome === 'downloaded') {
      showSuccessToast('已开始下载，请查看浏览器下载目录（文件以「水电动账-」开头）');
    }
  } catch {
    showToast('导出失败，请重试');
  } finally {
    exporting.value = false;
  }
}

// ---- 导入数据 ----
function triggerImport(): void {
  fileInputRef.value?.click();
}
async function onFileSelected(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    await showConfirmDialog({
      title: '导入数据',
      message: '导入数据将与本地数据按 LWW 合并（新数据优先）。建议先导出备份。',
    });
  } catch {
    input.value = '';
    return;
  }
  importing.value = true;
  try {
    const stats = await importData(file);
    showSuccessToast(`导入完成：合并 ${stats.pulled} 条，冲突 ${stats.conflicts} 处`);
  } catch {
    showToast('文件无效或导入失败');
  } finally {
    importing.value = false;
    input.value = '';
  }
}

// ---- 水电单价面板 ----
function openPricePanel(): void {
  pricePanelRef.value?.open();
}

// ---- 重看新手引导 ----
function replayOnboarding(): void {
  router.push('/');
  eventBus.emit(EVENTS.ONBOARDING_REPLAY);
}

// ---- 设备密钥备份折叠 ----
const keyFoldOpen = ref(false);

// ---- 生命周期 ----
onMounted(async () => {
  try {
    if (premises.list.length === 0) {
      await premises.load();
      await premises.seedIfEmpty();
    }
    if (premises.currentPremiseId) await prices.ensureDefault(premises.currentPremiseId);
    if (!readings.items.length) await readings.load();
    if (!bills.billList.length) await bills.load();
    // 回收站计数是设置页的一个角标，进页时拉一次即可（列表本体在回收站页才需要完整数据）
    await trashStore.load();
  } catch (err) {
    logger.error('settings:view', '初始化设置页失败', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
});
</script>

<template>
  <div class="sdb-settings">
    <h2 class="sdb-page-title">设置</h2>

    <!-- 概览 / 身份卡 -->
    <section class="sdb-ov">
      <div class="sdb-ov__top">
        <div class="sdb-ov__badge">{{ currentInitial }}</div>
        <div class="sdb-ov__meta">
          <div class="sdb-ov__label">当前房源</div>
          <div class="sdb-ov__name">{{ currentPremise?.name ?? '—' }}</div>
          <div class="sdb-ov__sub">共 {{ premiseCount }} 处房源</div>
        </div>
        <span class="sdb-ov__sync" :class="{ 'is-off': !online }">
          <i></i>{{ online ? '在线' : '离线' }}
        </span>
      </div>
      <div class="sdb-ov__stats">
        <div class="sdb-stat">
          <span class="sdb-stat__n">{{ readingsTotal }}</span>
          <span class="sdb-stat__l">读数</span>
        </div>
        <div class="sdb-stat">
          <span class="sdb-stat__n">{{ billsTotal }}</span>
          <span class="sdb-stat__l">账单</span>
        </div>
        <div class="sdb-stat">
          <span class="sdb-stat__n">{{ premiseCount }}</span>
          <span class="sdb-stat__l">房源</span>
        </div>
        <div class="sdb-stat">
          <span class="sdb-stat__n sdb-stat__n--sm">{{ lastSyncLabel }}</span>
          <span class="sdb-stat__l">上次同步</span>
        </div>
      </div>
    </section>

    <!-- 桌面 ≥1024px：分组双栏排布，减少长滚动 -->
    <div class="sdb-settings-grid">
      <!-- 房源（跨两列，最高频） -->
      <section class="sdb-sec sdb-sec--span2">
        <span class="sdb-sec__tape"></span>
        <h3 class="sdb-sec__title">房源 <small>点一下切换</small></h3>
        <PremiseManager bare />
      </section>

      <!-- 外观 -->
      <section class="sdb-sec">
        <span class="sdb-sec__tape"></span>
        <h3 class="sdb-sec__title">外观</h3>
        <div class="sdb-seg" role="group" aria-label="主题模式">
          <button
            v-for="t in themeDefs"
            :key="t.value"
            type="button"
            class="sdb-seg__i"
            :class="{ 'is-on': theme === t.value }"
            :aria-pressed="theme === t.value"
            @click="onThemeSelect(t.value)"
          >
            {{ t.name }}
          </button>
        </div>
      </section>

      <!-- 行为 -->
      <section class="sdb-sec">
        <span class="sdb-sec__tape"></span>
        <h3 class="sdb-sec__title">行为</h3>
        <div class="sdb-row" role="button" tabindex="0" @click="showQuickPopPicker = true">
          <span class="sdb-row__ico">⚡</span>
          <span class="sdb-row__txt">
            <span class="sdb-row__t">启动自动弹快速记录</span>
            <span class="sdb-row__d">{{ quickPopDesc }}</span>
          </span>
          <span class="sdb-row__v">{{ quickPopLabel }}</span>
          <span class="sdb-row__chev">›</span>
        </div>
        <div class="sdb-row" role="button" tabindex="0" @click="onMonthlyBillToggle(!autoMonthlyBill)">
          <span class="sdb-row__ico">🧾</span>
          <span class="sdb-row__txt">
            <span class="sdb-row__t">月初自动弹上月账单</span>
            <span class="sdb-row__d">每月 1 号按默认模板打印上月结算单</span>
          </span>
          <button
            class="sdb-sw"
            :class="{ 'is-on': autoMonthlyBill }"
            type="button"
            role="switch"
            :aria-checked="autoMonthlyBill"
            aria-label="月初自动弹上月账单"
            @click.stop="onMonthlyBillToggle(!autoMonthlyBill)"
          ></button>
        </div>
        <div class="sdb-row" role="button" tabindex="0" @click="onShowLastMonthBill">
          <span class="sdb-row__ico">📄</span>
          <span class="sdb-row__txt">
            <span class="sdb-row__t">查看上月结算单</span>
            <span class="sdb-row__d">按默认模板打印 {{ prevMonthLabel() }} 的结算单</span>
          </span>
          <span class="sdb-row__chev">›</span>
        </div>
        <div class="sdb-row" role="button" tabindex="0" @click="showViewPicker = true">
          <span class="sdb-row__ico">🧭</span>
          <span class="sdb-row__txt"><span class="sdb-row__t">默认视图</span></span>
          <span class="sdb-row__v">{{ viewLabel }}</span>
          <span class="sdb-row__chev">›</span>
        </div>
      </section>

      <!-- 账单 -->
      <section class="sdb-sec">
        <span class="sdb-sec__tape"></span>
        <h3 class="sdb-sec__title">账单</h3>
        <div class="sdb-tpls">
          <button
            v-for="t in templateDefs"
            :key="t.value"
            type="button"
            class="sdb-tpl"
            :class="{ 'is-on': templateId === t.value }"
            :aria-pressed="templateId === t.value"
            @click="settingsStore.update({ templateId: t.value })"
          >
            <span class="sdb-tpl__thumb" :class="`sdb-tpl__thumb--${t.value}`"><i></i><i></i><i></i></span>
            <span>{{ t.name }}</span>
          </button>
        </div>
      </section>

      <!-- 数据 -->
      <section class="sdb-sec">
        <span class="sdb-sec__tape"></span>
        <h3 class="sdb-sec__title">数据 <small>本地优先 · 可随时带走</small></h3>
        <div class="sdb-row" role="button" tabindex="0" @click="openPricePanel">
          <span class="sdb-row__ico">💧</span>
          <span class="sdb-row__txt"><span class="sdb-row__t">水电单价</span></span>
          <span class="sdb-row__chev">›</span>
        </div>
        <div class="sdb-row" role="button" tabindex="0" @click="router.push('/sync')">
          <span class="sdb-row__ico">🔁</span>
          <span class="sdb-row__txt">
            <span class="sdb-row__t">数据同步</span>
            <span class="sdb-row__d">坚果云 · 已开启</span>
          </span>
          <span class="sdb-row__v">{{ online ? '已同步' : '离线' }}</span>
          <span class="sdb-row__chev">›</span>
        </div>
        <div class="sdb-row" role="button" tabindex="0" @click="router.push('/trash')">
          <span class="sdb-row__ico">🗑️</span>
          <span class="sdb-row__txt">
            <span class="sdb-row__t">回收站</span>
            <span class="sdb-row__d">{{ trashHint }}</span>
          </span>
          <span v-if="trashCount > 0" class="sdb-row__v">{{ trashCount }} 条</span>
          <span class="sdb-row__chev">›</span>
        </div>
        <div class="sdb-row" role="button" tabindex="0" @click="onExport">
          <span class="sdb-row__ico">📤</span>
          <span class="sdb-row__txt">
            <span class="sdb-row__t">导出数据</span>
            <span class="sdb-row__d">{{ exporting ? '导出中…' : '导出为 JSON 备份' }}</span>
          </span>
          <span class="sdb-row__chev">›</span>
        </div>
        <div class="sdb-row" role="button" tabindex="0" @click="triggerImport">
          <span class="sdb-row__ico">📥</span>
          <span class="sdb-row__txt">
            <span class="sdb-row__t">导入数据</span>
            <span class="sdb-row__d">按 LWW 合并，新数据优先</span>
          </span>
          <span class="sdb-row__chev">›</span>
        </div>

        <!-- 设备密钥备份：低频带风险，默认折叠，bare 模式嵌入 -->
        <div class="sdb-fold" :class="{ 'is-open': keyFoldOpen }">
          <button class="sdb-fold__head" type="button" :aria-expanded="keyFoldOpen" @click="keyFoldOpen = !keyFoldOpen">
            <span class="sdb-row__ico">🔑</span>
            <span class="sdb-row__txt"><span class="sdb-row__t">设备密钥备份</span></span>
            <span class="sdb-fold__caret">›</span>
          </button>
          <div v-show="keyFoldOpen" class="sdb-fold__body">
            <p class="sdb-fold__note">
              换机或重装时用它恢复加密数据。备份文件由你设置的口令二次加密，设备密钥明文不会离开本机。
            </p>
            <DeviceKeyBackup bare />
          </div>
        </div>
      </section>

      <!-- 关于 -->
      <section class="sdb-sec">
        <span class="sdb-sec__tape"></span>
        <h3 class="sdb-sec__title">关于</h3>
        <div class="sdb-row" role="button" tabindex="0">
          <span class="sdb-row__ico">🏷️</span>
          <span class="sdb-row__txt"><span class="sdb-row__t">版本</span></span>
          <span class="sdb-row__v">{{ appVersion }}</span>
        </div>
        <div class="sdb-chips">
          <button class="sdb-chip" type="button" @click="showAuthorSheet = true"><em>✍️</em>作者信息</button>
          <button class="sdb-chip" type="button" @click="showCredits = true"><em>💛</em>开源鸣谢</button>
          <button class="sdb-chip" type="button" @click="replayOnboarding"><em>🎓</em>重看引导</button>
          <button v-if="canInstall" class="sdb-chip" type="button" @click="promptInstall"><em>📲</em>安装到桌面</button>
        </div>
      </section>
    </div>

    <!-- 隐藏文件输入 -->
    <input
      ref="fileInputRef"
      type="file"
      accept=".json,application/json"
      style="display: none"
      @change="onFileSelected"
    />

    <!-- 默认视图选择器 -->
    <van-action-sheet
      v-model:show="showViewPicker"
      title="选择默认视图"
      :actions="viewActions.map((a) => ({ name: a.name, callback: () => onViewSelect(a) }))"
      close-on-click-action
    />

    <!-- 启动自动弹快速记录：三档选择 -->
    <van-action-sheet
      v-model:show="showQuickPopPicker"
      title="启动自动弹快速记录"
      :actions="
        quickPopActions.map((a) => ({
          name: a.name,
          subname: a.desc,
          callback: () => onQuickPopSelect(a.value),
        }))
      "
      close-on-click-action
    />

    <!-- 水电单价面板 -->
    <PriceSettingPanel ref="pricePanelRef" />

    <!-- 作者信息弹层 -->
    <van-popup v-model:show="showAuthorSheet" round :style="{ width: 'min(300px, 82vw)' }">
      <div class="author-card">
        <div class="author-card__avatar">AK</div>
        <div class="author-card__name">{{ AUTHOR_NAME }}</div>
        <div class="author-card__sig">「{{ AUTHOR_SIGNATURE }}」</div>
        <van-button size="small" plain round @click="showAuthorSheet = false">知道了</van-button>
      </div>
    </van-popup>

    <!-- 开源致谢弹层 -->
    <CreditsPopup v-model:show="showCredits" />
  </div>
</template>

<style scoped>
/* =========================================================================
 * 设置页重排：分区便签卡片流（OKLCH 手作 token，与圆体/胶带/手写标题一致）
 * ========================================================================= */

/* ---- 概览 / 身份卡 ---- */
.sdb-ov {
  position: relative;
  background: var(--sdb-surface);
  border: 1px solid var(--sdb-border);
  border-radius: var(--sdb-radius-lg);
  box-shadow: var(--sdb-shadow);
  padding: 18px 16px 14px;
  margin-bottom: var(--sdb-space-3);
}
.sdb-ov__top {
  display: flex;
  align-items: center;
  gap: 12px;
}
.sdb-ov__badge {
  width: 46px;
  height: 46px;
  flex: none;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-family: var(--sdb-font-hand);
  font-size: 20px;
  font-weight: 700;
  color: var(--sdb-on-primary);
  background: linear-gradient(135deg, var(--sdb-primary), var(--sdb-accent));
  box-shadow: var(--sdb-shadow-sm);
}
.sdb-ov__meta {
  flex: 1;
  min-width: 0;
}
.sdb-ov__label {
  font-size: 11px;
  color: var(--sdb-text-tertiary);
  letter-spacing: 0.04em;
}
.sdb-ov__name {
  font-family: var(--sdb-font-hand);
  font-size: 21px;
  font-weight: 700;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sdb-ov__sub {
  font-size: var(--sdb-text-xs);
  color: var(--sdb-text-secondary);
  margin-top: 2px;
}
.sdb-ov__sync {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: var(--sdb-radius-pill);
  background: var(--sdb-surface-2);
  font-size: 11px;
  color: var(--sdb-text-secondary);
}
.sdb-ov__sync i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--sdb-success);
}
.sdb-ov__sync.is-off i {
  background: var(--sdb-text-tertiary);
}
.sdb-ov__stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed var(--sdb-border);
}
.sdb-stat {
  text-align: center;
}
.sdb-stat__n {
  display: block;
  font-family: var(--sdb-font-hand);
  font-size: 24px;
  font-weight: 700;
  line-height: 1.1;
}
.sdb-stat__n--sm {
  font-size: 14px;
  padding-top: 5px;
}
.sdb-stat__l {
  display: block;
  font-size: 10px;
  color: var(--sdb-text-tertiary);
  margin-top: 2px;
}

/* ---- 分区便签卡 ---- */
.sdb-sec {
  position: relative;
  background: var(--sdb-surface);
  border: 1px solid var(--sdb-border);
  border-radius: var(--sdb-radius-lg);
  box-shadow: var(--sdb-shadow-sm);
  padding: 22px 14px 14px;
  margin-bottom: var(--sdb-space-3);
}
.sdb-sec__tape {
  position: absolute;
  top: -9px;
  left: 20px;
  width: 62px;
  height: 19px;
  border-radius: 2px;
  transform: rotate(-3deg);
  background: color-mix(in oklch, var(--sdb-accent) 62%, transparent);
  box-shadow: 0 1px 3px oklch(45% 0.1 45 / 0.18);
}
.sdb-sec__title {
  font-family: var(--sdb-font-hand);
  font-size: 20px;
  font-weight: 700;
  margin: 0 0 10px;
  color: var(--sdb-text);
  letter-spacing: 0.02em;
  display: flex;
  align-items: center;
  gap: 8px;
}
.sdb-sec__title small {
  font-family: var(--sdb-font-rounded);
  font-size: 11px;
  font-weight: 400;
  color: var(--sdb-text-tertiary);
  letter-spacing: 0;
}

/* ---- 通用行（图标 + 标题 + 副标题 + 值/操作）---- */
.sdb-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 46px;
  padding: 9px 10px;
  border: none;
  background: transparent;
  border-radius: var(--sdb-radius-sm);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  font-size: var(--sdb-text-base);
  color: var(--sdb-text);
  transition: background var(--sdb-dur-fast) var(--sdb-ease-out);
}
.sdb-row + .sdb-row {
  box-shadow: inset 0 1px 0 var(--sdb-border);
  border-radius: 0;
}
.sdb-row:hover {
  background: var(--sdb-surface-2);
}
.sdb-row:active {
  transform: scale(0.995);
}
.sdb-row__ico {
  width: 30px;
  height: 30px;
  flex: none;
  border-radius: 9px;
  display: grid;
  place-items: center;
  background: var(--sdb-surface-2);
  font-size: 14px;
}
.sdb-row__txt {
  flex: 1;
  min-width: 0;
}
.sdb-row__t {
  display: block;
  font-size: var(--sdb-text-base);
}
.sdb-row__d {
  display: block;
  font-size: 11px;
  color: var(--sdb-text-tertiary);
  margin-top: 1px;
}
.sdb-row__v {
  flex: none;
  font-size: var(--sdb-text-sm);
  color: var(--sdb-text-secondary);
}
.sdb-row__chev {
  flex: none;
  color: var(--sdb-text-tertiary);
  font-size: 13px;
}

/* ---- 分段控件（外观）---- */
.sdb-seg {
  display: flex;
  gap: 4px;
  padding: 4px;
  background: var(--sdb-surface-2);
  border-radius: var(--sdb-radius-pill);
}
.sdb-seg__i {
  flex: 1;
  padding: 8px 4px;
  border: none;
  border-radius: var(--sdb-radius-pill);
  cursor: pointer;
  background: transparent;
  color: var(--sdb-text-secondary);
  font-family: inherit;
  font-size: var(--sdb-text-sm);
  transition:
    background var(--sdb-dur-fast) var(--sdb-ease-out),
    color var(--sdb-dur-fast) var(--sdb-ease-out);
}
.sdb-seg__i.is-on {
  background: var(--sdb-surface);
  color: var(--sdb-text);
  font-weight: 600;
  box-shadow: var(--sdb-shadow-sm);
}

/* ---- 开关（行为）---- */
.sdb-sw {
  flex: none;
  width: 46px;
  height: 28px;
  border-radius: var(--sdb-radius-pill);
  border: none;
  cursor: pointer;
  background: var(--sdb-border);
  position: relative;
  transition: background var(--sdb-dur) var(--sdb-ease-out);
}
.sdb-sw::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px oklch(45% 0.1 45 / 0.3);
  transition: transform var(--sdb-dur) var(--sdb-ease-out);
}
.sdb-sw.is-on {
  background: var(--sdb-primary);
}
.sdb-sw.is-on::after {
  transform: translateX(18px);
}

/* ---- 模板磁贴（账单）---- */
.sdb-tpls {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.sdb-tpl {
  border: 1.5px solid var(--sdb-border);
  border-radius: var(--sdb-radius-sm);
  background: var(--sdb-surface);
  padding: 8px 4px 6px;
  cursor: pointer;
  font-family: inherit;
  font-size: 11px;
  color: var(--sdb-text-secondary);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  transition:
    border-color var(--sdb-dur-fast) var(--sdb-ease-out),
    transform var(--sdb-dur-fast) var(--sdb-ease-out);
}
.sdb-tpl:hover {
  transform: translateY(-1px);
}
.sdb-tpl.is-on {
  border-color: var(--sdb-primary);
  color: var(--sdb-text);
  font-weight: 600;
  box-shadow: var(--sdb-shadow-sm);
}
.sdb-tpl__thumb {
  width: 100%;
  height: 40px;
  border-radius: 6px;
  background: var(--sdb-surface-2);
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px 5px;
}
.sdb-tpl__thumb i {
  display: block;
  height: 3px;
  border-radius: 2px;
  background: var(--sdb-text-tertiary);
  opacity: 0.55;
}
.sdb-tpl__thumb i:nth-child(1) {
  width: 70%;
}
.sdb-tpl__thumb i:nth-child(2) {
  width: 100%;
}
.sdb-tpl__thumb i:nth-child(3) {
  width: 45%;
}
.sdb-tpl__thumb--receipt {
  background: repeating-linear-gradient(
    var(--sdb-surface-2) 0 6px,
    color-mix(in oklch, var(--sdb-primary) 12%, var(--sdb-surface-2)) 6px 7px
  );
}
.sdb-tpl__thumb--card {
  border: 1px solid var(--sdb-border);
}
.sdb-tpl__thumb--report {
  background:
    linear-gradient(var(--sdb-surface-2), var(--sdb-surface-2)) padding-box,
    repeating-linear-gradient(0deg, var(--sdb-border) 0 1px, transparent 1px 11px) border-box;
}
.sdb-tpl__thumb--report i {
  opacity: 0.4;
}

/* ---- 折叠区（设备密钥备份）---- */
.sdb-fold__head {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 9px 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  font-size: var(--sdb-text-base);
  color: var(--sdb-text);
}
.sdb-fold__head:hover {
  background: var(--sdb-surface-2);
  border-radius: var(--sdb-radius-sm);
}
.sdb-fold__caret {
  flex: none;
  font-size: 13px;
  color: var(--sdb-text-tertiary);
  transition: transform var(--sdb-dur) var(--sdb-ease-out);
}
.sdb-fold.is-open .sdb-fold__caret {
  transform: rotate(90deg);
}
.sdb-fold__body {
  padding: 4px 10px 4px;
}
.sdb-fold__note {
  font-size: 11px;
  line-height: 1.6;
  color: var(--sdb-text-tertiary);
  margin: 0 0 10px;
}

/* ---- chips（关于）---- */
.sdb-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}
.sdb-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  cursor: pointer;
  border-radius: var(--sdb-radius-pill);
  border: 1px solid var(--sdb-border);
  background: var(--sdb-surface);
  color: var(--sdb-text);
  font-family: inherit;
  font-size: var(--sdb-text-sm);
  transition: border-color var(--sdb-dur-fast) var(--sdb-ease-out);
}
.sdb-chip:hover {
  border-color: var(--sdb-primary);
  color: var(--sdb-primary);
}
.sdb-chip em {
  font-style: normal;
  font-size: 13px;
}

/* ---- 作者信息卡 ---- */
.author-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sdb-space-3);
  padding: var(--sdb-space-5) var(--sdb-space-5) var(--sdb-space-4);
  background: var(--sdb-surface);
  border-radius: var(--sdb-radius-lg);
}
.author-card__avatar {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--sdb-font-rounded);
  font-size: var(--sdb-text-lg);
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--sdb-on-primary);
  background: linear-gradient(135deg, var(--sdb-primary), var(--sdb-accent));
  box-shadow: var(--sdb-shadow);
}
.author-card__name {
  font-family: var(--sdb-font-rounded);
  font-size: var(--sdb-text-lg);
  font-weight: 700;
  color: var(--sdb-text);
}
.author-card__sig {
  font-size: var(--sdb-text-sm);
  line-height: 1.7;
  text-align: center;
  color: var(--sdb-text-secondary);
  max-width: 240px;
}

/* ---- 桌面双栏：房源卡跨两列；分组两列排布 ---- */
@media (min-width: 1024px) {
  .sdb-settings-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--sdb-space-4);
    align-items: start;
  }
  .sdb-settings-grid > .sdb-sec {
    margin-bottom: 0;
  }
  .sdb-sec--span2 {
    grid-column: 1 / -1;
  }
}
</style>

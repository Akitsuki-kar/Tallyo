<script setup lang="ts">
/**
 * 个性化设置页（Phase 7）
 *
 * 功能：
 * 1. 外观：主题模式（浅色 / 深色 / 跟随系统）
 * 2. 行为：启动自动弹快速记录、默认视图选择
 * 3. 账单：默认模板选择（小票 / 极简 / 卡片 / 报表）
 * 4. 数据：水电单价、数据同步、导出数据、导入数据（LWW 合并）
 * 5. 关于：版本信息、PWA 安装
 *
 * 保留 Phase 3 的水电单价面板与同步入口。严格手作美学 token + Vant 深度定制。
 */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import { showSuccessToast, showToast, showConfirmDialog } from 'vant';
import { useSettingsStore } from '@/stores/settings';
import { usePremisesStore } from '@/stores/premises';
import { usePricesStore } from '@/stores/prices';
import { usePWAInstall } from '@/composables/usePWAInstall';
import { exportData, importData } from '@/utils/dataExport';
import { logger } from '@/utils/logger';
import type { DefaultView, BillTemplateId, ThemeMode } from '@/types';
import PriceSettingPanel from '@/components/settings/PriceSettingPanel.vue';
import PremiseManager from '@/components/settings/PremiseManager.vue';
import DeviceKeyBackup from '@/components/settings/DeviceKeyBackup.vue';
import { eventBus, EVENTS } from '@/utils/eventBus';

const router = useRouter();
const settingsStore = useSettingsStore();
const premises = usePremisesStore();
const prices = usePricesStore();
const { canInstall, prompt: promptInstall } = usePWAInstall();

const { theme, autoPopQuickRecord, defaultView, templateId } = storeToRefs(settingsStore);

const pricePanelRef = ref<InstanceType<typeof PriceSettingPanel> | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const exporting = ref(false);
const importing = ref(false);

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

// ---- 模板选择器 ----
const showTemplatePicker = ref(false);
const templateActions = [
  { name: '小票风', value: 'receipt' as const },
  { name: '极简风', value: 'minimal' as const },
  { name: '卡片风', value: 'card' as const },
  { name: '报表风', value: 'report' as const },
];
const templateLabel = computed(() => {
  const a = templateActions.find((x) => x.value === templateId.value);
  return a ? a.name : '小票风';
});

function onTemplateSelect(action: { value: BillTemplateId }): void {
  settingsStore.update({ templateId: action.value });
  showTemplatePicker.value = false;
}

// ---- 主题切换 ----
const showThemePicker = ref(false);
const themeActions = [
  { name: '浅色', value: 'light' as const },
  { name: '深色', value: 'dark' as const },
  { name: '跟随系统', value: 'auto' as const },
];
const themeLabel = computed(() => {
  const a = themeActions.find((x) => x.value === theme.value);
  return a ? a.name : '浅色';
});
function onThemeSelect(action: { value: ThemeMode }): void {
  settingsStore.update({ theme: action.value });
  showThemePicker.value = false;
}

// ---- 自动弹窗 ----
function onAutoPopToggle(val: boolean): void {
  settingsStore.update({ autoPopQuickRecord: val });
}

// ---- 导出数据 ----
async function onExport(): Promise<void> {
  exporting.value = true;
  try {
    await exportData();
    showSuccessToast('数据已导出');
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

  // 确认导入（LWW 合并：旧数据不会覆盖新数据，但建议先备份）
  try {
    await showConfirmDialog({
      title: '导入数据',
      message: '导入数据将与本地数据按 LWW 合并（新数据优先）。建议先导出备份。',
    });
  } catch {
    // 用户取消
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
    input.value = ''; // 清空，允许重复选择同一文件
  }
}

// ---- 水电单价面板 ----
function openPricePanel(): void {
  pricePanelRef.value?.open();
}

// ---- 重看新手引导：回首页并广播重启事件（App.vue 监听后重开引导流） ----
function replayOnboarding(): void {
  router.push('/');
  eventBus.emit(EVENTS.ONBOARDING_REPLAY);
}

// ---- 生命周期 ----
onMounted(async () => {
  try {
    if (premises.list.length === 0) {
      await premises.load();
      await premises.seedIfEmpty();
    }
    if (premises.currentPremiseId) await prices.ensureDefault(premises.currentPremiseId);
  } catch (err) {
    logger.error('settings:view', '初始化设置页失败', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
});
</script>

<template>
  <div>
    <h2 class="sdb-page-title">个性化设置</h2>

    <!-- 桌面 ≥1024px：分组双栏排布，减少长滚动 -->
    <div class="sdb-settings-grid">
      <!-- 房源管理（内嵌分区：列表 + 新增/编辑/删除） -->
      <PremiseManager />

      <!-- 外观 -->
      <van-cell-group inset title="外观" class="sdb-settings-group">
        <van-cell
          title="主题模式"
          :value="themeLabel"
          is-link
          @click="showThemePicker = true"
        />
      </van-cell-group>

      <!-- 行为 -->
      <van-cell-group inset title="行为" class="sdb-settings-group">
        <van-cell title="启动自动弹快速记录" center>
          <template #value>
            <van-switch
              :model-value="autoPopQuickRecord"
              @update:model-value="onAutoPopToggle"
            />
          </template>
        </van-cell>
        <van-cell
          title="默认视图"
          :value="viewLabel"
          is-link
          @click="showViewPicker = true"
        />
      </van-cell-group>

      <!-- 账单 -->
      <van-cell-group inset title="账单" class="sdb-settings-group">
        <van-cell
          title="默认模板"
          :value="templateLabel"
          is-link
          @click="showTemplatePicker = true"
        />
      </van-cell-group>

      <!-- 数据 -->
      <van-cell-group inset title="数据" class="sdb-settings-group">
        <van-cell title="水电单价" is-link @click="openPricePanel" />
        <van-cell title="数据同步" is-link @click="router.push('/sync')" />
        <van-cell
          title="导出数据"
          :value="exporting ? '导出中…' : ''"
          is-link
          @click="onExport"
        />
        <van-cell
          title="导入数据"
          :value="importing ? '导入中…' : ''"
          is-link
          @click="triggerImport"
        />
      </van-cell-group>

      <!-- 关于 -->
      <van-cell-group inset title="关于" class="sdb-settings-group">
        <van-cell title="版本" value="0.1.0" />
        <van-cell title="新手引导" value="重看一遍" is-link @click="replayOnboarding" />
        <van-cell v-if="canInstall" title="安装到桌面" is-link @click="promptInstall" />
      </van-cell-group>

      <!-- 设备密钥备份（体验⑭，可选/主动） -->
      <DeviceKeyBackup />
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

    <!-- 主题模式选择器 -->
    <van-action-sheet
      v-model:show="showThemePicker"
      title="选择主题模式"
      :actions="themeActions.map((a) => ({ name: a.name, callback: () => onThemeSelect(a) }))"
      close-on-click-action
    />

    <!-- 模板选择器 -->
    <van-action-sheet
      v-model:show="showTemplatePicker"
      title="选择账单模板"
      :actions="templateActions.map((a) => ({ name: a.name, callback: () => onTemplateSelect(a) }))"
      close-on-click-action
    />

    <!-- 水电单价面板 -->
    <PriceSettingPanel ref="pricePanelRef" />
  </div>
</template>

<style scoped>
.sdb-settings-group {
  margin: 0 0 var(--sdb-space-4);
}
/* 桌面双栏时由网格 gap 控制间距，去掉分组自身 margin 防止双倍间距 */
@media (min-width: 1024px) {
  .sdb-settings-group {
    margin-bottom: 0;
  }
}
</style>

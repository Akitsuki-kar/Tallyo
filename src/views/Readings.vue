<script setup lang="ts">
// 读数记录页（暖色、卡片化）
// 顶部：房源切换（多房源时）+ 单价设置 + 月份导航
// 中部：筛选条 + 读数列表
// 右下 FAB：快速记录（极简弹窗）；「记一笔」按钮：完整表单弹窗
import { computed, onMounted, ref, watch } from 'vue';
import type { Reading } from '@/types';
import { storeToRefs } from 'pinia';
import { usePremisesStore } from '@/stores/premises';
import { useReadingsStore } from '@/stores/readings';
import { usePricesStore } from '@/stores/prices';
import { dayjs, monthKey, formatMonthLabel } from '@/utils/dayjs';
import { logger } from '@/utils/logger';
import ReadingList from '@/components/readings/ReadingList.vue';
import ReadingForm from '@/components/readings/ReadingForm.vue';
import QuickRecordPopup from '@/components/readings/QuickRecordPopup.vue';
import PremiseSelector from '@/components/common/PremiseSelector.vue';
import PriceSettingPanel from '@/components/settings/PriceSettingPanel.vue';

const premises = usePremisesStore();
const readings = useReadingsStore();
const prices = usePricesStore();
const { currentPremiseId } = storeToRefs(premises);

const quickRef = ref<InstanceType<typeof QuickRecordPopup> | null>(null);
const pricePanelRef = ref<InstanceType<typeof PriceSettingPanel> | null>(null);

const formPopupShow = ref(false);
const formKey = ref(0);
const editingReading = ref<Reading | null>(null);

const viewMonthLabel = computed(() => formatMonthLabel(readings.filter.month || monthKey()));

async function initView(): Promise<void> {
  try {
    if (premises.list.length === 0) {
      await premises.load();
      await premises.seedIfEmpty();
    }
    await readings.load();
    if (premises.currentPremiseId) await prices.ensureDefault(premises.currentPremiseId);
  } catch (err) {
    logger.error('readings:view', '初始化读数页失败', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
onMounted(initView);

// 切换房源后确保该房源有默认单价（D2）
watch(currentPremiseId, async (id) => {
  if (id) {
    try {
      await prices.ensureDefault(id);
    } catch (err) {
      logger.error('readings:view', '切换房源写入默认单价失败', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
});

function openQuickRecord(): void {
  quickRef.value?.open();
}
function openAddForm(): void {
  editingReading.value = null;
  formKey.value += 1;
  formPopupShow.value = true;
}
function openEditForm(r: Reading): void {
  editingReading.value = r;
  formKey.value += 1;
  formPopupShow.value = true;
}
function onFormSaved(): void {
  formPopupShow.value = false;
  editingReading.value = null;
}

// 月份导航
function shiftMonth(delta: number): void {
  const base = readings.filter.month || monthKey();
  const next = dayjs(`${base}-01`).add(delta, 'month').format('YYYY-MM');
  readings.setFilter({ month: next });
}
function goThisMonth(): void {
  readings.setFilter({ month: monthKey() });
}
function clearMonthFilter(): void {
  readings.setFilter({ month: undefined });
}

function openPricePanel(): void {
  pricePanelRef.value?.open();
}
</script>

<template>
  <div class="readings-view">
    <!-- 顶部：房源 + 单价设置 -->
    <div class="rv-top">
      <PremiseSelector />
      <van-button size="small" plain type="primary" @click="openPricePanel">单价设置</van-button>
    </div>

    <!-- 月份导航 -->
    <div class="rv-month-nav">
      <van-icon name="arrow-left" class="rv-month-nav__btn" aria-label="上一月" @click="shiftMonth(-1)" />
      <div class="rv-month-nav__label" @click="goThisMonth">{{ viewMonthLabel }}</div>
      <van-icon name="arrow" class="rv-month-nav__btn" aria-label="下一月" @click="shiftMonth(1)" />
      <van-button v-if="readings.filter.month" size="mini" plain type="primary" @click="clearMonthFilter">
        全部
      </van-button>
    </div>

    <!-- 列表 + 筛选 -->
    <ReadingList @edit="openEditForm" />

    <!-- 记一笔 -->
    <div class="rv-add-bar">
      <van-button block round type="primary" @click="openAddForm">记一笔</van-button>
    </div>

    <!-- FAB 快速记录 -->
    <van-button
      class="rv-fab"
      round
      icon="plus"
      type="primary"
      aria-label="快速记录"
      @click="openQuickRecord"
    />

    <!-- 完整表单弹窗（新增 / 编辑） -->
    <van-popup v-model:show="formPopupShow" position="bottom" round :style="{ maxHeight: '92%' }">
      <div class="form-popup">
        <div class="form-popup__header">
          <span>{{ editingReading ? '编辑读数' : '新增读数' }}</span>
          <van-icon name="cross" class="form-popup__close" aria-label="关闭" @click="formPopupShow = false" />
        </div>
        <ReadingForm v-if="formPopupShow" :key="formKey" :edit-reading="editingReading" @saved="onFormSaved" />
      </div>
    </van-popup>

    <QuickRecordPopup ref="quickRef" />
    <PriceSettingPanel ref="pricePanelRef" />
  </div>
</template>

<style scoped>
.readings-view {
  padding-bottom: 8px;
}
.rv-top {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.rv-month-nav {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--sdb-surface);
  border-radius: var(--sdb-radius);
  box-shadow: var(--sdb-shadow);
  padding: 10px 14px;
  margin-bottom: 12px;
}
.rv-month-nav__btn {
  font-size: 20px;
  color: var(--sdb-primary);
  cursor: pointer;
}
.rv-month-nav__label {
  flex: 1;
  text-align: center;
  font-weight: 600;
  color: var(--sdb-text);
  cursor: pointer;
}
.rv-add-bar {
  margin: 16px 0;
}
.rv-fab {
  position: fixed;
  right: 16px;
  bottom: calc(var(--sdb-header-h) + 76px);
  width: 52px;
  height: 52px;
  box-shadow: var(--sdb-shadow);
  z-index: 30;
}
.form-popup {
  display: flex;
  flex-direction: column;
  max-height: 92vh;
  background: var(--sdb-bg);
}
.form-popup__header {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  background: var(--sdb-surface);
  border-bottom: 1px solid var(--sdb-surface-2);
  font-size: 16px;
  font-weight: 600;
  color: var(--sdb-text);
}
.form-popup__close {
  font-size: 20px;
  color: var(--sdb-text-secondary);
}
@media (min-width: 768px) {
  .form-popup {
    max-width: 560px;
    margin: 0 auto;
  }
  .rv-fab {
    right: calc(50% - 460px);
  }
}
</style>

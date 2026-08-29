<script setup lang="ts">
/**
 * 账单页（Phase 6）
 *
 * 功能：
 * 1. 房源切换（PremiseSelector）
 * 2. 月度账单列表（BillCard 概览卡，最近在前）
 * 3. 点击账单 → 弹出详情（van-popup），内含模板选择器 + 渲染选定模板
 * 4. 导出 PDF（html2canvas + jsPDF）
 *
 * 数据 reactive 派生自 bills / premises / settings store。严格手作美学 token。
 */
import { computed, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { showSuccessToast, showToast } from 'vant';
import { usePremisesStore } from '@/stores/premises';
import { useBillsStore } from '@/stores/bills';
import { useSettingsStore } from '@/stores/settings';
import { formatMonthLabel } from '@/utils/dayjs';
import { exportElementToPdf } from '@/utils/pdf';
import type { Bill, BillTemplateId } from '@/types';
import PremiseSelector from '@/components/common/PremiseSelector.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import BillCard from '@/components/bills/BillCard.vue';
import BillTemplateSelector from '@/components/bills/BillTemplateSelector.vue';
import ReceiptTemplate from '@/components/bills/templates/ReceiptTemplate.vue';
import MinimalTemplate from '@/components/bills/templates/MinimalTemplate.vue';
import CardTemplate from '@/components/bills/templates/CardTemplate.vue';
import ReportTemplate from '@/components/bills/templates/ReportTemplate.vue';

const premisesStore = usePremisesStore();
const billsStore = useBillsStore();
const settingsStore = useSettingsStore();

const { currentPremiseId, currentPremise } = storeToRefs(premisesStore);

// ---- 账单列表（当前房源，最近在前） ----
const premiseBills = computed(() => {
  if (!currentPremiseId.value) return [];
  return billsStore.recentMonths(24).filter((b) => b.premiseId === currentPremiseId.value);
});

// ---- 弹层状态 ----
const showDetail = ref(false);
const selectedBill = ref<Bill | null>(null);
const selectedTemplate = ref<BillTemplateId>('receipt');
const exporting = ref(false);

/** 模板渲染区 ref（用于 PDF 捕获） */
const templateRef = ref<HTMLElement | null>(null);

/** 当前房源名 */
const premiseName = computed(() => currentPremise.value?.name ?? '');

/** 模板组件映射 */
const templateComponents = {
  receipt: ReceiptTemplate,
  minimal: MinimalTemplate,
  card: CardTemplate,
  report: ReportTemplate,
};

// ---- 打开/关闭账单详情 ----
function openBill(bill: Bill): void {
  selectedBill.value = bill;
  showDetail.value = true;
}

function closeBill(): void {
  showDetail.value = false;
  selectedBill.value = null;
}

// ---- 模板切换 ----
async function onTemplateChange(id: BillTemplateId): Promise<void> {
  selectedTemplate.value = id;
  // 持久化到 settings store
  try {
    await settingsStore.update({ templateId: id });
  } catch {
    // 静默失败，不影响 UI
  }
}

// ---- 导出 PDF ----
async function onExportPdf(): Promise<void> {
  if (!templateRef.value || !selectedBill.value) return;
  exporting.value = true;
  try {
    const filename = `水电动账-${selectedBill.value.yearMonth}`;
    await exportElementToPdf(templateRef.value, filename);
    showSuccessToast('已导出 PDF');
  } catch (e) {
    // 展示具体原因（原生壳保存失败 / 捕获失败等），便于定位
    showToast('导出失败：' + (e instanceof Error ? e.message : String(e)));
  } finally {
    exporting.value = false;
  }
}

// ---- 生命周期 ----
onMounted(async () => {
  await billsStore.load();
  // 从设置读取默认模板
  selectedTemplate.value = settingsStore.templateId;
});

// 房源切换时关闭弹层
watch(currentPremiseId, () => {
  if (showDetail.value) closeBill();
});
</script>

<template>
  <div>
    <h2 class="sdb-page-title">账单</h2>

    <!-- 房源选择器 -->
    <section class="sdb-card bills__premise-bar">
      <span class="bills__premise-label">房源</span>
      <PremiseSelector />
    </section>

    <!-- 账单列表（桌面：auto-fill 卡片墙铺开） -->
    <section v-if="premiseBills.length > 0" class="sdb-grid-cards bills__list">
      <BillCard
        v-for="b in premiseBills"
        :key="b.id"
        :bill="b"
        :premise-name="premiseName"
        @click="openBill(b)"
      />
    </section>

    <!-- 空状态 -->
    <EmptyState
      v-else
      text="还没有账单"
      hint="记录水电读数后将自动生成月度账单"
    />

    <!-- 账单详情弹层 -->
    <van-popup
      v-model:show="showDetail"
      position="bottom"
      round
      closeable
      :style="{ maxHeight: '90vh' }"
      class="bills__popup"
    >
      <div class="bills__detail">
        <!-- 弹层头部 -->
        <div class="bills__detail-head">
          <span class="bills__detail-title">
            {{ selectedBill ? formatMonthLabel(selectedBill.yearMonth) : '' }}
          </span>
          <span class="bills__detail-premise">{{ premiseName }}</span>
        </div>

        <!-- 模板选择器 -->
        <div class="bills__template-bar">
          <BillTemplateSelector
            v-model="selectedTemplate"
            @update:model-value="onTemplateChange"
          />
        </div>

        <!-- 模板渲染区（PDF 捕获目标） -->
        <div ref="templateRef" class="bills__template-render">
          <component
            :is="templateComponents[selectedTemplate]"
            v-if="selectedBill"
            :bill="selectedBill"
            :premise-name="premiseName"
          />
        </div>

        <!-- 导出按钮 -->
        <button
          class="sdb-btn sdb-btn--primary sdb-btn--block bills__export"
          :disabled="exporting"
          @click="onExportPdf"
        >
          <van-icon :name="exporting ? 'loading' : 'down'" />
          {{ exporting ? '导出中…' : '导出 PDF' }}
        </button>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
/* 房源选择栏 */
.bills__premise-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: var(--sdb-space-3);
}
.bills__premise-label {
  font-size: var(--sdb-text-sm);
  color: var(--sdb-text-secondary);
}

/* 账单列表（列间距由 .sdb-grid-cards 控制） */
.bills__list {
  margin-bottom: var(--sdb-space-3);
}

/* 弹层 */
.bills__popup {
  background: var(--sdb-bg) !important;
  background-image: var(--sdb-paper) !important;
}
.bills__detail {
  padding: var(--sdb-space-4) var(--sdb-space-3) calc(var(--sdb-space-4) + 56px);
}
.bills__detail-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: var(--sdb-space-3);
}
.bills__detail-title {
  font-size: var(--sdb-text-lg);
  font-weight: 700;
  color: var(--sdb-text);
}
.bills__detail-premise {
  font-size: var(--sdb-text-sm);
  color: var(--sdb-text-secondary);
}

/* 模板选择器 */
.bills__template-bar {
  margin-bottom: var(--sdb-space-4);
}

/* 模板渲染区 */
.bills__template-render {
  padding: var(--sdb-space-4) 0;
  min-height: 200px;
}

/* 导出按钮 */
.bills__export {
  margin-top: var(--sdb-space-3);
}
.bills__export:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>

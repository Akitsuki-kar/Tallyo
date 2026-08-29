<script setup lang="ts">
/**
 * 预算管理页（Phase 5）
 *
 * 功能：
 * 1. 房源切换（复用 PremiseSelector）
 * 2. 预算口径切换（按金额 amount / 按用量 usage）
 * 3. 当月预算进度圆环（电费 + 水费）
 * 4. 预算预警横幅（80% 接近 / 100% 超出）
 * 5. 预算设置卡（电/水限额输入 + 保存）
 * 6. 近月预算执行列表（最近 6 个月 budgetStatus 徽章）
 *
 * 数据全部 reactive 派生自 budgets / bills store，保存后即时 recompute 当月账单
 * 使 budgetStatus 刷新。严格手作美学 token。
 */
import { computed, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { showSuccessToast, showToast } from 'vant';
import { usePremisesStore } from '@/stores/premises';
import { useBillsStore } from '@/stores/bills';
import { useBudgetsStore } from '@/stores/budgets';
import { useReadingsStore } from '@/stores/readings';
import { monthKey, monthKeyFromDate, formatMonthLabel } from '@/utils/dayjs';
import { formatCurrency, formatNumber } from '@/utils/format';
import type { BudgetMode } from '@/types';
import PremiseSelector from '@/components/common/PremiseSelector.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import BudgetProgress from '@/components/budget/BudgetProgress.vue';
import BudgetWarning from '@/components/budget/BudgetWarning.vue';

const premisesStore = usePremisesStore();
const billsStore = useBillsStore();
const budgetsStore = useBudgetsStore();
const readingsStore = useReadingsStore();

const { currentPremiseId } = storeToRefs(premisesStore);

const currentMonth = ref(monthKey());

// ---- 当月账单（reactive） ----
const currentBill = computed(() => {
  if (!currentPremiseId.value) return undefined;
  return billsStore.billForMonth(currentMonth.value, currentPremiseId.value);
});

// ---- 当前房源预算 ----
const currentBudget = computed(() => {
  if (!currentPremiseId.value) return undefined;
  return budgetsStore.getBudget(currentPremiseId.value);
});

// ---- 预算口径选择（本地表单状态） ----
const formMode = ref<BudgetMode>('amount');
const formElectricityLimit = ref<string>('');
const formWaterLimit = ref<string>('');
const saving = ref(false);

/** 同步表单状态到当前预算值（房源切换/预算加载后调用） */
function syncFormFromBudget(): void {
  const b = currentBudget.value;
  if (b) {
    formMode.value = b.mode;
    formElectricityLimit.value = b.electricityLimit > 0 ? String(b.electricityLimit) : '';
    formWaterLimit.value = b.waterLimit > 0 ? String(b.waterLimit) : '';
  } else {
    formMode.value = 'amount';
    formElectricityLimit.value = '';
    formWaterLimit.value = '';
  }
}

// ---- 单位与格式化辅助 ----
const unitLabel = computed(() => (formMode.value === 'amount' ? '元' : ''));
const electricityUnit = computed(() => (formMode.value === 'amount' ? '元' : '度'));
const waterUnit = computed(() => (formMode.value === 'amount' ? '元' : '吨'));

// ---- 进度圆环数据 ----
const electricityProgress = computed(() => {
  const bill = currentBill.value;
  const budget = currentBudget.value;
  const isAmount = formMode.value === 'amount';
  const actual = bill ? (isAmount ? bill.electricityCost : bill.electricityUsage) : 0;
  // 限额在两种口径下共用同一字段（amount=元 / usage=度或吨），故无需按 formMode 分支
  const limit = budget ? budget.electricityLimit : 0;
  return { actual, limit };
});

const waterProgress = computed(() => {
  const bill = currentBill.value;
  const budget = currentBudget.value;
  const isAmount = formMode.value === 'amount';
  const actual = bill ? (isAmount ? bill.waterCost : bill.waterUsage) : 0;
  const limit = budget ? budget.waterLimit : 0;
  return { actual, limit };
});

// ---- 预警列表 ----
const warnings = computed(() => {
  if (!currentBill.value) return [];
  return budgetsStore.warnings(currentBill.value);
});

// ---- 近月预算执行列表（最近 6 月，当前房源） ----
const recentBills = computed(() => {
  if (!currentPremiseId.value) return [];
  return billsStore.recentMonths(6).filter((b) => b.premiseId === currentPremiseId.value);
});

/** 预算状态中文标签 + 图标 */
function statusBadge(status: string): { text: string; icon: string; cls: string } {
  switch (status) {
    case 'exceeded': return { text: '超支', icon: 'warning-o', cls: 'is-exceeded' };
    case 'warning': return { text: '接近', icon: 'bell', cls: 'is-warning' };
    default: return { text: '正常', icon: 'success', cls: 'is-ok' };
  }
}

// ---- 保存预算 ----
// 允许清空：两项上限同时为 0（或留空）即回到「不约束」状态——
// budgets.statusForBill / ratioFor 均以 limit > 0 为生效前提，
// 因此 0 是天然、无需额外开关的「关闭预算」取值。
async function onSave(): Promise<void> {
  if (!currentPremiseId.value) return;
  // 负数没有业务含义，统一钳到 0（等同于不设限）
  const eLimit = Math.max(0, parseFloat(formElectricityLimit.value) || 0);
  const wLimit = Math.max(0, parseFloat(formWaterLimit.value) || 0);
  // 保存前是否已有生效预算，用于给出「已清空」而非「已保存」的措辞
  const hadBudget = !!currentBudget.value && (currentBudget.value.electricityLimit > 0 || currentBudget.value.waterLimit > 0);
  const cleared = eLimit <= 0 && wLimit <= 0;
  saving.value = true;
  try {
    await budgetsStore.setBudget(currentPremiseId.value, {
      mode: formMode.value,
      electricityLimit: eLimit,
      waterLimit: wLimit,
    });
    // 预算变更后重算该房源**所有有读数的月份**，而非只算当月：
    // budgetStatus 是写在账单上的派生字段，只刷当月会让下方「近月预算执行」列表
    // 里的历史徽章继续停留在旧状态（要等到下次同步/全量重算才更新）。
    const pid = currentPremiseId.value;
    const months = new Set<string>();
    for (const r of readingsStore.items) {
      if (!r.isDeleted && r.premiseId === pid) months.add(monthKeyFromDate(r.date));
    }
    months.add(currentMonth.value);
    for (const m of months) {
      await billsStore.recompute(pid, m);
    }
    showSuccessToast(cleared && hadBudget ? '预算已清空' : '预算已保存');
  } catch {
    showToast('保存失败，请重试');
  } finally {
    saving.value = false;
  }
}

// ---- 切换口径时清空限额（避免数值歧义） ----
function onModeChange(mode: BudgetMode): void {
  if (formMode.value === mode) return;
  formMode.value = mode;
  formElectricityLimit.value = '';
  formWaterLimit.value = '';
}

// ---- 生命周期 ----
onMounted(async () => {
  await budgetsStore.load();
  await billsStore.load();
  syncFormFromBudget();
});

// 房源切换时同步表单
watch(currentPremiseId, () => {
  syncFormFromBudget();
});
</script>

<template>
  <div>
    <h2 class="sdb-page-title">预算管理</h2>

    <!-- 房源选择器 -->
    <section class="sdb-card budget__premise-bar">
      <span class="budget__premise-label">房源</span>
      <PremiseSelector />
    </section>

    <!-- 桌面双栏：左=当月进度+预警，右=预算设置（移动端上下堆叠） -->
    <div class="budget__duo">
      <div class="budget__duo-col">
        <!-- 当月预算进度 -->
        <section v-if="currentBill || currentBudget" class="sdb-card budget__progress-section">
          <div class="budget__section-head">
            <span class="budget__section-title">{{ formatMonthLabel(currentMonth) }} 预算执行</span>
            <span v-if="!currentBill" class="budget__hint">暂无账单数据</span>
          </div>
          <div class="sdb-grid-2 budget__rings">
            <BudgetProgress
              :actual="electricityProgress.actual"
              :limit="electricityProgress.limit"
              label="电费"
              :unit="electricityUnit"
              :is-amount="formMode === 'amount'"
            />
            <BudgetProgress
              :actual="waterProgress.actual"
              :limit="waterProgress.limit"
              label="水费"
              :unit="waterUnit"
              :is-amount="formMode === 'amount'"
            />
          </div>
        </section>

        <!-- 预警 -->
        <BudgetWarning v-if="warnings.length > 0" :items="warnings" />
      </div>

      <!-- 预算设置 -->
      <section class="sdb-card budget__settings">
      <div class="budget__section-head">
        <span class="budget__section-title">预算设置</span>
      </div>

      <!-- 口径切换（segmented control） -->
      <div class="budget__mode-toggle">
        <button
          class="budget__mode-btn"
          :class="{ 'is-active': formMode === 'amount' }"
          @click="onModeChange('amount')"
        >
          按金额（元）
        </button>
        <button
          class="budget__mode-btn"
          :class="{ 'is-active': formMode === 'usage' }"
          @click="onModeChange('usage')"
        >
          按用量{{ formMode === 'usage' ? '（度/吨）' : '' }}
        </button>
      </div>

      <!-- 限额输入 -->
      <div class="budget__inputs">
        <div class="budget__input-row">
          <label class="budget__input-label">电{{ formMode === 'amount' ? '费' : '量' }}上限</label>
          <div class="budget__input-field">
            <input
              v-model="formElectricityLimit"
              type="number"
              inputmode="decimal"
              min="0"
              step="0.01"
              placeholder="0"
              class="budget__input"
            />
            <span class="budget__input-unit">{{ unitLabel || electricityUnit }}</span>
          </div>
        </div>
        <div class="budget__input-row">
          <label class="budget__input-label">水{{ formMode === 'amount' ? '费' : '量' }}上限</label>
          <div class="budget__input-field">
            <input
              v-model="formWaterLimit"
              type="number"
              inputmode="decimal"
              min="0"
              step="0.01"
              placeholder="0"
              class="budget__input"
            />
            <span class="budget__input-unit">{{ unitLabel || waterUnit }}</span>
          </div>
        </div>
      </div>

      <p class="budget__note">两项都填 0 或留空即表示不设上限，保存后关闭该房源的预算预警。</p>
      <button class="sdb-btn sdb-btn--primary sdb-btn--block budget__save" :disabled="saving" @click="onSave">
        {{ saving ? '保存中…' : '保存预算' }}
      </button>
    </section>
    </div>

    <!-- 近月预算执行 -->
    <section v-if="recentBills.length > 0" class="sdb-card budget__history">
      <div class="budget__section-head">
        <span class="budget__section-title">近月预算执行</span>
      </div>
      <ul class="budget__history-list">
        <li
          v-for="b in recentBills"
          :key="b.id"
          class="budget__history-row"
        >
          <span class="budget__history-month">{{ formatMonthLabel(b.yearMonth) }}</span>
          <span class="budget__history-amount">
            合计 {{ formatCurrency(b.totalCost) }}
          </span>
          <span class="budget__history-badge" :class="statusBadge(b.budgetStatus).cls">
            <van-icon :name="statusBadge(b.budgetStatus).icon" />
            {{ statusBadge(b.budgetStatus).text }}
          </span>
        </li>
      </ul>
    </section>

    <!-- 空状态 -->
    <EmptyState
      v-if="!currentBill && !currentBudget && recentBills.length === 0"
      text="还没有预算数据"
      hint="设置预算上限后，每月账单将自动对照预警"
    />
  </div>
</template>

<style scoped>
/* ---- 桌面双栏（移动端单列堆叠，间距沿用各 section margin） ---- */
.budget__duo {
  display: grid;
  grid-template-columns: 1fr;
}
.budget__duo-col {
  display: flex;
  flex-direction: column;
}
@media (min-width: 1024px) {
  .budget__duo {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--sdb-space-4);
    align-items: start;
    margin-bottom: var(--sdb-space-3);
  }
  /* 双栏时由网格 gap 控制间距，去掉 section 自身 margin 防止双倍间距 */
  .budget__progress-section,
  .budget__settings {
    margin-bottom: 0;
  }
}

/* ---- 房源选择栏 ---- */
.budget__premise-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: var(--sdb-space-3);
}
.budget__premise-label {
  font-size: var(--sdb-text-sm);
  color: var(--sdb-text-secondary);
}

/* ---- 通用段落头 ---- */
.budget__section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: var(--sdb-space-3);
}
.budget__section-title {
  font-size: var(--sdb-text-base);
  font-weight: 700;
  color: var(--sdb-text);
}
.budget__hint {
  font-size: var(--sdb-text-xs);
  color: var(--sdb-text-tertiary);
}

/* ---- 进度圆环 ---- */
.budget__progress-section {
  margin-bottom: var(--sdb-space-3);
}
.budget__rings {
  justify-items: center;
}

/* ---- 预算设置 ---- */
.budget__settings {
  margin-bottom: var(--sdb-space-3);
}

/* 口径切换（手作 pill segmented） */
.budget__mode-toggle {
  display: flex;
  gap: 8px;
  background: var(--sdb-surface-2);
  border-radius: var(--sdb-radius-pill);
  padding: 4px;
  margin-bottom: var(--sdb-space-4);
}
.budget__mode-btn {
  flex: 1;
  border: none;
  background: transparent;
  border-radius: var(--sdb-radius-pill);
  padding: 8px 12px;
  font-family: var(--sdb-font-rounded);
  font-size: var(--sdb-text-sm);
  font-weight: 600;
  color: var(--sdb-text-secondary);
  cursor: pointer;
  transition:
    background var(--sdb-dur) var(--sdb-ease-out),
    color var(--sdb-dur) var(--sdb-ease-out),
    box-shadow var(--sdb-dur) var(--sdb-ease-out);
}
.budget__mode-btn.is-active {
  background: var(--sdb-primary);
  color: var(--sdb-on-primary);
  box-shadow: var(--sdb-shadow-sm);
}

/* 限额输入 */
.budget__inputs {
  display: flex;
  flex-direction: column;
  gap: var(--sdb-space-3);
  margin-bottom: var(--sdb-space-4);
}
.budget__input-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.budget__input-label {
  font-size: var(--sdb-text-sm);
  font-weight: 600;
  color: var(--sdb-text);
  white-space: nowrap;
}
.budget__input-field {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--sdb-surface-2);
  border: 1px solid var(--sdb-border);
  border-radius: var(--sdb-radius-sm);
  padding: 0 12px;
  transition:
    border-color var(--sdb-dur) var(--sdb-ease-out),
    box-shadow var(--sdb-dur) var(--sdb-ease-out);
}
.budget__input-field:focus-within {
  border-color: var(--sdb-primary);
  box-shadow: 0 0 0 3px oklch(from var(--sdb-primary) l c h / 0.15);
}
.budget__input {
  width: 100px;
  border: none;
  background: transparent;
  font-family: var(--sdb-font-rounded);
  font-size: var(--sdb-text-base);
  font-variant-numeric: tabular-nums;
  color: var(--sdb-text);
  padding: 10px 0;
  outline: none;
}
.budget__input::placeholder {
  color: var(--sdb-text-tertiary);
}
.budget__input-unit {
  font-size: var(--sdb-text-sm);
  color: var(--sdb-text-secondary);
  white-space: nowrap;
}

.budget__note {
  margin: var(--sdb-space-2) 0 0;
  font-size: var(--sdb-text-xs);
  line-height: 1.6;
  color: var(--sdb-text-tertiary);
}
.budget__save {
  margin-top: var(--sdb-space-2);
}
.budget__save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ---- 近月预算执行 ---- */
.budget__history {
  margin-bottom: var(--sdb-space-3);
}
.budget__history-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sdb-space-2);
}
.budget__history-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--sdb-surface-2);
  border-radius: var(--sdb-radius-sm);
}
.budget__history-month {
  font-size: var(--sdb-text-sm);
  font-weight: 600;
  color: var(--sdb-text);
  flex: 1;
}
.budget__history-amount {
  font-size: var(--sdb-text-sm);
  color: var(--sdb-text-secondary);
  font-variant-numeric: tabular-nums;
}
.budget__history-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: var(--sdb-text-xs);
  font-weight: 700;
  padding: 2px 8px;
  border-radius: var(--sdb-radius-pill);
}
.budget__history-badge .van-icon {
  font-size: 13px;
}
.budget__history-badge.is-ok {
  color: var(--sdb-success);
  background: oklch(from var(--sdb-success) l c h / 0.12);
}
.budget__history-badge.is-warning {
  color: var(--sdb-warning);
  background: oklch(from var(--sdb-warning) l c h / 0.12);
}
.budget__history-badge.is-exceeded {
  color: var(--sdb-danger);
  background: oklch(from var(--sdb-danger) l c h / 0.12);
}
</style>

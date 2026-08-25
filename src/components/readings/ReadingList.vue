<script setup lang="ts">
// 读数列表 + 筛选条（类型 / 排序 / 月份）
// 使用 readings.store 的 sortedReadings（已过滤软删 + 类型/月份 + 排序），
// 再按当前房源过滤后渲染卡片；空态用 EmptyState；删除走 SdbDialog 确认。
import { computed, ref } from 'vue';
import type { Reading, ReadingType } from '@/types';
import { useReadingsStore } from '@/stores/readings';
import { usePremisesStore } from '@/stores/premises';
import { monthKey } from '@/utils/dayjs';
import { logger } from '@/utils/logger';
import ReadingCard from './ReadingCard.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import SdbDialog from '@/components/common/SdbDialog.vue';

const emit = defineEmits<{ (e: 'edit', r: Reading): void }>();

const readings = useReadingsStore();
const premises = usePremisesStore();

// 仅展示当前房源的读数
const displayReadings = computed<Reading[]>(() =>
  readings.sortedReadings.filter((r) => r.premiseId === premises.currentPremiseId),
);

// ---------- 类型筛选 ----------
const typeTabs = [
  { key: 'all', title: '全部' },
  { key: 'electricity', title: '电' },
  { key: 'water', title: '水' },
] as const;

const activeTypeIndex = computed(() => {
  const t = readings.filter.type;
  if (!t) return 0;
  const idx = typeTabs.findIndex((x) => x.key === t);
  return idx < 0 ? 0 : idx;
});

function onTypeChange(index: number | string): void {
  const idx = typeof index === 'number' ? index : Number(index);
  const key = typeTabs[idx]?.key ?? 'all';
  readings.setFilter({ type: key === 'all' ? undefined : (key as ReadingType) });
}

// ---------- 排序 ----------
const sortKey = ref<'date' | 'reading'>(readings.sortBy === 'reading' ? 'reading' : 'date');
const sortDesc = ref(readings.sortDesc);

function setSortKey(key: 'date' | 'reading'): void {
  if (sortKey.value === key) {
    sortDesc.value = !sortDesc.value;
  } else {
    sortKey.value = key;
    sortDesc.value = true;
  }
  readings.setSort(key, sortDesc.value);
}
function toggleDir(): void {
  sortDesc.value = !sortDesc.value;
  readings.setSort(sortKey.value, sortDesc.value);
}

// ---------- 月份筛选 ----------
const showMonthPicker = ref(false);
const monthParts = ref<string[]>([]);
const currentMonthLabel = computed(() => readings.filter.month ?? '全部月份');

function openMonthPicker(): void {
  const base = readings.filter.month || monthKey();
  monthParts.value = base.split('-');
  showMonthPicker.value = true;
}
function onMonthConfirm(): void {
  const [y, m] = monthParts.value;
  readings.setFilter({ month: `${y}-${String(m).padStart(2, '0')}` });
  showMonthPicker.value = false;
}
function clearMonth(): void {
  readings.setFilter({ month: undefined });
}

const minDate = new Date(2000, 0, 1);
const maxDate = new Date(2035, 11, 31);

// ---------- 删除确认 ----------
const pendingDelete = ref<Reading | null>(null);
const confirmDialog = ref<InstanceType<typeof SdbDialog> | null>(null);

function onDelete(r: Reading): void {
  pendingDelete.value = r;
  confirmDialog.value?.open();
}
async function confirmDelete(): Promise<void> {
  if (!pendingDelete.value) return;
  const target = pendingDelete.value;
  pendingDelete.value = null;
  try {
    await readings.removeReading(target.id);
  } catch (err) {
    logger.error('readings:list', '删除读数失败', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
</script>

<template>
  <div class="reading-list">
    <!-- 筛选条 -->
    <div class="filter-bar">
      <van-tabs :active="activeTypeIndex" @change="onTypeChange" class="filter-bar__tabs">
        <van-tab v-for="t in typeTabs" :key="t.key" :title="t.title" />
      </van-tabs>
      <div class="filter-bar__row">
        <button class="chip" :class="{ active: sortKey === 'date' }" type="button" @click="setSortKey('date')">
          日期
        </button>
        <button class="chip" :class="{ active: sortKey === 'reading' }" type="button" @click="setSortKey('reading')">
          读数
        </button>
        <button class="chip dir" type="button" :aria-label="sortDesc ? '降序' : '升序'" @click="toggleDir">
          {{ sortDesc ? '↓' : '↑' }}
        </button>
        <button class="chip month" type="button" @click="openMonthPicker">{{ currentMonthLabel }}</button>
        <button v-if="readings.filter.month" class="chip clear" type="button" aria-label="清除月份" @click="clearMonth">
          ×
        </button>
      </div>
    </div>

    <!-- 列表 / 空态 -->
    <div v-if="displayReadings.length === 0">
      <EmptyState text="暂无读数记录" hint="点击下方「记一笔」或右下「+」开始记录" />
    </div>
    <div v-else class="sdb-grid-2 reading-list__grid">
      <ReadingCard
        v-for="r in displayReadings"
        :key="r.id"
        :reading="r"
        @edit="(rr) => emit('edit', rr)"
        @delete="onDelete"
      />
    </div>

    <!-- 删除确认 -->
    <SdbDialog
      ref="confirmDialog"
      title="删除读数"
      :message="pendingDelete ? `确定删除 ${pendingDelete.date} 的这条读数吗？删除后不可恢复。` : ''"
      confirm-text="删除"
      cancel-text="取消"
      @confirm="confirmDelete"
    />

    <!-- 月份选择器 -->
    <van-popup v-model:show="showMonthPicker" position="bottom" round>
      <div class="picker-pop">
        <div class="picker-pop__header">
          <span class="picker-pop__btn" @click="showMonthPicker = false">取消</span>
          <span class="picker-pop__title">选择月份</span>
          <span class="picker-pop__btn picker-pop__btn--ok" @click="onMonthConfirm">确定</span>
        </div>
        <van-date-picker
          v-model="monthParts"
          :min-date="minDate"
          :max-date="maxDate"
          :columns-type="['year', 'month']"
        />
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.filter-bar {
  margin-bottom: 8px;
}
.filter-bar__tabs {
  margin-bottom: 8px;
}
.filter-bar__row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.chip {
  border: 1px solid var(--sdb-surface-2);
  background: var(--sdb-surface);
  color: var(--sdb-text-secondary);
  border-radius: 999px;
  padding: 5px 14px;
  font-size: 13px;
  cursor: pointer;
}
.chip.active {
  background: var(--sdb-primary);
  border-color: var(--sdb-primary);
  color: var(--sdb-on-primary);
}
.chip.dir {
  min-width: 38px;
  padding: 5px 0;
  text-align: center;
}
.chip.month {
  margin-left: auto;
}
.chip.clear {
  color: var(--sdb-danger);
  border-color: var(--sdb-danger);
}
.reading-list__grid {
  margin-top: 4px;
}
.picker-pop {
  background: var(--sdb-surface);
}
.picker-pop__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--sdb-surface-2);
}
.picker-pop__title {
  font-weight: 600;
  color: var(--sdb-text);
}
.picker-pop__btn {
  color: var(--sdb-text-secondary);
  cursor: pointer;
}
.picker-pop__btn--ok {
  color: var(--sdb-primary);
  font-weight: 600;
}
@media (min-width: 768px) {
  .picker-pop {
    max-width: 560px;
    margin: 0 auto;
  }
}
</style>

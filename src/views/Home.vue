<script setup lang="ts">
// 首页：本月概览骨架（房源选择 / 当月月份 / 指标卡 / 快捷入口）
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import type { Reading } from '@/types';
import { usePremisesStore } from '@/stores/premises';
import { useBillsStore } from '@/stores/bills';
import { useReadingsStore } from '@/stores/readings';
import { monthKey, formatMonthLabel } from '@/utils/dayjs';
import { formatCurrency, formatNumber } from '@/utils/format';
import EmptyState from '@/components/common/EmptyState.vue';
import PremiseSelector from '@/components/common/PremiseSelector.vue';

const router = useRouter();
const premisesStore = usePremisesStore();
const billsStore = useBillsStore();
const readingsStore = useReadingsStore();

const { currentPremiseId } = storeToRefs(premisesStore);

const currentMonth = ref(monthKey());

const bill = computed(() =>
  currentPremiseId.value ? billsStore.billForMonth(currentMonth.value, currentPremiseId.value) : undefined,
);

// 本月读数：仅当前房源 + 当前月份（与首页顶栏显示的当月一致）
const monthReadings = computed(() =>
  readingsStore.items.filter(
    (r) => !r.isDeleted && r.premiseId === currentPremiseId.value && r.date.startsWith(currentMonth.value),
  ),
);
const monthReadingCount = computed(() => monthReadings.value.length);

// 简易度数列表用的类型/单位元信息（电=暖橘、水=海蓝，与全局水电语义色一致）
function readingMeta(r: Reading): { label: string; unit: string; tagClass: string } {
  return r.type === 'electricity'
    ? { label: '电', unit: '度', tagClass: 'is-elec' }
    : { label: '水', unit: '吨', tagClass: 'is-water' };
}

// 首页简易列表：按日期倒序取最近 5 条（其余点「查看全部」进读数页）
const monthReadingsView = computed(() =>
  [...monthReadings.value].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5),
);
const hasMoreMonthReadings = computed(() => monthReadings.value.length > monthReadingsView.value.length);

// 单条用量（相对上期读数）；首条无上期则为 null
function readingUsage(r: Reading): number | null {
  return r.previousReading != null ? r.reading - r.previousReading : null;
}

const metrics = computed(() => [
  { label: '本月电费', value: bill.value ? formatCurrency(bill.value.electricityCost) : '—' },
  { label: '本月水费', value: bill.value ? formatCurrency(bill.value.waterCost) : '—' },
  { label: '本月总支出', value: bill.value ? formatCurrency(bill.value.totalCost) : '—' },
  { label: '本月条数', value: formatNumber(monthReadingCount.value) },
]);

onMounted(async () => {
  await billsStore.load();
  await readingsStore.load();
});
</script>

<template>
  <div>
    <section class="sdb-card sdb-home__top">
      <span class="sdb-home__label">房源</span>
      <PremiseSelector />
      <div class="sdb-home__month">{{ formatMonthLabel(currentMonth) }}</div>
    </section>

    <section class="sdb-grid-4 sdb-home__metrics">
      <div v-for="m in metrics" :key="m.label" class="sdb-card sdb-metric">
        <div class="sdb-metric__label">{{ m.label }}</div>
        <div class="sdb-metric__value">{{ m.value }}</div>
      </div>
    </section>

    <!-- 本月读数：仅当前房源 + 当前月份，简易列表（最近 5 条） -->
    <section v-if="monthReadings.length" class="sdb-card sdb-home__readings">
      <div class="sdb-home__readings-head">
        <h3 class="sdb-card__title">本月读数</h3>
        <button class="sdb-link" type="button" @click="router.push('/readings')">查看全部</button>
      </div>
      <ul class="sdb-home__reading-list">
        <li v-for="r in monthReadingsView" :key="r.id" class="sdb-home__reading">
          <span class="sdb-tag" :class="readingMeta(r).tagClass">{{ readingMeta(r).label }}</span>
          <div class="sdb-home__reading-main">
            <span class="sdb-home__reading-val">
              {{ formatNumber(r.reading) }}<i class="sdb-home__unit">{{ readingMeta(r).unit }}</i>
            </span>
            <span class="sdb-home__reading-date">{{ r.date }}</span>
          </div>
          <span v-if="readingUsage(r) != null" class="sdb-home__reading-usage">
            +{{ formatNumber(readingUsage(r) as number) }}
          </span>
        </li>
      </ul>
      <div v-if="hasMoreMonthReadings" class="sdb-home__readings-more">
        还有 {{ monthReadings.length - monthReadingsView.length }} 条，点「查看全部」查看
      </div>
    </section>

    <section class="sdb-home__actions">
      <van-button type="primary" round @click="router.push('/readings')">记一笔读数</van-button>
      <van-button plain type="primary" round class="sdb-home__btn2" @click="router.push('/bills')">
        查看账单
      </van-button>
    </section>

    <EmptyState v-if="!bill" text="本月还没有账单" hint="记录读数后将自动生成账单" />
  </div>
</template>

<style scoped>
.sdb-home__top {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.sdb-home__label {
  font-size: 13px;
  color: var(--sdb-text-secondary);
}
.sdb-home__month {
  font-weight: 600;
  color: var(--sdb-primary);
}
.sdb-metric__label {
  font-size: 13px;
  color: var(--sdb-text-secondary);
}
.sdb-metric__value {
  font-family: var(--sdb-font-hand);
  font-size: 28px;
  font-weight: 700;
  margin-top: 6px;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
  color: var(--sdb-text);
}
/* 本月读数简易列表 */
.sdb-home__readings {
  margin-bottom: 12px;
}
.sdb-home__readings-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.sdb-link {
  border: none;
  background: transparent;
  color: var(--sdb-primary);
  font-size: 13px;
  cursor: pointer;
  padding: 0;
}
.sdb-home__reading-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.sdb-home__reading {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-top: 1px solid var(--sdb-surface-2);
}
.sdb-home__reading:first-child {
  border-top: none;
}
.sdb-tag {
  flex-shrink: 0;
  min-width: 28px;
  text-align: center;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  color: #fff;
}
.sdb-tag.is-elec {
  background: var(--sdb-electricity);
}
.sdb-tag.is-water {
  background: var(--sdb-water);
}
.sdb-home__reading-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.sdb-home__reading-val {
  font-family: var(--sdb-font-hand);
  font-size: 18px;
  font-weight: 700;
  color: var(--sdb-text);
  font-variant-numeric: tabular-nums;
}
.sdb-home__unit {
  font-style: normal;
  font-size: 12px;
  color: var(--sdb-text-secondary);
  margin-left: 2px;
}
.sdb-home__reading-date {
  font-size: 12px;
  color: var(--sdb-text-secondary);
}
.sdb-home__reading-usage {
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--sdb-text-secondary);
  font-variant-numeric: tabular-nums;
}
.sdb-home__readings-more {
  margin-top: 6px;
  font-size: 12px;
  color: var(--sdb-text-tertiary, #8a8073);
  text-align: right;
}
.sdb-home__actions {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.sdb-home__btn2 {
  margin-top: 0;
}
/* 桌面：操作按钮并排（block 改为自适应宽度，主次分明） */
@media (min-width: 768px) {
  .sdb-home__actions {
    flex-direction: row;
    gap: 12px;
  }
  .sdb-home__actions :deep(.van-button) {
    min-width: 160px;
  }
}
</style>

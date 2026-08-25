<script setup lang="ts">
// 首页：本月概览骨架（房源选择 / 当月月份 / 指标卡 / 快捷入口）
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
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

// A1：读数条数仅统计当前房源（按 premiseId 维度，不再统计全部房源）
const readingCount = computed(
  () =>
    readingsStore.items.filter(
      (r) => !r.isDeleted && r.premiseId === currentPremiseId.value,
    ).length,
);

const metrics = computed(() => [
  { label: '本月电费', value: bill.value ? formatCurrency(bill.value.electricityCost) : '—' },
  { label: '本月水费', value: bill.value ? formatCurrency(bill.value.waterCost) : '—' },
  { label: '本月总支出', value: bill.value ? formatCurrency(bill.value.totalCost) : '—' },
  { label: '读数条数', value: formatNumber(readingCount.value) },
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

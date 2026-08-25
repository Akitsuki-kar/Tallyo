<script setup lang="ts">
// 房源选择器（D1：多房源切换，三页共享当前房源）
// 沿用首页的 .sdb-chip / .is-active 视觉，颜色走 --sdb-* 变量。
// 仅 1 个房源时为只读态（不可点击）。
import { storeToRefs } from 'pinia';
import { usePremisesStore } from '@/stores/premises';

const premisesStore = usePremisesStore();
const { list, currentPremiseId } = storeToRefs(premisesStore);

function select(id: string): void {
  // 仅单房源时不响应点击（即只读）
  if (list.value.length <= 1) return;
  premisesStore.setCurrent(id);
}
</script>

<template>
  <div class="sdb-home__chips">
    <button
      v-for="p in list"
      :key="p.id"
      type="button"
      class="sdb-chip"
      :class="{ 'is-active': p.id === currentPremiseId }"
      :disabled="list.length <= 1"
      :aria-pressed="p.id === currentPremiseId"
      @click="select(p.id)"
    >
      {{ p.name }}
    </button>
  </div>
</template>

<style scoped>
.sdb-home__chips {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  flex: 1;
}
.sdb-chip {
  border: 1px solid var(--sdb-border);
  background: var(--sdb-surface-2);
  color: var(--sdb-text-secondary);
  border-radius: 999px;
  padding: 7px 14px;
  min-height: 36px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background-color var(--sdb-dur) var(--sdb-ease-out),
    color var(--sdb-dur) var(--sdb-ease-out),
    border-color var(--sdb-dur) var(--sdb-ease-out),
    transform var(--sdb-dur-fast) var(--sdb-ease-out-quart);
}
.sdb-chip.is-active {
  background: var(--sdb-primary);
  border-color: var(--sdb-primary);
  color: var(--sdb-on-primary);
  box-shadow: var(--sdb-shadow-sm);
}
.sdb-chip:not(:disabled):active {
  transform: translateY(1px);
}
.sdb-chip:disabled {
  cursor: default;
}
</style>

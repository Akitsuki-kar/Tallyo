<script setup lang="ts">
// 读数卡片：展示单条读数的日期 / 类型 / 本次读数 / 用量 / 备注，并提供编辑、删除入口。
import { computed } from 'vue';
import type { Reading } from '@/types';
import { useReadingsStore } from '@/stores/readings';
import { formatNumber } from '@/utils/format';

const props = defineProps<{ reading: Reading }>();
const emit = defineEmits<{ (e: 'edit', r: Reading): void; (e: 'delete', r: Reading): void }>();

const readings = useReadingsStore();

const usage = computed(() => readings.usageOf(props.reading));
const isNegative = computed(() => usage.value < 0);

// 电=暖橘(warning) / 水=海蓝(water)，与全局水电语义色一致
const typeMeta = computed(() =>
  props.reading.type === 'electricity'
    ? { label: '电', tagClass: 'is-elec-tag' }
    : { label: '水', tagClass: 'is-water-tag' },
);
const unitLabel = computed(() => (props.reading.type === 'electricity' ? '度' : '吨'));

function onEdit(): void {
  emit('edit', props.reading);
}
function onDelete(): void {
  emit('delete', props.reading);
}
</script>

<template>
  <div class="reading-card sdb-card" :class="props.reading.type === 'electricity' ? 'is-electricity' : 'is-water'">
    <div class="reading-card__top">
      <van-tag round :class="typeMeta.tagClass">{{ typeMeta.label }}</van-tag>
      <span class="reading-card__date">{{ props.reading.date }}</span>
      <div class="reading-card__actions">
        <van-icon name="edit" class="reading-card__icon" aria-label="编辑" @click="onEdit" />
        <van-icon name="delete-o" class="reading-card__icon reading-card__icon--danger" aria-label="删除" @click="onDelete" />
      </div>
    </div>

    <div class="reading-card__main">
      <div class="reading-card__reading">
        <span class="reading-card__value">{{ formatNumber(props.reading.reading) }}</span>
        <span class="reading-card__unit">{{ unitLabel }}</span>
      </div>
      <div class="reading-card__usage" :class="{ 'is-negative': isNegative }">
        用量 {{ isNegative ? '' : '+' }}{{ formatNumber(usage) }} {{ unitLabel }}
      </div>
    </div>

    <div v-if="props.reading.note" class="reading-card__note">{{ props.reading.note }}</div>
  </div>
</template>

<style scoped>
.reading-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: hidden;
}
/* 左侧类型强调条（电=琥珀 / 水=暖橘） */
.reading-card::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  background: var(--sdb-warning);
}
.reading-card.is-water::before {
  background: var(--sdb-water);
}
/* 类型标签：电=暖橘、水=海蓝（蓝底白字，对比充足可读） */
.reading-card :deep(.van-tag.is-elec-tag) {
  background: var(--sdb-warning);
  color: var(--sdb-on-semantic);
  border-color: var(--sdb-warning);
}
.reading-card :deep(.van-tag.is-water-tag) {
  background: var(--sdb-water);
  color: #fff;
  border-color: var(--sdb-water);
}
.reading-card__top {
  display: flex;
  align-items: center;
  gap: 8px;
}
.reading-card__date {
  flex: 1;
  color: var(--sdb-text-secondary);
  font-size: 13px;
}
.reading-card__actions {
  display: flex;
  gap: 12px;
}
.reading-card__icon {
  font-size: 18px;
  color: var(--sdb-text-secondary);
  cursor: pointer;
}
.reading-card__icon--danger {
  color: var(--sdb-danger);
}
.reading-card__main {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.reading-card__value {
  font-size: 24px;
  font-weight: 700;
  color: var(--sdb-text);
}
.reading-card__unit {
  margin-left: 4px;
  font-size: 13px;
  color: var(--sdb-text-secondary);
}
.reading-card__usage {
  font-size: 14px;
  font-weight: 600;
  color: var(--sdb-success);
}
.reading-card__usage.is-negative {
  color: var(--sdb-danger);
}
.reading-card__note {
  font-size: 13px;
  color: var(--sdb-text-secondary);
  background: var(--sdb-surface-2);
  border-radius: 8px;
  padding: 6px 10px;
}
</style>

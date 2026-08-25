<script setup lang="ts">
/**
 * 账单模板选择器（手作美学）
 *
 * 4 个 pill 按钮：小票(receipt) / 极简(minimal) / 卡片(card) / 报表(report)。
 * 当前选中高亮。选择后 emit change 事件，由父组件持久化到 settings store。
 */
import type { BillTemplateId } from '@/types';

const props = defineProps<{
  /** 当前模板 ID */
  modelValue: BillTemplateId;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', id: BillTemplateId): void;
}>();

/** 模板选项 */
const options: Array<{ id: BillTemplateId; label: string; icon: string }> = [
  { id: 'receipt', label: '小票', icon: 'description' },
  { id: 'minimal', label: '极简', icon: 'minimize' },
  { id: 'card', label: '卡片', icon: 'credit-pay' },
  { id: 'report', label: '报表', icon: 'orders-o' },
];

function onSelect(id: BillTemplateId): void {
  if (id !== props.modelValue) emit('update:modelValue', id);
}
</script>

<template>
  <div class="bill-tpl-selector">
    <button
      v-for="opt in options"
      :key="opt.id"
      class="bill-tpl-selector__btn"
      :class="{ 'is-active': modelValue === opt.id }"
      @click="onSelect(opt.id)"
    >
      <van-icon :name="opt.icon" />
      <span>{{ opt.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.bill-tpl-selector {
  display: flex;
  gap: 8px;
  background: var(--sdb-surface-2);
  border-radius: var(--sdb-radius-pill);
  padding: 4px;
}

.bill-tpl-selector__btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: none;
  background: transparent;
  border-radius: var(--sdb-radius-pill);
  padding: 8px 6px;
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
.bill-tpl-selector__btn .van-icon {
  font-size: 15px;
}
.bill-tpl-selector__btn.is-active {
  background: var(--sdb-primary);
  color: var(--sdb-on-primary);
  box-shadow: var(--sdb-shadow-sm);
}
</style>

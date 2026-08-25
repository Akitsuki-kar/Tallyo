<script setup lang="ts">
// 统一暖色风格对话框（封装 Vant Dialog）
import { ref } from 'vue';

const props = withDefaults(
  defineProps<{
    title?: string;
    message?: string;
    confirmText?: string;
    cancelText?: string;
    showCancel?: boolean;
  }>(),
  {
    title: '',
    message: '',
    confirmText: '确定',
    cancelText: '取消',
    showCancel: true,
  },
);

const visible = ref(false);
const emit = defineEmits<{ (e: 'confirm'): void; (e: 'cancel'): void }>();

function open(): void {
  visible.value = true;
}
function close(): void {
  visible.value = false;
}
function onConfirm(): void {
  visible.value = false;
  emit('confirm');
}
function onCancel(): void {
  visible.value = false;
  emit('cancel');
}

defineExpose({ open, close });
</script>

<template>
  <van-dialog
    v-model:show="visible"
    :title="props.title"
    :show-cancel-button="props.showCancel"
    :confirm-button-text="props.confirmText"
    :cancel-button-text="props.cancelText"
    confirm-button-color="var(--sdb-primary)"
    @confirm="onConfirm"
    @cancel="onCancel"
  >
    <div class="sdb-dialog__body">
      <p v-if="props.message">{{ props.message }}</p>
      <slot />
    </div>
  </van-dialog>
</template>

<style scoped>
.sdb-dialog__body {
  padding: 16px;
  color: var(--sdb-text);
}
</style>

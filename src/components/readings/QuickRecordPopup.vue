<script setup lang="ts">
// 快速记录弹窗：底部弹出，内嵌极简 ReadingForm（仅电/水 + 读数 + 日期）
// 向下兼容 ReadingForm 的 'saved' 事件：保存成功后关闭弹窗。
import { ref } from 'vue';
import ReadingForm from './ReadingForm.vue';

withDefaults(defineProps<{ compact?: boolean }>(), { compact: true });

const show = ref(false);
const formKey = ref(0);

function open(): void {
  formKey.value += 1;
  show.value = true;
}
function close(): void {
  show.value = false;
}
function onSaved(): void {
  close();
}

defineExpose({ open, close });
</script>

<template>
  <van-popup v-model:show="show" position="bottom" round :style="{ maxHeight: '92%' }">
    <div class="qr-popup">
      <div class="qr-popup__header">
        <span class="qr-popup__title">快速记账</span>
        <van-icon name="cross" class="qr-popup__close" aria-label="关闭" @click="close" />
      </div>
      <ReadingForm v-if="show" :key="formKey" compact @saved="onSaved" />
    </div>
  </van-popup>
</template>

<style scoped>
.qr-popup {
  display: flex;
  flex-direction: column;
  max-height: 90vh;
  overflow-y: auto;
  background: var(--sdb-bg);
}
.qr-popup__header {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  background: var(--sdb-surface);
  border-bottom: 1px solid var(--sdb-surface-2);
}
.qr-popup__title {
  font-size: 16px;
  font-weight: 600;
  color: var(--sdb-text);
}
.qr-popup__close {
  font-size: 20px;
  color: var(--sdb-text-secondary);
}
@media (min-width: 768px) {
  .qr-popup {
    max-width: 560px;
    margin: 0 auto;
  }
}
</style>

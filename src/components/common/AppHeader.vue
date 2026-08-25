<script setup lang="ts">
// 全局顶栏（暖色），提供标题与右侧操作插槽（如主题切换）
const props = withDefaults(
  defineProps<{
    title?: string;
    showBack?: boolean;
  }>(),
  {
    title: '水电动账',
    showBack: false,
  },
);

const emit = defineEmits<{ (e: 'back'): void }>();

function onBack(): void {
  emit('back');
}
</script>

<template>
  <header class="sdb-header">
    <button v-if="showBack" class="sdb-header__back" type="button" aria-label="返回" @click="onBack">‹</button>
    <h1 class="sdb-header__title">{{ props.title }}</h1>
    <div class="sdb-header__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.sdb-header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 8px;
  height: var(--sdb-header-h);
  padding: 0 16px;
  /* 暖橘柔和渐变 + 底部圆角，像一张便签顶条 */
  background: linear-gradient(135deg, var(--sdb-primary), var(--sdb-primary-dark));
  color: var(--sdb-on-primary);
  border-radius: 0 0 var(--sdb-radius) var(--sdb-radius);
  box-shadow: var(--sdb-shadow);
}
.sdb-header__title {
  font-size: 19px;
  font-weight: 700;
  letter-spacing: 0.02em;
  margin: 0;
  flex: 1;
}
.sdb-header__back {
  background: transparent;
  border: none;
  color: var(--sdb-on-primary);
  font-size: 26px;
  line-height: 1;
  cursor: pointer;
}
.sdb-header__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
/* 桌面：顶栏与主内容区外缘对齐（补偿 main 的左右内边距），四角圆润浮动卡片 */
@media (min-width: 768px) {
  .sdb-header {
    margin: 0 auto;
    max-width: calc(var(--sdb-maxw-md) + 2 * var(--sdb-space-5));
    height: 60px;
    padding: 0 20px;
    border-radius: var(--sdb-radius-lg);
  }
  .sdb-header__title {
    font-size: 20px;
  }
}
@media (min-width: 1024px) {
  .sdb-header {
    max-width: calc(var(--sdb-maxw-lg) + 2 * var(--sdb-space-5));
  }
}
</style>

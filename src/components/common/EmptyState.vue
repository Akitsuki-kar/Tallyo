<script setup lang="ts">
// 空状态占位组件
withDefaults(
  defineProps<{ text?: string; hint?: string }>(),
  {
    text: '暂无数据',
    hint: '',
  },
);
</script>

<template>
  <div class="sdb-empty sdb-rise">
    <div class="sdb-empty__halo">
      <van-icon name="inbox-o" class="sdb-empty__icon" />
    </div>
    <p class="sdb-empty__text">{{ text }}</p>
    <p v-if="hint" class="sdb-empty__hint">{{ hint }}</p>
    <slot />
  </div>
</template>

<style scoped>
.sdb-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 48px 16px;
  color: var(--sdb-text-secondary);
}
.sdb-empty__halo {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  border-radius: var(--sdb-radius-pill);
  background: var(--sdb-surface-2);
  box-shadow: var(--sdb-shadow-sm);
}
.sdb-empty__icon {
  font-size: 38px;
  color: var(--sdb-primary);
}
.sdb-empty__text {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--sdb-text);
}
.sdb-empty__hint {
  margin: 0;
  font-size: 12px;
  opacity: 0.85;
}
</style>

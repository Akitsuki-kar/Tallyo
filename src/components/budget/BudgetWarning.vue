<script setup lang="ts">
/**
 * 预算预警横幅（手作美学）
 *
 * 根据 budget store 的 warnings() 结果渲染暖色便签风预警卡：
 * - warning 级（80-100%）：琥珀左边框，提示「接近预算上限」
 * - exceeded 级（>100%）：暖红左边框，提示「已超预算」
 *
 * 严格使用 --sdb-* token，无硬编码颜色。
 */

/** 单条预警信息 */
interface BudgetWarningItem {
  type: 'electricity' | 'water';
  level: 'warning' | 'exceeded';
}

const props = defineProps<{
  /** 预警列表（由 budget store 的 warnings() 生成） */
  items: BudgetWarningItem[];
}>();

/** 类型中文标签 */
const typeLabel: Record<'electricity' | 'water', string> = {
  electricity: '电费',
  water: '水费',
};

/** 级别文案 */
function message(level: 'warning' | 'exceeded'): string {
  return level === 'exceeded' ? '已超出预算上限，请关注' : '已接近预算上限（80%），请留意';
}
</script>

<template>
  <div v-if="items.length > 0" class="budget-warnings">
    <div
      v-for="(w, i) in items"
      :key="`${w.type}-${w.level}-${i}`"
      class="budget-warning sdb-card"
      :class="`is-${w.level}`"
    >
      <van-icon
        :name="w.level === 'exceeded' ? 'warning-o' : 'bell'"
        class="budget-warning__icon"
      />
      <div class="budget-warning__body">
        <span class="budget-warning__type">{{ typeLabel[w.type] }}</span>
        <span class="budget-warning__msg">{{ message(w.level) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.budget-warnings {
  display: flex;
  flex-direction: column;
  gap: var(--sdb-space-2);
}

.budget-warning {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  /* 左边框语义色条 */
  border-left: 4px solid var(--sdb-border);
}

.is-warning {
  border-left-color: var(--sdb-warning);
  background: var(--sdb-surface);
}
.is-exceeded {
  border-left-color: var(--sdb-danger);
  background: var(--sdb-surface);
}

.budget-warning__icon {
  font-size: 18px;
  line-height: 1.4;
  flex-shrink: 0;
}
.is-warning .budget-warning__icon { color: var(--sdb-warning); }
.is-exceeded .budget-warning__icon { color: var(--sdb-danger); }

.budget-warning__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.budget-warning__type {
  font-size: var(--sdb-text-sm);
  font-weight: 700;
  color: var(--sdb-text);
}
.budget-warning__msg {
  font-size: var(--sdb-text-xs);
  color: var(--sdb-text-secondary);
}
</style>

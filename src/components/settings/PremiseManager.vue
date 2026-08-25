<script setup lang="ts">
/**
 * 房源管理（设置页内嵌分区）
 *
 * 功能：
 * 1. 房源列表卡片：名称 / 备注 / 读数条数，点击切换当前房源
 * 2. 新增房源（底部弹层表单：名称 + 备注，写入默认单价）
 * 3. 编辑房源（同表单，回填既有值）
 * 4. 删除房源（软删 tombstone，同步链路兼容；最后一个房源不可删）
 *
 * 数据层复用 premises store 既有 CRUD（addPremise / updatePremise / removePremise），
 * 读数条数从 readings store 按 premiseId 统计。
 */
import { computed, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { showSuccessToast, showToast, showConfirmDialog } from 'vant';
import { usePremisesStore } from '@/stores/premises';
import { useReadingsStore } from '@/stores/readings';
import { logger } from '@/utils/logger';
import type { Premise } from '@/types';

const premisesStore = usePremisesStore();
const readingsStore = useReadingsStore();
const { list, currentPremiseId } = storeToRefs(premisesStore);

// ---- 读数条数（按房源统计，软删不计） ----
function readingCount(premiseId: string): number {
  return readingsStore.items.filter((r) => !r.isDeleted && r.premiseId === premiseId).length;
}

// ---- 表单弹层（新增 / 编辑共用） ----
const showForm = ref(false);
const editingId = ref<string | null>(null); // null = 新增
const formName = ref('');
const formNote = ref('');
const saving = ref(false);

const formTitle = computed(() => (editingId.value ? '编辑房源' : '新增房源'));

function openAdd(): void {
  editingId.value = null;
  formName.value = '';
  formNote.value = '';
  showForm.value = true;
}

function openEdit(p: Premise): void {
  editingId.value = p.id;
  formName.value = p.name;
  formNote.value = p.note ?? '';
  showForm.value = true;
}

async function onSave(): Promise<void> {
  const name = formName.value.trim();
  if (!name) {
    showToast('请填写房源名称');
    return;
  }
  saving.value = true;
  try {
    if (editingId.value) {
      await premisesStore.updatePremise(editingId.value, { name, note: formNote.value.trim() || undefined });
      showSuccessToast('房源已更新');
    } else {
      await premisesStore.addPremise(name, formNote.value.trim() || undefined);
      showSuccessToast('房源已添加');
    }
    showForm.value = false;
  } catch (err) {
    logger.error('settings:premise', '保存房源失败', {
      message: err instanceof Error ? err.message : String(err),
    });
    showToast('保存失败，请重试');
  } finally {
    saving.value = false;
  }
}

// ---- 删除（软删；最后一个房源不可删） ----
async function onDelete(p: Premise): Promise<void> {
  if (list.value.length <= 1) {
    showToast('至少保留一个房源');
    return;
  }
  try {
    await showConfirmDialog({
      title: '删除房源',
      message: `确定删除「${p.name}」吗？删除后该房源的读数与账单不再显示，数据仍保留在本地，可通过导出备份。`,
      confirmButtonText: '删除',
      confirmButtonColor: 'var(--sdb-danger)',
    });
  } catch {
    return; // 用户取消
  }
  try {
    await premisesStore.removePremise(p.id);
    showSuccessToast('房源已删除');
  } catch (err) {
    logger.error('settings:premise', '删除房源失败', {
      message: err instanceof Error ? err.message : String(err),
    });
    showToast('删除失败，请重试');
  }
}

onMounted(async () => {
  if (!readingsStore.items.length) {
    await readingsStore.load();
  }
});
</script>

<template>
  <!-- 房源管理分区（沿用设置页 van-cell-group inset 骨架） -->
  <div class="sdb-card premise-manager">
    <div class="premise-manager__head">
      <span class="premise-manager__title">房源管理</span>
      <span class="premise-manager__count">{{ list.length }} 套</span>
    </div>

    <ul class="premise-manager__list">
      <li
        v-for="p in list"
        :key="p.id"
        class="premise-manager__item"
        :class="{ 'is-current': p.id === currentPremiseId }"
        role="button"
        tabindex="0"
        @click="premisesStore.setCurrent(p.id)"
        @keydown.enter="premisesStore.setCurrent(p.id)"
      >
        <div class="premise-manager__info">
          <div class="premise-manager__name-row">
            <span class="premise-manager__name">{{ p.name }}</span>
            <span v-if="p.id === currentPremiseId" class="premise-manager__badge">当前</span>
          </div>
          <div class="premise-manager__meta">
            <span>{{ readingCount(p.id) }} 条读数</span>
            <span v-if="p.note" class="premise-manager__note">{{ p.note }}</span>
          </div>
        </div>
        <div class="premise-manager__actions" @click.stop>
          <button
            class="premise-manager__btn"
            type="button"
            aria-label="编辑房源"
            @click="openEdit(p)"
          >
            <van-icon name="edit" />
          </button>
          <button
            class="premise-manager__btn is-danger"
            type="button"
            aria-label="删除房源"
            :disabled="list.length <= 1"
            @click="onDelete(p)"
          >
            <van-icon name="delete-o" />
          </button>
        </div>
      </li>
    </ul>

    <button class="sdb-btn sdb-btn--ghost sdb-btn--block premise-manager__add" type="button" @click="openAdd">
      <van-icon name="plus" />
      新增房源
    </button>
  </div>

  <!-- 新增/编辑表单（底部弹层，与单价面板同款骨架） -->
  <van-popup v-model:show="showForm" position="bottom" round :style="{ maxHeight: '90%' }">
    <div class="premise-form">
      <div class="premise-form__header">
        <span>{{ formTitle }}</span>
        <van-icon name="cross" class="premise-form__close" aria-label="关闭" @click="showForm = false" />
      </div>

      <div class="premise-form__body">
        <div class="premise-form__field">
          <label class="premise-form__label" for="premise-name">房源名称</label>
          <div class="premise-form__control">
            <input
              id="premise-name"
              v-model="formName"
              type="text"
              maxlength="20"
              placeholder="如：阳光公寓 A 栋"
              class="premise-form__input"
            />
          </div>
        </div>
        <div class="premise-form__field">
          <label class="premise-form__label" for="premise-note">备注（可选）</label>
          <div class="premise-form__control">
            <input
              id="premise-note"
              v-model="formNote"
              type="text"
              maxlength="50"
              placeholder="如：租客小王 / 表在楼道"
              class="premise-form__input"
            />
          </div>
        </div>
        <p class="premise-form__hint">新房源会自动使用默认水电单价，可在「水电单价」中单独调整。</p>
      </div>

      <div class="premise-form__footer">
        <button class="sdb-btn sdb-btn--primary sdb-btn--block" :disabled="saving" @click="onSave">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </div>
    </div>
  </van-popup>
</template>

<style scoped>
/* ---- 管理区容器 ---- */
.premise-manager__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: var(--sdb-space-3);
}
.premise-manager__title {
  font-size: var(--sdb-text-base);
  font-weight: 700;
  color: var(--sdb-text);
}
.premise-manager__count {
  font-size: var(--sdb-text-xs);
  color: var(--sdb-text-tertiary);
}

/* ---- 房源列表 ---- */
.premise-manager__list {
  list-style: none;
  margin: 0 0 var(--sdb-space-3);
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sdb-space-2);
}
.premise-manager__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sdb-space-3);
  padding: 12px 14px;
  background: var(--sdb-surface-2);
  border: 1px solid var(--sdb-border);
  border-radius: var(--sdb-radius-sm);
  cursor: pointer;
  transition:
    border-color var(--sdb-dur) var(--sdb-ease-out),
    background-color var(--sdb-dur) var(--sdb-ease-out);
}
.premise-manager__item:hover {
  border-color: var(--sdb-primary);
}
.premise-manager__item.is-current {
  border-color: var(--sdb-primary);
  background: oklch(from var(--sdb-primary) l c h / 0.08);
}

.premise-manager__info {
  min-width: 0; /* 允许文本收缩省略 */
  flex: 1;
}
.premise-manager__name-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.premise-manager__name {
  font-size: var(--sdb-text-base);
  font-weight: 600;
  color: var(--sdb-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.premise-manager__badge {
  flex: none;
  font-size: var(--sdb-text-xs);
  font-weight: 700;
  color: var(--sdb-on-primary);
  background: var(--sdb-primary);
  padding: 1px 8px;
  border-radius: var(--sdb-radius-pill);
}
.premise-manager__meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 2px;
  font-size: var(--sdb-text-xs);
  color: var(--sdb-text-secondary);
}
.premise-manager__note {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---- 行内操作按钮 ---- */
.premise-manager__actions {
  display: flex;
  gap: 6px;
  flex: none;
}
.premise-manager__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid var(--sdb-border);
  border-radius: var(--sdb-radius-sm);
  background: var(--sdb-surface);
  color: var(--sdb-text-secondary);
  font-size: 16px;
  cursor: pointer;
  transition:
    color var(--sdb-dur) var(--sdb-ease-out),
    border-color var(--sdb-dur) var(--sdb-ease-out);
}
.premise-manager__btn:hover {
  color: var(--sdb-primary);
  border-color: var(--sdb-primary);
}
.premise-manager__btn.is-danger:hover {
  color: var(--sdb-danger);
  border-color: var(--sdb-danger);
}
.premise-manager__btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

/* ---- 表单弹层（与单价面板同款骨架） ---- */
.premise-form {
  display: flex;
  flex-direction: column;
  background: var(--sdb-bg);
  padding-bottom: env(safe-area-inset-bottom);
}
.premise-form__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px 10px;
  font-size: var(--sdb-text-lg);
  font-weight: 700;
  color: var(--sdb-text);
}
.premise-form__close {
  font-size: 20px;
  color: var(--sdb-text-secondary);
  cursor: pointer;
  padding: 4px;
}
.premise-form__body {
  padding: var(--sdb-space-3) var(--sdb-space-4) 0;
  display: flex;
  flex-direction: column;
  gap: var(--sdb-space-4);
}
.premise-form__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.premise-form__label {
  font-size: var(--sdb-text-sm);
  font-weight: 600;
  color: var(--sdb-text);
}
.premise-form__control {
  display: flex;
  background: var(--sdb-surface-2);
  border: 1px solid var(--sdb-border);
  border-radius: var(--sdb-radius-sm);
  padding: 0 12px;
  transition:
    border-color var(--sdb-dur) var(--sdb-ease-out),
    box-shadow var(--sdb-dur) var(--sdb-ease-out);
}
.premise-form__control:focus-within {
  border-color: var(--sdb-primary);
  box-shadow: 0 0 0 3px oklch(from var(--sdb-primary) l c h / 0.15);
}
.premise-form__input {
  flex: 1;
  border: none;
  background: transparent;
  font-family: var(--sdb-font-rounded);
  font-size: var(--sdb-text-base);
  color: var(--sdb-text);
  padding: 11px 0;
  outline: none;
}
.premise-form__input::placeholder {
  color: var(--sdb-text-tertiary);
}
.premise-form__hint {
  margin: 0;
  font-size: var(--sdb-text-xs);
  color: var(--sdb-text-tertiary);
  line-height: 1.6;
}
.premise-form__footer {
  padding: var(--sdb-space-4) var(--sdb-space-4) calc(var(--sdb-space-4) + env(safe-area-inset-bottom));
}
/* 桌面：表单内容居中限宽（弹层全宽，内容收窄，与既有面板一致） */
@media (min-width: 768px) {
  .premise-form {
    max-width: 560px;
    margin: 0 auto;
  }
}
</style>

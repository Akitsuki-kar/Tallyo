<script setup lang="ts">
/**
 * 回收站 / 数据自清洗页（0.1.2）
 *
 * 回答用户两个问题：
 *   1. 「我删掉的东西都去哪了」—— 5 类墓碑的统一列表，可逐条恢复或永久删除；
 *   2. 「库里还干净吗」   —— 一键自检：重复账单合并、空壳账单清理、读数链修复、
 *                            账单全量重算、过期墓碑清除，并给出可核对的回执。
 *
 * 信息架构：概览 → 清理设置（频率 / 保留期 / 立即清理）→ 清理回执 → 类型筛选 → 条目列表。
 * 「永久删除」与「清空回收站」一律二次确认：这一步不可逆，且会随同步传播到所有设备。
 *
 * 视觉沿用既有手作 token（便签卡 + 胶带 + 手写数字），不新增硬编码颜色。
 */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import dayjs from 'dayjs';
import { showConfirmDialog, showSuccessToast, showToast } from 'vant';
import { useTrashStore } from '@/stores/trash';
import { useSettingsStore } from '@/stores/settings';
import type { CleanupFrequency, TrashStoreName } from '@/types';
import { RETENTION_OPTIONS } from '@/utils/cleanup';
import EmptyState from '@/components/common/EmptyState.vue';

const router = useRouter();
const trash = useTrashStore();
const settings = useSettingsStore();
const { trashAutoClean, trashRetentionDays, lastCleanedAt } = storeToRefs(settings);

const busy = ref(false);
const cleaning = ref(false);
/** 类型筛选：'' 表示全部 */
const filterStore = ref<'' | TrashStoreName>('');

const FILTERS: { label: string; value: '' | TrashStoreName }[] = [
  { label: '全部', value: '' },
  { label: '读数', value: 'readings' },
  { label: '账单', value: 'bills' },
  { label: '房源', value: 'premises' },
  { label: '单价', value: 'prices' },
  { label: '预算', value: 'budgets' },
];

const FREQ_OPTIONS: { label: string; value: CleanupFrequency }[] = [
  { label: '不自动', value: 'off' },
  { label: '每周', value: 'weekly' },
  { label: '每月', value: 'monthly' },
];

const visibleItems = computed(() =>
  filterStore.value === '' ? trash.items : trash.items.filter((i) => i.store === filterStore.value),
);

const lastCleanedLabel = computed(() =>
  lastCleanedAt.value ? dayjs(lastCleanedAt.value).format('MM-DD HH:mm') : '从未清理',
);

const retentionLabel = computed(() => `${trashRetentionDays.value} 天`);

function deletedAtLabel(iso: string): string {
  const d = dayjs(iso);
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm') : '未知时间';
}

/** 到期文案：已到期的用警示语气，未到期的给出剩余天数 */
function expireLabel(days: number): { text: string; urgent: boolean } {
  if (days <= 0) return { text: '下次清理时移除', urgent: true };
  if (days === 1) return { text: '明天到期', urgent: false };
  return { text: `${days} 天后移除`, urgent: false };
}

// ---- 恢复 ----
async function onRestore(key: string): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    const okDone = await trash.restore(key);
    if (okDone) showSuccessToast('已恢复');
    else showToast('恢复失败，请重试');
  } finally {
    busy.value = false;
  }
}

// ---- 永久删除（单条）----
async function onPurge(key: string, title: string): Promise<void> {
  if (busy.value) return;
  try {
    await showConfirmDialog({
      title: '永久删除',
      message: `「${title}」将被彻底删除，且会同步到所有设备。此操作不可撤销，确定继续？`,
      confirmButtonText: '永久删除',
      confirmButtonColor: 'var(--sdb-danger)',
      cancelButtonText: '再想想',
    });
  } catch {
    return; // 用户取消
  }
  busy.value = true;
  try {
    const okDone = await trash.purge(key);
    if (okDone) showSuccessToast('已永久删除');
    else showToast('删除失败，请重试');
  } finally {
    busy.value = false;
  }
}

// ---- 清空回收站 ----
async function onPurgeAll(): Promise<void> {
  if (busy.value || trash.count === 0) return;
  try {
    await showConfirmDialog({
      title: '清空回收站',
      message: `将彻底删除全部 ${trash.count} 条记录，并同步到所有设备。此操作不可撤销，确定继续？`,
      confirmButtonText: '全部清空',
      confirmButtonColor: 'var(--sdb-danger)',
      cancelButtonText: '再想想',
    });
  } catch {
    return;
  }
  busy.value = true;
  try {
    const n = await trash.purgeAll();
    showSuccessToast(`已永久删除 ${n} 条`);
  } catch {
    showToast('清空失败，请重试');
  } finally {
    busy.value = false;
  }
}

// ---- 立即清理（自检 + 清理）----
async function onCleanNow(): Promise<void> {
  if (cleaning.value) return;
  cleaning.value = true;
  try {
    const report = await trash.runCleanup();
    const parts: string[] = [];
    if (report.duplicateGroups > 0) parts.push(`合并重复账单 ${report.billsMerged} 张`);
    if (report.orphanBills > 0) parts.push(`清理空账单 ${report.orphanBills} 张`);
    if (report.premiseOrphans > 0) parts.push(`清除无主房源记录 ${report.premiseOrphans} 条`);
    if (report.relinked > 0) parts.push(`修正读数链 ${report.relinked} 条`);
    if (report.recomputed > 0) parts.push(`重算 ${report.recomputed} 个月`);
    if (report.purgedCount > 0) parts.push(`清除过期记录 ${report.purgedCount} 条`);
    showSuccessToast(parts.length > 0 ? parts.join('，') : '数据一切正常，无需清理');
  } catch {
    showToast('清理失败，请重试');
  } finally {
    cleaning.value = false;
  }
}

// ---- 设置变更 ----
async function onFreqChange(value: CleanupFrequency): Promise<void> {
  await settings.update({ trashAutoClean: value });
}

async function onRetentionChange(days: number): Promise<void> {
  await settings.update({ trashRetentionDays: days });
  // 保留期变了，列表上的「还剩几天」需要跟着重算
  await trash.load();
}

onMounted(async () => {
  if (!settings.loaded) await settings.load();
  await trash.load();
});
</script>

<template>
  <div class="sdb-trash">
    <div class="sdb-trash__head">
      <button class="sdb-trash__back" type="button" aria-label="返回设置" @click="router.back()">
        ‹
      </button>
      <h2 class="sdb-page-title sdb-trash__title">回收站</h2>
    </div>

    <!-- 概览 -->
    <section class="sdb-sec sdb-trash__overview">
      <span class="sdb-sec__tape"></span>
      <div class="sdb-ov__stats">
        <div class="sdb-stat">
          <span class="sdb-stat__n">{{ trash.count }}</span>
          <span class="sdb-stat__l">待处理</span>
        </div>
        <div class="sdb-stat">
          <span class="sdb-stat__n" :class="{ 'is-urgent': trash.expiringCount > 0 }">
            {{ trash.expiringCount }}
          </span>
          <span class="sdb-stat__l">已到期</span>
        </div>
        <div class="sdb-stat">
          <span class="sdb-stat__n sdb-stat__n--sm">{{ retentionLabel }}</span>
          <span class="sdb-stat__l">保留期</span>
        </div>
        <div class="sdb-stat">
          <span class="sdb-stat__n sdb-stat__n--sm">{{ lastCleanedLabel }}</span>
          <span class="sdb-stat__l">上次清理</span>
        </div>
      </div>
      <p class="sdb-trash__note">
        删除的内容会先放在这里，超过保留期后由自清洗彻底清除。恢复一条记录会连带修正它影响的账单。
      </p>
    </section>

    <!-- 清理设置 -->
    <section class="sdb-sec">
      <span class="sdb-sec__tape"></span>
      <h3 class="sdb-sec__title">数据自清洗 <small>核对 · 修复 · 瘦身</small></h3>

      <div class="sdb-field">
        <span class="sdb-field__l">自动清理</span>
        <div class="sdb-seg sdb-seg--inline" role="group" aria-label="自动清理频率">
          <button
            v-for="f in FREQ_OPTIONS"
            :key="f.value"
            type="button"
            class="sdb-seg__i"
            :class="{ 'is-on': trashAutoClean === f.value }"
            :aria-pressed="trashAutoClean === f.value"
            @click="onFreqChange(f.value)"
          >
            {{ f.label }}
          </button>
        </div>
      </div>

      <div class="sdb-field">
        <span class="sdb-field__l">墓碑保留</span>
        <div class="sdb-seg sdb-seg--inline" role="group" aria-label="墓碑保留天数">
          <button
            v-for="d in RETENTION_OPTIONS"
            :key="d"
            type="button"
            class="sdb-seg__i"
            :class="{ 'is-on': trashRetentionDays === d }"
            :aria-pressed="trashRetentionDays === d"
            @click="onRetentionChange(d)"
          >
            {{ d }}天
          </button>
        </div>
      </div>

      <p class="sdb-trash__note sdb-trash__note--tight">
        清理时会核对：一房一月是否只有一张账单、是否有无读数的空壳账单、是否有无主房源的脏数据、
        读数链是否一致，发现问题即保留最新的一份并重算该月金额。
      </p>

      <van-button block type="primary" :loading="cleaning" @click="onCleanNow">
        {{ cleaning ? '清理中…' : '立即清理' }}
      </van-button>
    </section>

    <!-- 上次清理回执 -->
    <section v-if="trash.lastReport" class="sdb-sec sdb-sec--report">
      <span class="sdb-sec__tape"></span>
      <h3 class="sdb-sec__title">上次清理 <small>{{ lastCleanedLabel }}</small></h3>
      <ul class="sdb-report">
        <li v-if="trash.lastReport.duplicateGroups > 0">
          <em>🧾</em>发现 {{ trash.lastReport.duplicateGroups }} 组重复账单，保留最新的
          {{ trash.lastReport.duplicateGroups }} 张，移除 {{ trash.lastReport.billsMerged }} 张
        </li>
        <li v-if="trash.lastReport.orphanBills > 0">
          <em>🗑️</em>清理无读数的空账单 {{ trash.lastReport.orphanBills }} 张
        </li>
        <li v-if="trash.lastReport.premiseOrphans > 0">
          <em>🏚️</em>清除无主房源的脏数据 {{ trash.lastReport.premiseOrphans }} 条
        </li>
        <li v-if="trash.lastReport.relinked > 0">
          <em>🔗</em>修正读数链 {{ trash.lastReport.relinked }} 条
        </li>
        <li v-if="trash.lastReport.recomputed > 0">
          <em>🔄</em>重算账单 {{ trash.lastReport.recomputed }} 个月
        </li>
        <li v-if="trash.lastReport.purgedCount > 0">
          <em>✨</em>彻底清除超期记录 {{ trash.lastReport.purgedCount }} 条
        </li>
        <li v-if="trash.lastReport.purgedCount === 0 && trash.lastReport.duplicateGroups === 0 && trash.lastReport.orphanBills === 0 && trash.lastReport.premiseOrphans === 0 && trash.lastReport.recomputed === 0">
          <em>✅</em>未发现异常，数据一切正常
        </li>
      </ul>
    </section>

    <!-- 列表 -->
    <section class="sdb-sec">
      <span class="sdb-sec__tape"></span>
      <h3 class="sdb-sec__title">已删除 <small>共 {{ trash.count }} 条</small></h3>

      <div class="sdb-chips sdb-chips--filter">
        <button
          v-for="f in FILTERS"
          :key="f.value"
          type="button"
          class="sdb-chip sdb-chip--sm"
          :class="{ 'is-on': filterStore === f.value }"
          @click="filterStore = f.value"
        >
          {{ f.label }}
          <i v-if="f.value !== '' && trash.countByStore[f.value] > 0">
            {{ trash.countByStore[f.value] }}
          </i>
        </button>
      </div>

      <EmptyState v-if="visibleItems.length === 0" text="这里空空如也" hint="删除的内容会先放到回收站，可随时恢复" />

      <ul v-else class="sdb-list">
        <li v-for="it in visibleItems" :key="it.key" class="sdb-item">
          <span class="sdb-item__ico" aria-hidden="true">{{ it.icon }}</span>
          <div class="sdb-item__body">
            <div class="sdb-item__title">{{ it.title }}</div>
            <div class="sdb-item__meta">
              <span class="sdb-item__type">{{ it.typeLabel }}</span>
              <span class="sdb-item__dot">·</span>
              <span>{{ it.premiseName }}</span>
            </div>
            <div class="sdb-item__meta sdb-item__meta--sub">
              <span>删除于 {{ deletedAtLabel(it.deletedAt) }}</span>
              <span class="sdb-item__expire" :class="{ 'is-urgent': expireLabel(it.expiresInDays).urgent }">
                {{ expireLabel(it.expiresInDays).text }}
              </span>
            </div>
          </div>
          <div class="sdb-item__acts">
            <button class="sdb-act sdb-act--restore" type="button" :disabled="busy" @click="onRestore(it.key)">
              恢复
            </button>
            <button class="sdb-act sdb-act--danger" type="button" :disabled="busy" @click="onPurge(it.key, it.title)">
              删除
            </button>
          </div>
        </li>
      </ul>

      <van-button
        v-if="trash.count > 0"
        class="sdb-trash__clear"
        block
        plain
        type="danger"
        :disabled="busy"
        @click="onPurgeAll"
      >
        清空回收站（{{ trash.count }}）
      </van-button>
    </section>
  </div>
</template>

<style scoped>
/* 与设置页保持同一套便签卡语言：纸面 + 虚线分隔 + 手写数字 */
.sdb-trash__head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.sdb-trash__back {
  flex: none;
  width: 30px;
  height: 30px;
  margin-top: 2px;
  border: 1px solid var(--sdb-border);
  border-radius: 50%;
  background: var(--sdb-surface);
  color: var(--sdb-text-secondary);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  transition: border-color var(--sdb-dur-fast) var(--sdb-ease-out);
}
.sdb-trash__back:hover {
  border-color: var(--sdb-primary);
  color: var(--sdb-primary);
}
.sdb-trash__title {
  margin-bottom: 0;
}

.sdb-sec {
  position: relative;
  background: var(--sdb-surface);
  border: 1px solid var(--sdb-border);
  border-radius: var(--sdb-radius-lg);
  box-shadow: var(--sdb-shadow-sm);
  padding: 22px 14px 14px;
  margin-bottom: var(--sdb-space-3);
}
.sdb-sec__tape {
  position: absolute;
  top: -9px;
  left: 20px;
  width: 62px;
  height: 19px;
  border-radius: 2px;
  transform: rotate(-3deg);
  background: color-mix(in oklch, var(--sdb-accent) 62%, transparent);
  box-shadow: 0 1px 3px oklch(45% 0.1 45 / 0.18);
}
.sdb-sec__title {
  font-family: var(--sdb-font-hand);
  font-size: 20px;
  font-weight: 700;
  margin: 0 0 10px;
  color: var(--sdb-text);
  letter-spacing: 0.02em;
  display: flex;
  align-items: center;
  gap: 8px;
}
.sdb-sec__title small {
  font-family: var(--sdb-font-rounded);
  font-size: 11px;
  font-weight: 400;
  color: var(--sdb-text-tertiary);
  letter-spacing: 0;
}

/* 概览数字 */
.sdb-ov__stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}
.sdb-stat {
  text-align: center;
}
.sdb-stat__n {
  display: block;
  font-family: var(--sdb-font-hand);
  font-size: 24px;
  font-weight: 700;
  line-height: 1.1;
}
.sdb-stat__n--sm {
  font-size: 14px;
  padding-top: 5px;
}
.sdb-stat__n.is-urgent {
  color: var(--sdb-danger);
}
.sdb-stat__l {
  display: block;
  font-size: 10px;
  color: var(--sdb-text-tertiary);
  margin-top: 2px;
}
.sdb-trash__note {
  margin: 12px 2px 0;
  font-size: var(--sdb-text-xs);
  line-height: 1.7;
  color: var(--sdb-text-tertiary);
}
.sdb-trash__note--tight {
  margin-bottom: 12px;
}

/* 设置行 + 分段控件 */
.sdb-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  flex-wrap: wrap;
}
.sdb-field + .sdb-field {
  box-shadow: inset 0 1px 0 var(--sdb-border);
}
.sdb-field__l {
  font-size: var(--sdb-text-sm);
  color: var(--sdb-text);
}
.sdb-seg {
  display: flex;
  gap: 4px;
  padding: 4px;
  background: var(--sdb-surface-2);
  border-radius: var(--sdb-radius-pill);
}
.sdb-seg--inline {
  flex: 1 1 220px;
  max-width: 300px;
}
.sdb-seg__i {
  flex: 1;
  padding: 7px 4px;
  border: none;
  border-radius: var(--sdb-radius-pill);
  cursor: pointer;
  background: transparent;
  color: var(--sdb-text-secondary);
  font-family: inherit;
  font-size: var(--sdb-text-sm);
  white-space: nowrap;
  transition:
    background var(--sdb-dur-fast) var(--sdb-ease-out),
    color var(--sdb-dur-fast) var(--sdb-ease-out);
}
.sdb-seg__i.is-on {
  background: var(--sdb-surface);
  color: var(--sdb-text);
  font-weight: 600;
  box-shadow: var(--sdb-shadow-sm);
}

/* 清理回执 */
.sdb-sec--report .sdb-sec__tape {
  background: color-mix(in oklch, var(--sdb-success) 45%, transparent);
}
.sdb-report {
  list-style: none;
  margin: 0;
  padding: 0;
}
.sdb-report li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 7px 2px;
  font-size: var(--sdb-text-sm);
  line-height: 1.6;
  color: var(--sdb-text-secondary);
}
.sdb-report li + li {
  box-shadow: inset 0 1px 0 var(--sdb-border);
}
.sdb-report em {
  font-style: normal;
  flex: none;
}

/* 筛选 chips */
.sdb-chips--filter {
  margin: 0 0 10px;
}
.sdb-chip--sm {
  padding: 6px 12px;
  font-size: var(--sdb-text-xs);
  gap: 5px;
}
.sdb-chip--sm.is-on {
  border-color: var(--sdb-primary);
  color: var(--sdb-primary);
  font-weight: 600;
}
.sdb-chip--sm i {
  font-style: normal;
  font-family: var(--sdb-font-hand);
  font-size: 13px;
}

/* 条目列表 */
.sdb-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.sdb-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 2px;
}
.sdb-item + .sdb-item {
  box-shadow: inset 0 1px 0 var(--sdb-border);
}
.sdb-item__ico {
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  background: var(--sdb-surface-2);
  font-size: 15px;
}
.sdb-item__body {
  flex: 1;
  min-width: 0;
}
.sdb-item__title {
  font-size: var(--sdb-text-sm);
  color: var(--sdb-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sdb-item__meta {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 2px;
  font-size: 11px;
  color: var(--sdb-text-tertiary);
  flex-wrap: wrap;
}
.sdb-item__meta--sub {
  margin-top: 1px;
}
.sdb-item__type {
  padding: 1px 6px;
  border-radius: var(--sdb-radius-pill);
  background: var(--sdb-surface-2);
  color: var(--sdb-text-secondary);
}
.sdb-item__dot {
  opacity: 0.6;
}
.sdb-item__expire {
  margin-left: auto;
  color: var(--sdb-text-tertiary);
}
.sdb-item__expire.is-urgent {
  color: var(--sdb-danger);
}

/* 行内操作 */
.sdb-item__acts {
  flex: none;
  display: flex;
  gap: 6px;
}
.sdb-act {
  padding: 6px 10px;
  border-radius: var(--sdb-radius-pill);
  border: 1px solid var(--sdb-border);
  background: var(--sdb-surface);
  color: var(--sdb-text-secondary);
  font-family: inherit;
  font-size: var(--sdb-text-xs);
  cursor: pointer;
  transition:
    border-color var(--sdb-dur-fast) var(--sdb-ease-out),
    color var(--sdb-dur-fast) var(--sdb-ease-out);
}
.sdb-act:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.sdb-act--restore:hover:not(:disabled) {
  border-color: var(--sdb-primary);
  color: var(--sdb-primary);
}
.sdb-act--danger:hover:not(:disabled) {
  border-color: var(--sdb-danger);
  color: var(--sdb-danger);
}

.sdb-trash__clear {
  margin-top: var(--sdb-space-3);
}

/* 桌面：列表区与概览并排，减少长滚动 */
@media (min-width: 1024px) {
  .sdb-trash__overview {
    display: grid;
    grid-template-columns: 1fr;
  }
}
</style>

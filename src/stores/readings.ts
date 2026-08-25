/**
 * 读数 store（读数状态 + 用量计算 + 账单联动）
 * 写入读数后：重建该 (房源, 类型) 的读数链 → 批量写回 IndexedDB → 重算受影响月份账单。
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Reading, ReadingType } from '@/types';
import * as readingRepo from '@/db/repositories/readingRepo';
import { usePremisesStore } from './premises';
import { useBillsStore } from './bills';
import { genId } from '@/utils/id';
import { monthKeyFromDate } from '@/utils/dayjs';
import { findPreviousReading, relinkChain } from '@/utils/readingChain';
import { eventBus, EVENTS } from '@/utils/eventBus';
import { logger } from '@/utils/logger';
import { useUndo } from '@/composables/useUndo';

export type ReadingSortKey = 'date' | 'reading' | 'createdAt';

export type ReadingFilter = {
  premiseId?: string;
  type?: ReadingType;
  month?: string;
};

export type ReadingPayload = Omit<
  Reading,
  'id' | 'createdAt' | 'updatedAt' | 'syncVersion' | 'isDeleted' | 'previousReading'
>;

export const useReadingsStore = defineStore('readings', () => {
  const items = ref<Reading[]>([]);
  const loading = ref(false);
  const filter = ref<ReadingFilter>({});
  const sortBy = ref<ReadingSortKey>('date');
  const sortDesc = ref(true);

  /** 列表按 premiseId 过滤：显式 filter.premiseId 优先，否则回落当前房源 */
  const sortedReadings = computed<Reading[]>(() => {
    const pid = filter.value.premiseId || usePremisesStore().currentPremiseId || '';
    let result = items.value.filter(
      (r) => !r.isDeleted && (pid === '' || r.premiseId === pid),
    );
    if (filter.value.type) result = result.filter((r) => r.type === filter.value.type);
    if (filter.value.month)
      result = result.filter((r) => r.date.startsWith(filter.value.month as string));
    const dir = sortDesc.value ? -1 : 1;
    const key = sortBy.value;
    result = [...result].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return result;
  });

  /**
   * 取某房源某类型「最近一条」（供预览等只读场景）。
   * 注意：仅用于展示「上期读数」等只读预览，账单/用量计算一律走 readingChain 的按日期链路。
   */
  function latestByType(premiseId: string, type: ReadingType): Reading | undefined {
    return items.value
      .filter((r) => !r.isDeleted && r.premiseId === premiseId && r.type === type)
      .sort((a, b) =>
        a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1,
      )[0];
  }

  function usageOf(reading: Reading): number {
    return reading.previousReading != null ? reading.reading - reading.previousReading : 0;
  }

  async function load(): Promise<void> {
    loading.value = true;
    try {
      items.value = await readingRepo.getAllReadings();
    } catch (err) {
      logger.error('store:readings', '加载读数失败', {
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      loading.value = false;
    }
  }

  /**
   * 重算某 (房源, 类型) 的读数链：把 relinkChain 返回的变更记录批量写回 IndexedDB，
   * 并同步内存；随后重算受影响月份集合（extraMonths + 所有变更记录所在月份）。
   */
  async function relinkAndRecompute(
    premiseId: string,
    type: ReadingType,
    extraMonths: string[] = [],
  ): Promise<void> {
    const changed = relinkChain(items.value, premiseId, type);
    for (const rec of changed) {
      const updated: Reading = {
        ...rec,
        updatedAt: new Date().toISOString(),
        syncVersion: (rec.syncVersion ?? 0) + 1,
      };
      await readingRepo.putReading(updated);
      const mem = items.value.find((r) => r.id === updated.id);
      if (mem) Object.assign(mem, updated);
    }

    const months = new Set<string>(extraMonths);
    for (const rec of changed) {
      months.add(monthKeyFromDate(rec.date));
    }
    const bills = useBillsStore();
    for (const m of months) {
      await bills.recompute(premiseId, m);
    }
  }

  async function addReading(payload: ReadingPayload): Promise<Reading> {
    // A2：改用按日期严格早于的 findPreviousReading，而非 latestByType
    const prev = findPreviousReading(items.value, payload.premiseId, payload.type, payload.date);
    const now = new Date().toISOString();
    const reading: Reading = {
      ...payload,
      id: genId(),
      previousReading: prev ? prev.reading : null,
      createdAt: now,
      updatedAt: now,
      syncVersion: 1,
      isDeleted: false,
    };
    await readingRepo.putReading(reading);
    items.value.push(reading);
    eventBus.emit(EVENTS.READING_CHANGED, reading);

    // A3：插入可能改变后续记录的链，重算受影响月份
    await relinkAndRecompute(payload.premiseId, payload.type, [
      monthKeyFromDate(reading.date),
    ]);
    return reading;
  }

  async function updateReading(id: string, patch: Partial<Omit<Reading, 'id'>>): Promise<void> {
    const existing = items.value.find((r) => r.id === id);
    if (!existing) return;
    // 在写回内存前留存旧的链身份（房源 / 类型 / 日期）。
    // 说明：编辑表单（ReadingForm）已锁定 premiseId / type 不可改，正常 UI 路径不会触发链迁移；
    // 但本 store 是数据层，仍需对「读数被迁到另一条链」保持正确 —— 数据导入、WebDAV 同步合并
    // 等入口可能下发含 premiseId / type 的 patch，此时「旧链」与「新链」都必须重建。
    const oldDate = existing.date;
    const oldPremiseId = existing.premiseId;
    const oldType = existing.type;
    const updated: Reading = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
      syncVersion: existing.syncVersion + 1,
    };
    await readingRepo.putReading(updated);
    Object.assign(existing, updated);
    eventBus.emit(EVENTS.READING_CHANGED, updated);

    // 记录是否被迁移到了另一条链（换房源或换水电类型）
    const chainMoved = updated.premiseId !== oldPremiseId || updated.type !== oldType;
    // A3：patch 涉及 date / reading 会改变前驱后继；迁移链同样需要重建两侧
    const needsRelink = patch.date !== undefined || patch.reading !== undefined || chainMoved;
    if (needsRelink) {
      // 先修旧链：本条离开后，原链上它的后继需要重新挂到更早的一条上，
      // 且旧房源当月账单必须重算（否则残留已迁走读数产生的用量）。
      if (chainMoved) {
        await relinkAndRecompute(oldPremiseId, oldType, [monthKeyFromDate(oldDate)]);
      }
      // 再修新链：覆盖旧日期与新日期所在月份（跨月编辑时旧月份账单同样要刷新）。
      const extra = new Set<string>([monthKeyFromDate(oldDate), monthKeyFromDate(updated.date)]);
      await relinkAndRecompute(updated.premiseId, updated.type, [...extra]);
    } else {
      await useBillsStore().recompute(updated.premiseId, monthKeyFromDate(updated.date));
    }
  }

  async function removeReading(id: string): Promise<void> {
    const existing = items.value.find((r) => r.id === id);
    if (!existing) return;
    // 捕获删除前的真实记录，供撤销时完整恢复（含 previousReading 等）
    const original: Reading = { ...existing };
    const oldDate = existing.date;
    const tombstone: Reading = {
      ...existing,
      isDeleted: true,
      updatedAt: new Date().toISOString(),
      syncVersion: existing.syncVersion + 1,
    };
    await readingRepo.putReading(tombstone);
    Object.assign(existing, tombstone);
    eventBus.emit(EVENTS.READING_CHANGED, tombstone);

    // A3：删除后其后继的前驱改变，重算受影响月份
    await relinkAndRecompute(existing.premiseId, existing.type, [
      monthKeyFromDate(oldDate),
    ]);

    // 体验⑫：提供 5 秒撤销，恢复该读数并重建链路
    const undo = useUndo();
    undo.offer('已删除读数', async () => {
      const restored: Reading = {
        ...original,
        isDeleted: false,
        updatedAt: new Date().toISOString(),
        syncVersion: existing.syncVersion + 1, // existing 已被置为墓碑，+1 保证严格更新
      };
      await readingRepo.putReading(restored);
      const mem = items.value.find((r) => r.id === id);
      if (mem) Object.assign(mem, restored);
      eventBus.emit(EVENTS.READING_CHANGED, restored);
      await relinkAndRecompute(restored.premiseId, restored.type, [
        monthKeyFromDate(restored.date),
      ]);
    });
  }

  function setFilter(patch: Partial<ReadingFilter>): void {
    filter.value = { ...filter.value, ...patch };
  }

  function setSort(key: ReadingSortKey, desc = true): void {
    sortBy.value = key;
    sortDesc.value = desc;
  }

  return {
    items,
    loading,
    filter,
    sortBy,
    sortDesc,
    sortedReadings,
    latestByType,
    usageOf,
    load,
    addReading,
    updateReading,
    removeReading,
    setFilter,
    setSort,
  };
});

/**
 * 房源 store（D1：多房源支持，首次启动预置「我的家」）
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Premise } from '@/types';
import * as premiseRepo from '@/db/repositories/premiseRepo';
import { genId, HOME_PREMISE_ID } from '@/utils/id';
import { logger } from '@/utils/logger';
import { eventBus, EVENTS } from '@/utils/eventBus';
import { usePricesStore } from './prices';
import { useBudgetsStore } from './budgets';
import { useUndo } from '@/composables/useUndo';

export const usePremisesStore = defineStore('premises', () => {
  const items = ref<Premise[]>([]);
  const currentPremiseId = ref<string>('');
  const loaded = ref(false);

  const list = computed(() => items.value.filter((p) => !p.isDeleted));
  const currentPremise = computed(
    () => list.value.find((p) => p.id === currentPremiseId.value) ?? list.value[0],
  );

  async function load(): Promise<void> {
    try {
      items.value = await premiseRepo.getAllPremises();
      if (!currentPremiseId.value && list.value.length > 0) {
        currentPremiseId.value = list.value[0].id;
      }
      loaded.value = true;
    } catch (err) {
      logger.error('store:premises', '加载房源失败', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function addPremise(name: string, note?: string, id?: string): Promise<Premise> {
    const now = new Date().toISOString();
    const premise: Premise = {
      // 显式传 id 时（如种子「我的家」用固定 HOME_PREMISE_ID）沿用；否则随机生成。
      // 固定种子 id 是跨端价格/预算/读数正确合并的前提（见 utils/id.ts HOME_PREMISE_ID 注释）。
      id: id ?? genId(),
      name,
      note,
      createdAt: now,
      updatedAt: now,
      syncVersion: 1,
      isDeleted: false,
    };
    await premiseRepo.putPremise(premise);
    items.value.push(premise);
    if (!currentPremiseId.value) currentPremiseId.value = premise.id;
    // 新增房源必须推送：否则对端永远看不到这套房子（自动同步只监听本事件）。
    eventBus.emit(EVENTS.PREMISE_CHANGED, { id: premise.id });
    // A4(c)：新房源写入默认单价（D2），保证单价面板/账单可用
    try {
      await usePricesStore().ensureDefault(premise.id);
    } catch (err) {
      logger.error('store:premises', '新房源写入默认单价失败', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return premise;
  }

  async function updatePremise(id: string, patch: Partial<Omit<Premise, 'id'>>): Promise<void> {
    const existing = items.value.find((p) => p.id === id);
    if (!existing) return;
    const updated: Premise = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
      syncVersion: existing.syncVersion + 1,
    };
    await premiseRepo.putPremise(updated);
    Object.assign(existing, updated);
    eventBus.emit(EVENTS.PREMISE_CHANGED, { id });
  }

  async function removePremise(id: string): Promise<void> {
    const existing = items.value.find((p) => p.id === id);
    if (!existing) return;
    // 捕获删除前的真实记录，供撤销时完整恢复
    const original: Premise = { ...existing };
    const now = new Date().toISOString();
    const tombstone: Premise = {
      ...existing,
      isDeleted: true,
      updatedAt: now,
      syncVersion: existing.syncVersion + 1,
    };
    await premiseRepo.putPremise(tombstone);
    Object.assign(existing, tombstone);
    if (currentPremiseId.value === id && list.value.length > 0) {
      currentPremiseId.value = list.value[0].id;
    }
    eventBus.emit(EVENTS.PREMISE_CHANGED, { id });

    // 级联清理该房源的「按房源配置」（单价 / 预算），软删墓碑随同步传播。
    // 不清理的话这两条记录会作为孤儿数据永久留在本地与远端快照里，且无任何 UI 可再删除。
    // 读数与账单**不**清理——它们是用户真正的数据，删除房源只影响显示过滤。
    try {
      await usePricesStore().removePriceForPremise(existing);
      await useBudgetsStore().removeBudgetForPremise(id);
    } catch (err) {
      logger.error('store:premises', '清理房源关联配置失败', {
        message: err instanceof Error ? err.message : String(err),
      });
    }

    // 体验⑫：提供 5 秒撤销，恢复该房源并切回当前房源
    const undo = useUndo();
    undo.offer('已删除房源', async () => {
      const restored: Premise = {
        ...original,
        isDeleted: false,
        updatedAt: new Date().toISOString(),
        syncVersion: existing.syncVersion + 1,
      };
      await premiseRepo.putPremise(restored);
      const mem = items.value.find((p) => p.id === id);
      if (mem) Object.assign(mem, restored);
      if (currentPremiseId.value !== id) currentPremiseId.value = id;
      eventBus.emit(EVENTS.PREMISE_CHANGED, { id });
      // 恢复删除时级联软删的单价 / 预算，保证撤销是「完整还原」而非只还原半个房源。
      // 失败仅记录日志：房源本身已恢复，不因配置回滚失败而打断撤销。
      try {
        await usePricesStore().restorePriceForPremise(id);
        await useBudgetsStore().restoreBudgetForPremise(id);
      } catch (err) {
        logger.error('store:premises', '撤销时恢复房源配置失败', {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  /** 首次启动若没有任何房源，预置「我的家」（固定 id，保证跨端同源合并） */
  async function seedIfEmpty(): Promise<void> {
    if (list.value.length === 0) {
      await addPremise('我的家', undefined, HOME_PREMISE_ID);
    }
    if (!currentPremiseId.value && list.value.length > 0) {
      currentPremiseId.value = list.value[0].id;
    }
  }

  function setCurrent(premiseId: string): void {
    currentPremiseId.value = premiseId;
  }

  return {
    items,
    currentPremiseId,
    loaded,
    list,
    currentPremise,
    load,
    addPremise,
    updatePremise,
    removePremise,
    seedIfEmpty,
    setCurrent,
  };
});

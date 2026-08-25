/**
 * 房源 store（D1：多房源支持，首次启动预置「我的家」）
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Premise } from '@/types';
import * as premiseRepo from '@/db/repositories/premiseRepo';
import { genId } from '@/utils/id';
import { logger } from '@/utils/logger';
import { usePricesStore } from './prices';
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

  async function addPremise(name: string, note?: string): Promise<Premise> {
    const now = new Date().toISOString();
    const premise: Premise = {
      id: genId(),
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
    });
  }

  /** 首次启动若没有任何房源，预置「我的家」 */
  async function seedIfEmpty(): Promise<void> {
    if (list.value.length === 0) {
      await addPremise('我的家');
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

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
import { useBillsStore } from './bills';
import { defaultPremiseSettlement } from '@/utils/pricing';
import { useUndo } from '@/composables/useUndo';

/**
 * 计费口径指纹：只包含**影响账单金额**的房源字段（结算模式 / 计入账单的房租）。
 * 改名、改备注不进指纹，避免无谓地重算全部历史账单。
 * 缺省值与 applySettlement 的兜底保持一致（全额结算 / 无房租），
 * 这样 0.1.0 老房源在首次补齐字段时不会被误判为「金额有变」。
 */
/** 新增房源时可一并指定的计费配置（结算模式 / 房租），省掉「先建后改」的第二次写库与第二次同步事件 */
export type PremiseBillingInit = Pick<Premise, 'settlement' | 'rent' | 'rentVisible'>;

function billingFingerprint(p: Premise): string {
  const s = p.settlement;
  return JSON.stringify([
    s?.electricity.mode ?? 'full',
    s?.electricity.rounding ?? 'round',
    s?.water.mode ?? 'full',
    s?.water.rounding ?? 'round',
    p.rentVisible === true ? Number(p.rent) || 0 : 0,
  ]);
}

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

  async function addPremise(
    name: string,
    note?: string,
    id?: string,
    billing?: Partial<PremiseBillingInit>,
  ): Promise<Premise> {
    const now = new Date().toISOString();
    const premise: Premise = {
      // 显式传 id 时（如种子「我的家」用固定 HOME_PREMISE_ID）沿用；否则随机生成。
      // 固定种子 id 是跨端价格/预算/读数正确合并的前提（见 utils/id.ts HOME_PREMISE_ID 注释）。
      id: id ?? genId(),
      name,
      note,
      // 0.1.1：新房源显式落一份计费配置，让设置面板打开即有确定值，不必依赖读取端兜底。
      // 调用方（房源表单）可直接带入用户填的结算模式与房租；未传则用「全额结算 / 无房租」默认。
      settlement: billing?.settlement ?? defaultPremiseSettlement(),
      rent: billing?.rent ?? 0,
      rentVisible: billing?.rentVisible ?? false,
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
    // 改动前的计费口径快照（Object.assign 之后 existing 就被覆盖了，必须先取）
    const beforeBilling = billingFingerprint(existing);
    const updated: Premise = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
      syncVersion: existing.syncVersion + 1,
    };
    await premiseRepo.putPremise(updated);
    Object.assign(existing, updated);
    eventBus.emit(EVENTS.PREMISE_CHANGED, { id });

    // 结算模式或房租变了 → 该房源**所有**历史月份的金额都要跟着变。
    // 放在 store 而不是 UI 里判断：任何入口（设置面板、导入、脚本）改配置都不会漏算。
    // recomputePremise 幂等，金额没变的月份不写库、不发事件。
    if (billingFingerprint(updated) !== beforeBilling) {
      try {
        await useBillsStore().recomputePremise(id);
      } catch (err) {
        logger.error('store:premises', '房源计费配置变更后重算账单失败', {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
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
    // 删除房源是「不可逆意图」：立即同步，避免云端长期停留旧数据，
    // 也避免对端在删除未传播期间改动该房源（updatedAt 更新）导致 LWW 下删除意图被推翻。
    eventBus.emit(EVENTS.SYNC_REQUESTED);

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

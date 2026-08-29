/**
 * 单价 store（D2：按房源独立存储于 prices store）
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { PriceConfig, PriceRecord, Premise } from '@/types';
import * as priceRepo from '@/db/repositories/priceRepo';
import { defaultPriceConfig } from '@/utils/pricing';
import { eventBus, EVENTS } from '@/utils/eventBus';
import { logger } from '@/utils/logger';

export const usePricesStore = defineStore('prices', () => {
  const records = ref<Record<string, PriceConfig>>({});

  async function load(): Promise<void> {
    try {
      const all = await priceRepo.getAllPrices();
      const map: Record<string, PriceConfig> = {};
      for (const r of all) {
        if (!r.isDeleted) map[r.premiseId] = r.config;
      }
      records.value = map;
    } catch (err) {
      logger.error('store:prices', '加载单价失败', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** 同步读取某房源单价（缺失返回默认），不触发持久化 */
  function getPrice(premiseId: string): PriceConfig {
    return records.value[premiseId] ?? defaultPriceConfig();
  }

  /** 确保房源有单价记录（无则写入默认） */
  async function ensureDefault(premiseId: string): Promise<void> {
    if (records.value[premiseId]) return;
    const now = new Date().toISOString();
    const record: PriceRecord = {
      premiseId,
      config: defaultPriceConfig(),
      updatedAt: now,
      syncVersion: 1,
      isDeleted: false,
    };
    await priceRepo.putPrice(record);
    records.value[premiseId] = record.config;
  }

  async function setPrice(premiseId: string, config: PriceConfig): Promise<void> {
    const existing = await priceRepo.getPriceRecord(premiseId);
    const now = new Date().toISOString();
    const record: PriceRecord = {
      premiseId,
      config,
      updatedAt: now,
      syncVersion: (existing?.syncVersion ?? 0) + 1,
      isDeleted: false,
    };
    await priceRepo.putPrice(record);
    records.value[premiseId] = config;
    // 通知自动同步推送：单价本身不产生账单事件，若不发此事件，
    // 「改了单价但当月账单金额恰好不变」时改动会一直滞留本地。
    eventBus.emit(EVENTS.PRICE_CHANGED, { premiseId });
  }

  /** 房源删除时清理单价（软删） */
  async function removePriceForPremise(p: Premise): Promise<void> {
    const existing = await priceRepo.getPriceRecord(p.id);
    if (!existing) return;
    const tombstone: PriceRecord = {
      ...existing,
      isDeleted: true,
      updatedAt: new Date().toISOString(),
      syncVersion: existing.syncVersion + 1,
    };
    await priceRepo.putPrice(tombstone);
    delete records.value[p.id];
    eventBus.emit(EVENTS.PRICE_CHANGED, { premiseId: p.id });
  }

  /**
   * 撤销删除房源时恢复其单价配置（removePriceForPremise 的逆操作）。
   * 仅在存在墓碑记录时生效；恢复后 syncVersion +1 保证这次恢复能推到对端。
   */
  async function restorePriceForPremise(premiseId: string): Promise<void> {
    const existing = await priceRepo.getPriceRecord(premiseId);
    if (!existing || !existing.isDeleted) return;
    const restored: PriceRecord = {
      ...existing,
      isDeleted: false,
      updatedAt: new Date().toISOString(),
      syncVersion: existing.syncVersion + 1,
    };
    await priceRepo.putPrice(restored);
    records.value[premiseId] = restored.config;
    eventBus.emit(EVENTS.PRICE_CHANGED, { premiseId });
  }

  return {
    records,
    load,
    getPrice,
    ensureDefault,
    setPrice,
    removePriceForPremise,
    restorePriceForPremise,
  };
});

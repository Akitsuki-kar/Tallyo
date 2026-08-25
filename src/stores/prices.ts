/**
 * 单价 store（D2：按房源独立存储于 prices store）
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { PriceConfig, PriceRecord, Premise } from '@/types';
import * as priceRepo from '@/db/repositories/priceRepo';
import { defaultPriceConfig } from '@/utils/pricing';
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
  }

  return { records, load, getPrice, ensureDefault, setPrice, removePriceForPremise };
});

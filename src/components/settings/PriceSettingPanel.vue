<script setup lang="ts">
// 单价设置面板（D2：按房源存于 prices store）
// 支持「固定单价 / 阶梯计价」切换；保存后自动重算当前房源相关月份账单。
import { computed, ref } from 'vue';
import { showSuccessToast, showFailToast } from 'vant';
import type { PriceConfig, PriceMode, ReadingType } from '@/types';
import { usePricesStore } from '@/stores/prices';
import { usePremisesStore } from '@/stores/premises';
import { useReadingsStore } from '@/stores/readings';
import { useBillsStore } from '@/stores/bills';
import { monthKeyFromDate } from '@/utils/dayjs';
import { logger } from '@/utils/logger';

const prices = usePricesStore();
const premises = usePremisesStore();
const readings = useReadingsStore();
const bills = useBillsStore();

const show = ref(false);
const saving = ref(false);
const draft = ref<PriceConfig>(prices.getPrice(premises.currentPremiseId));
const emit = defineEmits<{ (e: 'saved'): void }>();

const tierTypes: ReadingType[] = ['electricity', 'water'];

function clone(c: PriceConfig): PriceConfig {
  return JSON.parse(JSON.stringify(c)) as PriceConfig;
}

function open(): void {
  draft.value = clone(prices.getPrice(premises.currentPremiseId));
  show.value = true;
}
function close(): void {
  show.value = false;
}
defineExpose({ open, close });

// 计费模式（flat / tiered）
const mode = computed<PriceMode>({
  get: () => draft.value.mode,
  set: (v) => {
    draft.value.mode = v;
  },
});

function toNum(v: string | number): number {
  const s = typeof v === 'string' ? v : String(v);
  return s === '' ? 0 : Number(s);
}

// 固定单价
function onFlatElec(v: string | number): void {
  draft.value.flat.electricity = toNum(v);
}
function onFlatWater(v: string | number): void {
  draft.value.flat.water = toNum(v);
}

// 阶梯档位
function addTier(type: ReadingType): void {
  draft.value.tiers[type].push({ upTo: null, price: 0 });
}
function removeTier(type: ReadingType, index: number): void {
  draft.value.tiers[type].splice(index, 1);
}
function onUpToInput(type: ReadingType, index: number, raw: string): void {
  draft.value.tiers[type][index].upTo = raw === '' ? null : Number(raw);
}
function onPriceInput(type: ReadingType, index: number, raw: string): void {
  draft.value.tiers[type][index].price = toNum(raw);
}

function validatePrice(): boolean {
  if (draft.value.mode === 'flat') {
    return Number.isFinite(draft.value.flat.electricity) && Number.isFinite(draft.value.flat.water);
  }
  for (const t of tierTypes) {
    for (const tier of draft.value.tiers[t]) {
      if (!Number.isFinite(tier.price)) return false;
    }
  }
  return true;
}

async function onSave(): Promise<void> {
  if (!validatePrice()) {
    showFailToast('请填写有效的单价');
    return;
  }
  saving.value = true;
  try {
    await prices.setPrice(premises.currentPremiseId, clone(draft.value));
    // 重算当前房源相关月份账单（性能：仅本房源）
    const months = new Set<string>();
    for (const r of readings.items) {
      if (!r.isDeleted && r.premiseId === premises.currentPremiseId) {
        months.add(monthKeyFromDate(r.date));
      }
    }
    for (const m of months) {
      await bills.recompute(premises.currentPremiseId, m);
    }
    showSuccessToast('单价已保存');
    emit('saved');
    close();
  } catch (err) {
    logger.error('readings:price', '保存单价失败', {
      message: err instanceof Error ? err.message : String(err),
    });
    showFailToast('保存失败，请重试');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <van-popup v-model:show="show" position="bottom" round :style="{ maxHeight: '92%' }">
    <div class="price-panel">
      <div class="price-panel__header">
        <span>单价设置</span>
        <van-icon name="cross" class="price-panel__close" aria-label="关闭" @click="close" />
      </div>

      <div class="price-panel__body">
        <!-- 计费模式 -->
        <van-radio-group v-model="mode" direction="horizontal" class="price-panel__mode">
          <van-radio name="flat">固定单价</van-radio>
          <van-radio name="tiered">阶梯计价</van-radio>
        </van-radio-group>

        <!-- 固定单价 -->
        <van-cell-group v-if="draft.mode === 'flat'" inset>
          <van-field
            label="电费单价"
            type="number"
            :model-value="String(draft.flat.electricity)"
            aria-label="电费单价"
            @update:model-value="onFlatElec"
          >
            <template #right-icon><span class="unit">元/度</span></template>
          </van-field>
          <van-field
            label="水费单价"
            type="number"
            :model-value="String(draft.flat.water)"
            aria-label="水费单价"
            @update:model-value="onFlatWater"
          >
            <template #right-icon><span class="unit">元/吨</span></template>
          </van-field>
        </van-cell-group>

        <!-- 阶梯计价 -->
        <template v-else>
          <div v-for="t in tierTypes" :key="t" class="tier-group">
            <div class="tier-group__title">{{ t === 'electricity' ? '电 · 阶梯' : '水 · 阶梯' }}</div>
            <div v-for="(tier, i) in draft.tiers[t]" :key="i" class="tier-row">
              <van-field
                class="tier-row__up"
                label="≤"
                type="number"
                :model-value="tier.upTo === null ? '' : String(tier.upTo)"
                :placeholder="i === draft.tiers[t].length - 1 ? '及以上' : '用量'"
                aria-label="档位上限用量"
                @update:model-value="(v: string | number) => onUpToInput(t, i, String(v))"
              />
              <van-field
                class="tier-row__price"
                label="单价"
                type="number"
                :model-value="String(tier.price)"
                aria-label="档位单价"
                @update:model-value="(v: string | number) => onPriceInput(t, i, String(v))"
              />
              <van-icon
                name="delete-o"
                class="tier-row__del"
                aria-label="删除档位"
                @click="removeTier(t, i)"
              />
            </div>
            <van-button size="small" plain type="primary" @click="addTier(t)">+ 添加档位</van-button>
          </div>
        </template>
      </div>

      <div class="price-panel__footer">
        <van-button block round type="primary" :loading="saving" @click="onSave">保存</van-button>
      </div>
    </div>
  </van-popup>
</template>

<style scoped>
.price-panel {
  display: flex;
  flex-direction: column;
  max-height: 92vh;
  background: var(--sdb-bg);
}
.price-panel__header {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  background: var(--sdb-surface);
  border-bottom: 1px solid var(--sdb-surface-2);
  font-size: 16px;
  font-weight: 600;
  color: var(--sdb-text);
}
.price-panel__close {
  font-size: 20px;
  color: var(--sdb-text-secondary);
}
.price-panel__body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 0;
}
.price-panel__mode {
  padding: 0 16px 8px;
}
.price-panel__footer {
  padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
  background: var(--sdb-surface);
  border-top: 1px solid var(--sdb-surface-2);
}
.unit {
  color: var(--sdb-text-secondary);
  font-size: 13px;
}
.tier-group {
  padding: 8px 16px 4px;
}
.tier-group__title {
  font-weight: 600;
  color: var(--sdb-text);
  margin-bottom: 6px;
}
.tier-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tier-row__up {
  flex: 1;
}
.tier-row__price {
  flex: 1;
}
.tier-row__del {
  font-size: 18px;
  color: var(--sdb-danger);
  cursor: pointer;
}
@media (min-width: 768px) {
  .price-panel {
    max-width: 560px;
    margin: 0 auto;
  }
}
</style>

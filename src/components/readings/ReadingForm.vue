<script setup lang="ts">
// 读数录入表单（新增 / 编辑 共用）
// - 字段：房源(Picker)、类型(电/水)、本次读数、日期、备注
// - 上期读数自动带入展示（由 readings store 计算 previousReading），用户不可改
// - 编辑模式 prefill 并调用 updateReading；新增调用 addReading
// - 纯函数校验；提交后 Toast 提示并 emit 'saved'
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { showSuccessToast, showFailToast } from 'vant';
import type { Reading, ReadingType } from '@/types';
import { useReadingsStore } from '@/stores/readings';
import { usePremisesStore } from '@/stores/premises';
import { dateKey } from '@/utils/dayjs';
import { formatNumber } from '@/utils/format';
import { logger } from '@/utils/logger';
import { findPreviousReading } from '@/utils/readingChain';

const props = withDefaults(
  defineProps<{
    /** 传入则为编辑模式 */
    editReading?: Reading | null;
    /** 极简模式（快速记录）：隐藏房源与备注 */
    compact?: boolean;
  }>(),
  { editReading: null, compact: false },
);

const emit = defineEmits<{ (e: 'saved'): void; (e: 'cancel'): void }>();

const readings = useReadingsStore();
const premises = usePremisesStore();

interface FormState {
  premiseId: string;
  type: ReadingType;
  reading: number | null;
  date: string;
  note: string;
}

const form = reactive<FormState>({
  premiseId: '',
  type: 'electricity',
  reading: null,
  date: dateKey(),
  note: '',
});

const submitting = ref(false);
const showDatePicker = ref(false);
const dateParts = ref<string[]>([]);
const showPremiseSheet = ref(false);

/** 编辑模式标记：编辑时锁定房源与类型（录错归属应删除后重录，避免读数在链间迁移） */
const isEdit = computed(() => props.editReading !== null);

// 上期读数预览（自动带入，只读）
// - 编辑模式：直接展示该条记录已持久化的 previousReading，与库中真实值一致
// - 新增模式：用与 store 同一套纯函数 findPreviousReading 按「当前表单日期」定位前驱，
//   保证预览值与提交后 store 实际写入的 previousReading 完全一致（补录早期读数时尤为重要）
const prevReadingPreview = computed<number | null>(() => {
  if (props.editReading) return props.editReading.previousReading;
  if (!form.premiseId || !form.date) return null;
  const prev = findPreviousReading(readings.items, form.premiseId, form.type, form.date);
  return prev ? prev.reading : null;
});

const currentPremiseName = computed(() => {
  const p = premises.list.find((x) => x.id === form.premiseId);
  return p ? p.name : '请选择房源';
});

// 读数单位（随类型变化）
const unitLabel = computed(() => (form.type === 'electricity' ? '度' : '吨'));

// 类型中文名（编辑模式只读展示用）
const typeLabel = computed(() => (form.type === 'electricity' ? '电' : '水'));

function initForm(): void {
  if (props.editReading) {
    const r = props.editReading;
    form.premiseId = r.premiseId;
    form.type = r.type;
    form.reading = r.reading;
    form.date = r.date;
    form.note = r.note ?? '';
  } else {
    // 新增：默认房源取当前房源（保底取首个）
    form.premiseId = premises.currentPremiseId || premises.list[0]?.id || '';
    form.type = 'electricity';
    form.reading = null;
    form.date = dateKey();
    form.note = '';
  }
}

onMounted(initForm);
watch(() => props.editReading, initForm);

// ---------- 日期选择 ----------
const minDate = new Date(2000, 0, 1);
const maxDate = new Date(2035, 11, 31);

function openDatePicker(): void {
  dateParts.value = form.date ? form.date.split('-') : dateKey().split('-');
  showDatePicker.value = true;
}
function onDateConfirm(): void {
  const [y, m, d] = dateParts.value;
  form.date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  showDatePicker.value = false;
}

// ---------- 房源选择 ----------
function openPremiseSheet(): void {
  // 极简模式不显示房源；编辑模式锁定房源不可改
  if (props.compact || isEdit.value) return;
  showPremiseSheet.value = true;
}
function selectPremise(id: string): void {
  form.premiseId = id;
  showPremiseSheet.value = false;
}

// ---------- 读数输入 ----------
function onReadingInput(v: string | number): void {
  const s = typeof v === 'string' ? v : String(v);
  form.reading = s === '' ? null : Number(s);
}

// ---------- 校验（纯函数风格） ----------
interface ValidationResult {
  ok: boolean;
  warn: string;
}
function validate(): ValidationResult {
  if (form.reading === null || Number.isNaN(form.reading) || form.reading < 0) {
    return { ok: false, warn: '读数必须为不小于 0 的数字' };
  }
  if (!form.date) return { ok: false, warn: '请选择读数日期' };
  // 编辑模式：若新读数小于上期，给出负用量警示（仍允许保存）
  if (props.editReading) {
    const prev = props.editReading.previousReading;
    if (prev != null && form.reading < prev) {
      return { ok: true, warn: '本次读数小于上期，用量将为负值' };
    }
  }
  return { ok: true, warn: '' };
}

async function onSubmit(): Promise<void> {
  const res = validate();
  if (!res.ok) {
    showFailToast(res.warn);
    return;
  }
  submitting.value = true;
  try {
    let billsChanged = -1; // -1 = 本次不走「账单是否变化」回执（新增模式）
    if (props.editReading) {
      // 编辑模式仅允许修改读数 / 日期 / 备注；
      // premiseId 与 type 已锁定（不下发 patch），读数不会在房源或水电链之间迁移
      const result = await readings.updateReading(props.editReading.id, {
        reading: form.reading as number,
        date: form.date,
        note: form.note ? form.note : undefined,
      });
      billsChanged = result.billsChanged;
    } else {
      await readings.addReading({
        premiseId: form.premiseId,
        type: form.type,
        reading: form.reading as number,
        date: form.date,
        note: form.note ? form.note : undefined,
      });
    }
    // 成功提示：可能的附加说明一并合成一条（Vant toast 为单例，多条会互相覆盖）
    const parts: string[] = [];
    if (res.warn) parts.push('用量为负，请核对');
    // 编辑后账单金额毫无变化，需要说明原因：账单按「月末读数 − 月初基准」的净额计费，
    // 改动月内中间那条抄表记录，在数学上不会改变任何一个月的净额。
    // 不给回执的话，用户只会以为「重算没触发」。
    if (billsChanged === 0) parts.push('该读数不影响月度账单金额');
    const suffix = parts.length > 0 ? `（${parts.join('；')}）` : '';
    showSuccessToast((props.editReading ? '已更新读数' : '已记录读数') + suffix);
    emit('saved');
  } catch (err) {
    logger.error('readings:form', '保存读数失败', {
      message: err instanceof Error ? err.message : String(err),
    });
    showFailToast('保存失败，请重试');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="reading-form">
    <van-cell-group inset>
      <!-- 房源（仅非极简模式显示）：编辑模式锁定为只读 -->
      <van-cell
        v-if="!props.compact && isEdit"
        title="房源"
        :value="currentPremiseName"
        label="归属已锁定，如需变更请删除后重新记录"
      />
      <van-field
        v-else-if="!props.compact"
        label="房源"
        :model-value="currentPremiseName"
        readonly
        is-link
        aria-label="选择房源"
        @click="openPremiseSheet"
      />

      <!-- 类型：编辑模式锁定为只读，避免读数在电/水两条链之间迁移 -->
      <van-cell
        v-if="isEdit"
        title="类型"
        :value="typeLabel"
        label="类型已锁定，如需变更请删除后重新记录"
      />
      <van-cell v-else title="类型" aria-label="读数类型">
        <template #value>
          <van-radio-group v-model="form.type" direction="horizontal">
            <van-radio name="electricity">电</van-radio>
            <van-radio name="water">水</van-radio>
          </van-radio-group>
        </template>
      </van-cell>

      <!-- 本次读数 -->
      <van-field
        label="本次读数"
        type="number"
        :model-value="form.reading === null ? '' : String(form.reading)"
        :right-icon="unitLabel"
        aria-label="本次读数"
        placeholder="请输入表盘读数"
        @update:model-value="onReadingInput"
      />

      <!-- 日期 -->
      <van-field
        label="日期"
        :model-value="form.date"
        readonly
        is-link
        aria-label="读数日期"
        @click="openDatePicker"
      />

      <!-- 备注（仅非极简模式） -->
      <van-field
        v-if="!props.compact"
        v-model="form.note"
        label="备注"
        type="textarea"
        rows="2"
        aria-label="备注"
        placeholder="可选备注"
      />

      <!-- 上期读数预览（自动带入，不可改） -->
      <van-cell title="上期读数" :label="props.compact ? '' : '自动带入，不可修改'">
        <template #value>
          <span class="reading-form__prev">
            {{ prevReadingPreview === null ? '无（首次记录）' : formatNumber(prevReadingPreview) }}
            {{ prevReadingPreview === null ? '' : unitLabel }}
          </span>
        </template>
      </van-cell>
    </van-cell-group>

    <!-- 底部操作 -->
    <div class="reading-form__footer">
      <van-button type="primary" block round :loading="submitting" @click="onSubmit">
        {{ props.editReading ? '保存修改' : '保存' }}
      </van-button>
    </div>

    <!-- 日期选择器 -->
    <van-popup v-model:show="showDatePicker" position="bottom" round>
      <div class="picker-pop">
        <div class="picker-pop__header">
          <span class="picker-pop__btn" @click="showDatePicker = false">取消</span>
          <span class="picker-pop__title">选择日期</span>
          <span class="picker-pop__btn picker-pop__btn--ok" @click="onDateConfirm">确定</span>
        </div>
        <!-- 已用自定义 header（取消/确定），关闭 Vant 自带工具栏，避免出现两套按钮 -->
        <van-date-picker v-model="dateParts" :min-date="minDate" :max-date="maxDate" :show-toolbar="false" />
      </div>
    </van-popup>

    <!-- 房源选择面板 -->
    <van-popup v-model:show="showPremiseSheet" position="bottom" round>
      <div class="sheet">
        <div class="sheet__title">选择房源</div>
        <van-cell
          v-for="p in premises.list"
          :key="p.id"
          :title="p.name"
          :value="p.id === form.premiseId ? '当前' : ''"
          clickable
          @click="selectPremise(p.id)"
        />
        <div class="sheet__foot">
          <van-button block @click="showPremiseSheet = false">取消</van-button>
        </div>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.reading-form {
  padding: 12px 0 16px;
}
.reading-form__prev {
  color: var(--sdb-text-secondary);
  font-weight: 600;
}
.reading-form__footer {
  padding: 16px 16px 4px;
}
/* 日期选择器 */
.picker-pop {
  background: var(--sdb-surface);
}
.picker-pop__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--sdb-surface-2);
}
.picker-pop__title {
  font-weight: 600;
  color: var(--sdb-text);
}
.picker-pop__btn {
  color: var(--sdb-text-secondary);
  cursor: pointer;
}
.picker-pop__btn--ok {
  color: var(--sdb-primary);
  font-weight: 600;
}
/* 房源选择面板 */
.sheet {
  padding: 8px 0 16px;
}
.sheet__title {
  padding: 12px 16px;
  font-weight: 600;
  color: var(--sdb-text);
}
.sheet__foot {
  padding: 8px 16px 0;
}
@media (min-width: 768px) {
  .picker-pop,
  .sheet {
    max-width: 560px;
    margin: 0 auto;
  }
}
</style>

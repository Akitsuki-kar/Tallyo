<script setup lang="ts">
/**
 * 沉浸式新手引导（卡片式分步向导）
 *
 * 设计原则（Impeccable onboard.md）：
 * - Show, don't tell：每一步都是真实功能（改房源名 / 存单价），不是演示模式
 * - 可跳过：右上角「跳过」随时退出，不阻断使用
 * - Time to value：3 步内完成基础设置，第 4 步讲清核心玩法
 *
 * 步骤：
 *  0 欢迎：价值主张（记读数 → 月底自动出账单）
 *  1 房源：给第一套房子起名（真实改名 premises store）
 *  2 单价：确认/修改水电单价（真实保存 prices store）
 *  3 玩法：三步核心用法说明 → 开始使用
 *
 * 完成/跳过均写入 sdb:onboarded 标记（useOnboarding）。
 */
import { computed, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { usePremisesStore } from '@/stores/premises';
import { usePricesStore } from '@/stores/prices';
import { logger } from '@/utils/logger';
import { completeOnboarding } from '@/composables/useOnboarding';

const emit = defineEmits<{
  (e: 'done', opts: { tour: boolean }): void; // tour=true 表示走完全程（结束后接交互式 Tour）
}>();

const premisesStore = usePremisesStore();
const pricesStore = usePricesStore();
const { list } = storeToRefs(premisesStore);

const STEP_COUNT = 4;
const step = ref(0);

// ---- 步骤 1：房源命名（回填首启预置的「我的家」） ----
const premiseName = ref('');

// ---- 步骤 2：单价确认（回填默认单价） ----
const elecPrice = ref('0.56');
const waterPrice = ref('3.5');

// ---- 步骤 3：核心玩法示意 ----
const usageSteps = [
  { icon: 'edit', title: '看表记一笔', text: '站在电表/水表前，把表上的数字记下来，几秒搞定。' },
  { icon: 'chart-trending-o', title: '自动算费用', text: '用量、费用实时算好，不用自己按计算器。' },
  { icon: 'bill-o', title: '月底看账单', text: '月度账单自动生成，还能设预算、看趋势。' },
];

onMounted(() => {
  // 回填当前房源名（首启预置「我的家」）；并确保单价已就绪（默认 0.56 / 3.5）
  premiseName.value = list.value[0]?.name ?? '我的家';
  const premiseId = list.value[0]?.id;
  if (premiseId) {
    const cfg = pricesStore.getPrice(premiseId);
    elecPrice.value = String(cfg.flat.electricity);
    waterPrice.value = String(cfg.flat.water);
  }
});

const isFirst = computed(() => step.value === 0);
const isLast = computed(() => step.value === STEP_COUNT - 1);
const primaryLabel = computed(() => {
  if (isFirst.value) return '开始设置';
  if (isLast.value) return '开始使用';
  return '下一步';
});

/** 当前步骤主按钮（每步都做真实持久化） */
async function onNext(): Promise<void> {
  try {
    if (step.value === 1) {
      // 真实改名：首启预置的「我的家」→ 用户起的名字
      const name = premiseName.value.trim();
      const p = list.value[0];
      if (p && name && name !== p.name) {
        await premisesStore.updatePremise(p.id, { name });
      }
    } else if (step.value === 2) {
      // 真实保存固定单价（非法输入静默保留默认值）
      const premiseId = list.value[0]?.id;
      const e = parseFloat(elecPrice.value);
      const w = parseFloat(waterPrice.value);
      if (premiseId && e > 0 && w > 0) {
        const cfg = pricesStore.getPrice(premiseId);
        await pricesStore.setPrice(premiseId, {
          ...cfg,
          mode: 'flat',
          flat: { electricity: e, water: w },
        });
      }
    }
  } catch (err) {
    // 引导中的写库失败不阻断流程（默认值兜底），仅记录日志
    logger.error('onboarding', '引导步骤保存失败', {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  if (isLast.value) {
    finish(true);
  } else {
    step.value += 1;
  }
}

/** 完成/跳过：写标记并通知父级（全程完成 → 后续接 Tour） */
function finish(tour: boolean): void {
  completeOnboarding();
  emit('done', { tour });
}
</script>

<template>
  <Transition name="onboard-fade">
    <div class="onboard" role="dialog" aria-label="新手引导">
      <!-- 装饰：纸面 + 两团暖色柔光，营造沉浸氛围 -->
      <div class="onboard__glow onboard__glow--a" aria-hidden="true" />
      <div class="onboard__glow onboard__glow--b" aria-hidden="true" />

      <!-- 跳过入口（全程可见，尊重用户选择） -->
      <button class="onboard__skip" type="button" @click="finish(false)">跳过</button>

      <!-- 内容容器：整体在视口内居中；仅在极端矮屏时内部滚动，避免页面出现滚动条 -->
      <div class="onboard__inner">
      <!-- 进度点 -->
      <div class="onboard__dots" aria-hidden="true">
        <span
          v-for="i in STEP_COUNT"
          :key="i"
          class="onboard__dot"
          :class="{ 'is-active': i - 1 === step, 'is-done': i - 1 < step }"
        />
      </div>

      <!-- 步骤卡片 -->
      <Transition name="onboard-step" mode="out-in">
        <!-- 0 欢迎 -->
        <section v-if="step === 0" key="welcome" class="onboard__card sdb-rise">
          <span class="onboard__logo" aria-hidden="true">水</span>
          <h1 class="onboard__hero">水电动账</h1>
          <p class="onboard__tagline">记水电表读数<br />月底自动出账单</p>
          <ul class="onboard__points">
            <li><van-icon name="checked" /> 表前记个数，几秒搞定</li>
            <li><van-icon name="checked" /> 用量费用自动算，不用计算器</li>
            <li><van-icon name="checked" /> 数据只存本地，离线可用</li>
          </ul>
        </section>

        <!-- 1 房源命名 -->
        <section v-else-if="step === 1" key="premise" class="onboard__card sdb-rise">
          <span class="onboard__step-no">1 / 3</span>
          <h2 class="onboard__title">给这套房子起个名字</h2>
          <p class="onboard__desc">多套房子也能分开记，比如「阳光公寓」「老家」。</p>
          <div class="onboard__control">
            <input
              v-model="premiseName"
              type="text"
              maxlength="20"
              placeholder="如：阳光公寓 A 栋"
              class="onboard__input"
              aria-label="房源名称"
            />
          </div>
        </section>

        <!-- 2 单价确认 -->
        <section v-else-if="step === 2" key="price" class="onboard__card sdb-rise">
          <span class="onboard__step-no">2 / 3</span>
          <h2 class="onboard__title">水电单价是多少？</h2>
          <p class="onboard__desc">先填个大概也行，之后随时能在设置里改（还支持阶梯价）。</p>
          <div class="onboard__price-rows">
            <div class="onboard__price-row">
              <span class="onboard__price-label">电费</span>
              <div class="onboard__control onboard__control--price">
                <input
                  v-model="elecPrice"
                  type="number"
                  inputmode="decimal"
                  min="0"
                  step="0.01"
                  class="onboard__input"
                  aria-label="电费单价"
                />
                <span class="onboard__unit">元/度</span>
              </div>
            </div>
            <div class="onboard__price-row">
              <span class="onboard__price-label">水费</span>
              <div class="onboard__control onboard__control--price">
                <input
                  v-model="waterPrice"
                  type="number"
                  inputmode="decimal"
                  min="0"
                  step="0.01"
                  class="onboard__input"
                  aria-label="水费单价"
                />
                <span class="onboard__unit">元/吨</span>
              </div>
            </div>
          </div>
        </section>

        <!-- 3 玩法说明 -->
        <section v-else key="usage" class="onboard__card sdb-rise">
          <span class="onboard__step-no">3 / 3</span>
          <h2 class="onboard__title">接下来就这么用</h2>
          <ol class="onboard__usage">
            <li v-for="(u, i) in usageSteps" :key="u.title" :style="{ '--sdb-stagger': i }" class="onboard__usage-item sdb-rise">
              <span class="onboard__usage-icon"><van-icon :name="u.icon" /></span>
              <div class="onboard__usage-text">
                <strong>{{ u.title }}</strong>
                <span>{{ u.text }}</span>
              </div>
            </li>
          </ol>
        </section>
      </Transition>

      <!-- 主按钮 -->
      <button class="sdb-btn sdb-btn--primary onboard__next" type="button" @click="onNext">
        {{ primaryLabel }}
      </button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* ---- 全屏沉浸层：纸面 + 暖色氛围光 ----
 * 浮层自身 overflow:hidden 且不撑开文档流；内容统一收进 .onboard__inner，
 * 由浮层 justify-content:center 在视口内整体居中。仅在极端矮屏、内容确实放不下时，
 * .onboard__inner 内部滚动（滚动条已隐藏），绝不产生「页面级」滚动条。 */
.onboard {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--sdb-space-5);
  background: var(--sdb-bg);
  background-image: var(--sdb-paper);
  overflow: hidden;
}
/* 内容容器：限制最大高度，必要时内部滚动（滚动条隐藏，避免干扰沉浸感） */
.onboard__inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sdb-space-5);
  width: 100%;
  max-width: 460px;
  max-height: 100%;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: none;          /* Firefox */
  -ms-overflow-style: none;       /* 旧 Edge */
}
.onboard__inner::-webkit-scrollbar {
  width: 0;
  height: 0;
}
.onboard__dots {
  flex: none;
}
.onboard__next {
  flex: none;
}
/* 矮视口（横屏手机/小窗）：压缩间距与卡片内边距，尽量避免滚动 */
@media (max-height: 720px) {
  .onboard {
    gap: var(--sdb-space-4);
    padding: var(--sdb-space-4);
  }
  .onboard__card {
    padding: var(--sdb-space-5) var(--sdb-space-4);
  }
  .onboard__logo {
    width: 60px;
    height: 60px;
    border-radius: 20px;
    font-size: 28px;
    margin-bottom: var(--sdb-space-3);
  }
  .onboard__points li {
    padding: 8px 12px;
  }
  .onboard__usage-item {
    padding: 10px 12px;
  }
  .onboard__next {
    min-width: 200px;
  }
}
/* 极矮屏（小窗/横屏手机）：进一步压缩，确保内容始终不出现滚动条 */
@media (max-height: 600px) {
  .onboard {
    gap: var(--sdb-space-3);
    padding: var(--sdb-space-3);
  }
  .onboard__inner {
    gap: var(--sdb-space-3);
  }
  .onboard__card {
    padding: var(--sdb-space-4);
  }
  .onboard__card::before {
    top: 10px;
    left: 18px;
    right: 18px;
  }
  .onboard__hero {
    font-size: var(--sdb-text-xl);
    margin-bottom: var(--sdb-space-1);
  }
  .onboard__tagline {
    margin-bottom: var(--sdb-space-3);
  }
  .onboard__points li {
    padding: 6px 12px;
  }
  .onboard__usage-icon {
    width: 38px;
    height: 38px;
    font-size: 18px;
  }
  .onboard__usage-item {
    padding: 8px 12px;
  }
}
.onboard__glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(70px);
  pointer-events: none;
}
.onboard__glow--a {
  width: 380px;
  height: 380px;
  top: -120px;
  right: -80px;
  background: oklch(from var(--sdb-primary) l c h / 0.16);
}
.onboard__glow--b {
  width: 320px;
  height: 320px;
  bottom: -100px;
  left: -60px;
  background: oklch(from var(--sdb-accent) l c h / 0.14);
}

/* ---- 跳过 / 进度点 ---- */
.onboard__skip {
  position: absolute;
  top: max(var(--sdb-space-4), env(safe-area-inset-top));
  right: var(--sdb-space-4);
  border: none;
  background: transparent;
  color: var(--sdb-text-tertiary);
  font-family: var(--sdb-font-rounded);
  font-size: var(--sdb-text-sm);
  padding: 8px 12px;
  border-radius: var(--sdb-radius-pill);
  cursor: pointer;
  transition: color var(--sdb-dur) var(--sdb-ease-out);
  z-index: 1;
}
.onboard__skip:hover {
  color: var(--sdb-text-secondary);
}

.onboard__dots {
  display: flex;
  gap: 8px;
  z-index: 1;
}
.onboard__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--sdb-border);
  transition:
    background-color var(--sdb-dur) var(--sdb-ease-out),
    transform var(--sdb-dur) var(--sdb-ease-out);
}
.onboard__dot.is-active {
  background: var(--sdb-primary);
  transform: scale(1.35);
}
.onboard__dot.is-done {
  background: var(--sdb-primary-light);
}

/* ---- 步骤卡片 ---- */
.onboard__card {
  position: relative;
  width: 100%;
  max-width: 460px;
  background: var(--sdb-surface);
  background-image: var(--sdb-paper);
  border: 1px solid var(--sdb-border);
  border-radius: var(--sdb-radius-lg);
  box-shadow: var(--sdb-shadow-lg);
  padding: var(--sdb-space-6) var(--sdb-space-5);
  text-align: center;
  z-index: 1;
}
.onboard__card::before {
  /* 手作细节：卡片顶部一段虚线缝线 */
  content: '';
  position: absolute;
  top: 14px;
  left: 24px;
  right: 24px;
  border-top: 2px dashed var(--sdb-border);
}

/* 欢迎页 hero */
.onboard__logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  border-radius: 24px;
  background: linear-gradient(135deg, var(--sdb-primary), var(--sdb-primary-dark));
  color: var(--sdb-on-primary);
  font-size: 34px;
  font-weight: 700;
  box-shadow: var(--sdb-shadow);
  margin-bottom: var(--sdb-space-4);
}
.onboard__hero {
  margin: 0 0 var(--sdb-space-2);
  font-size: var(--sdb-text-2xl);
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--sdb-text);
}
.onboard__tagline {
  margin: 0 0 var(--sdb-space-4);
  font-size: var(--sdb-text-lg);
  line-height: 1.7;
  color: var(--sdb-text-secondary);
}
.onboard__points {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  text-align: left;
}
.onboard__points li {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: var(--sdb-text-sm);
  color: var(--sdb-text);
  background: var(--sdb-surface-2);
  border-radius: var(--sdb-radius-sm);
  padding: 10px 14px;
}
.onboard__points .van-icon {
  color: var(--sdb-primary);
  font-size: 16px;
}

/* 设置步骤 */
.onboard__step-no {
  display: inline-block;
  font-size: var(--sdb-text-xs);
  font-weight: 700;
  color: var(--sdb-primary);
  background: oklch(from var(--sdb-primary) l c h / 0.12);
  border-radius: var(--sdb-radius-pill);
  padding: 3px 12px;
  margin-bottom: var(--sdb-space-3);
}
.onboard__title {
  margin: 0 0 var(--sdb-space-2);
  font-size: var(--sdb-text-xl);
  font-weight: 700;
  color: var(--sdb-text);
}
.onboard__desc {
  margin: 0 0 var(--sdb-space-4);
  font-size: var(--sdb-text-sm);
  line-height: 1.7;
  color: var(--sdb-text-secondary);
}

/* 输入控件 */
.onboard__control {
  display: flex;
  background: var(--sdb-surface-2);
  border: 1px solid var(--sdb-border);
  border-radius: var(--sdb-radius-sm);
  padding: 0 14px;
  transition:
    border-color var(--sdb-dur) var(--sdb-ease-out),
    box-shadow var(--sdb-dur) var(--sdb-ease-out);
}
.onboard__control:focus-within {
  border-color: var(--sdb-primary);
  box-shadow: 0 0 0 3px oklch(from var(--sdb-primary) l c h / 0.15);
}
.onboard__control--price {
  flex: 1;
  max-width: 200px;
}
.onboard__input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  font-family: var(--sdb-font-rounded);
  font-size: var(--sdb-text-lg);
  font-weight: 600;
  color: var(--sdb-text);
  padding: 12px 0;
  outline: none;
  font-variant-numeric: tabular-nums;
}
.onboard__input::placeholder {
  color: var(--sdb-text-tertiary);
  font-weight: 400;
}
.onboard__unit {
  display: inline-flex;
  align-items: center;
  font-size: var(--sdb-text-sm);
  color: var(--sdb-text-tertiary);
  white-space: nowrap;
}

/* 单价行 */
.onboard__price-rows {
  display: flex;
  flex-direction: column;
  gap: var(--sdb-space-3);
}
.onboard__price-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sdb-space-3);
}
.onboard__price-label {
  font-size: var(--sdb-text-base);
  font-weight: 600;
  color: var(--sdb-text);
}

/* 玩法步骤 */
.onboard__usage {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sdb-space-3);
  text-align: left;
}
.onboard__usage-item {
  display: flex;
  align-items: center;
  gap: var(--sdb-space-3);
  background: var(--sdb-surface-2);
  border-radius: var(--sdb-radius-sm);
  padding: 12px 14px;
}
.onboard__usage-icon {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 14px;
  background: linear-gradient(135deg, var(--sdb-primary), var(--sdb-primary-dark));
  color: var(--sdb-on-primary);
  font-size: 20px;
  box-shadow: var(--sdb-shadow-sm);
}
.onboard__usage-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.onboard__usage-text strong {
  font-size: var(--sdb-text-base);
  color: var(--sdb-text);
}
.onboard__usage-text span {
  font-size: var(--sdb-text-sm);
  color: var(--sdb-text-secondary);
  line-height: 1.5;
}

/* ---- 主按钮 ---- */
.onboard__next {
  min-width: 220px;
  z-index: 1;
}

/* ---- 过渡动效（仅 transform/opacity） ---- */
.onboard-fade-enter-active,
.onboard-fade-leave-active {
  transition: opacity var(--sdb-dur-slow) var(--sdb-ease-out);
}
.onboard-fade-enter-from,
.onboard-fade-leave-to {
  opacity: 0;
}
.onboard-step-enter-active,
.onboard-step-leave-active {
  transition:
    opacity var(--sdb-dur) var(--sdb-ease-out),
    transform var(--sdb-dur) var(--sdb-ease-out);
}
.onboard-step-enter-from {
  opacity: 0;
  transform: translateX(28px);
}
.onboard-step-leave-to {
  opacity: 0;
  transform: translateX(-28px);
}
@media (prefers-reduced-motion: reduce) {
  .onboard-step-enter-from,
  .onboard-step-leave-to {
    transform: none;
  }
}
</style>

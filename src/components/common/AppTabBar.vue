<script setup lang="ts">
// 主导航：移动端底部 Tab；≥768px 转为左侧固定栏（品牌区 + 导航 pill + 快捷记一笔）
// 桌面侧栏的「记一笔」通过 eventBus(QUICK_RECORD) 唤起全局快速记录弹窗（App.vue 持有 ref）。
import { useRoute } from 'vue-router';
import { eventBus, EVENTS } from '@/utils/eventBus';

const tabs = [
  { to: '/', label: '首页', icon: 'home-o' },
  { to: '/readings', label: '读数', icon: 'notes-o' },
  { to: '/bills', label: '账单', icon: 'bill-o' },
  { to: '/stats', label: '统计', icon: 'chart-trending-o' },
  { to: '/budget', label: '预算', icon: 'aim' },
  { to: '/settings', label: '设置', icon: 'setting-o' },
];

const route = useRoute();

/** 侧栏快捷按钮：广播事件，由 App.vue 打开全局快速记录弹窗 */
function onQuickRecord(): void {
  eventBus.emit(EVENTS.QUICK_RECORD);
}
</script>

<template>
  <nav class="sdb-tabbar" aria-label="主导航">
    <!-- 桌面侧栏品牌区（移动端隐藏）：圆角 logo 图 + 名称 + 副标题 -->
    <div class="sdb-tabbar__brand">
      <img src="/icons/pwa-192.png" alt="" aria-hidden="true" class="sdb-tabbar__logo" />
      <span class="sdb-tabbar__brand-text">
        <strong class="sdb-tabbar__name">水电动账</strong>
        <span class="sdb-tabbar__sub">Tallyo · 水电小账本</span>
      </span>
    </div>

    <div class="sdb-tabbar__items">
      <RouterLink
        v-for="t in tabs"
        :key="t.to"
        :to="t.to"
        class="sdb-tabbar__item"
        :class="{ 'is-active': route.path === t.to }"
      >
        <van-icon :name="t.icon" class="sdb-tabbar__icon" />
        <span class="sdb-tabbar__label">{{ t.label }}</span>
      </RouterLink>
    </div>

    <!-- 桌面侧栏底部：快捷记一笔（呼应移动端 FAB） -->
    <button class="sdb-tabbar__quick" type="button" @click="onQuickRecord">
      <van-icon name="edit" />
      <span>记一笔</span>
    </button>
  </nav>
</template>

<style scoped>
.sdb-tabbar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 20;
  display: flex;
  background: var(--sdb-surface);
  background-image: var(--sdb-paper);
  background-repeat: repeat;
  border-top: 1px solid var(--sdb-border);
  box-shadow: var(--sdb-shadow);
}
/* 移动端隐藏桌面专属区块（品牌区 / 快捷按钮） */
.sdb-tabbar__brand,
.sdb-tabbar__quick {
  display: none;
}
/* 移动端：导航项容器横向铺满底栏（flex:1 使各 Tab 平分宽度） */
.sdb-tabbar__items {
  display: flex;
  flex: 1;
  min-width: 0;
}
.sdb-tabbar__item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 8px 4px;
  min-height: 44px;
  color: var(--sdb-text-secondary);
  font-size: 11px;
  border-radius: var(--sdb-radius);
  transition:
    color var(--sdb-dur) var(--sdb-ease-out),
    background-color var(--sdb-dur) var(--sdb-ease-out);
}
.sdb-tabbar__item.is-active {
  color: var(--sdb-primary);
  /* 激活项：暖色 pill 指示 */
  background: var(--sdb-surface-2);
}
.sdb-tabbar__icon {
  font-size: 21px;
  line-height: 1;
}
.sdb-tabbar__item.is-active .sdb-tabbar__icon {
  transform: translateY(-1px);
}
@media (min-width: 768px) {
  .sdb-tabbar {
    flex-direction: column;
    top: 0;
    bottom: 0;
    left: 0;
    right: auto;
    width: var(--sdb-sidebar-w);
    padding: 20px 14px 16px;
    border-top: none;
    border-right: 1px solid var(--sdb-border);
    box-shadow: var(--sdb-shadow);
  }

  /* 品牌区：圆角 logo 图（与 App 图标一致，PNG 自带透明圆角）+ 名称/副标题 */
  .sdb-tabbar__brand {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 2px 8px 18px;
    border-bottom: 1px dashed var(--sdb-border);
    margin-bottom: 14px;
  }
  .sdb-tabbar__logo {
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    /* 图标本身已是圆角 PNG（18% 半径透明角），此圆角仅作浏览器兜底对齐 */
    border-radius: 12px;
    object-fit: cover;
    box-shadow: var(--sdb-shadow-sm);
  }
  .sdb-tabbar__brand-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .sdb-tabbar__name {
    font-size: 16px;
    font-weight: 700;
    color: var(--sdb-text);
    letter-spacing: 0.02em;
  }
  .sdb-tabbar__sub {
    font-size: 11px;
    color: var(--sdb-text-tertiary);
  }

  .sdb-tabbar__items {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1; /* 顶住快捷按钮到底部 */
  }
  .sdb-tabbar__item {
    flex: none;
    flex-direction: row;
    justify-content: flex-start;
    gap: 12px;
    padding: 13px 16px;
    font-size: 14px;
    border-radius: var(--sdb-radius-pill);
  }
  .sdb-tabbar__item:hover {
    color: var(--sdb-primary);
    background: var(--sdb-surface-2);
  }

  /* 快捷记一笔：暖色 pill 按钮，桌面常驻 */
  .sdb-tabbar__quick {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin-top: 12px;
    min-height: 44px;
    padding: 0 18px;
    border: none;
    border-radius: var(--sdb-radius-pill);
    background: var(--sdb-primary);
    color: var(--sdb-on-primary);
    font-family: var(--sdb-font-rounded);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: var(--sdb-shadow-sm);
    transition:
      transform var(--sdb-dur-fast) var(--sdb-ease-out-quart),
      box-shadow var(--sdb-dur) var(--sdb-ease-out),
      background-color var(--sdb-dur) var(--sdb-ease-out);
  }
  .sdb-tabbar__quick:hover {
    background: var(--sdb-primary-dark);
    transform: translateY(-1px);
    box-shadow: var(--sdb-shadow);
  }
  .sdb-tabbar__quick:active {
    transform: translateY(1px);
    box-shadow: var(--sdb-shadow-sm);
  }
}
</style>

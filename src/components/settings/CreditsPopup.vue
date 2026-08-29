<script setup lang="ts">
/**
 * 开源致谢弹层（鸣谢）
 *
 * 展示本项目依赖的开源软件清单（单一数据源 src/data/credits.ts），
 * 每项点击跳转项目主页（新窗口，rel=noopener）。
 * 严格手作美学 token + 深色主题自动适配（全部走 --sdb-* 变量）。
 */
import { creditGroups } from '@/data/credits';
import { openExternal } from '@/native/openExternal';

// v-model:show 由设置页控制显隐
const show = defineModel<boolean>('show', { default: false });

// 外链统一走 openExternal：原生壳调起系统浏览器，Web 回退新标签 + 复制链接兜底
function onOpen(url: string): void {
  void openExternal(url);
}
</script>

<template>
  <van-popup v-model:show="show" position="bottom" round class="sdb-credits-popup">
    <div class="sdb-credits-head">
      <h3 class="sdb-credits-title">开源致谢</h3>
      <p class="sdb-credits-sub">感谢这些开源项目，让水电动账成为可能 💛</p>
    </div>

    <div class="sdb-credits-body">
      <section v-for="group in creditGroups" :key="group.title" class="sdb-credits-group">
        <h4 class="sdb-credits-group-title">{{ group.title }}</h4>
        <button
          v-for="item in group.items"
          :key="item.name"
          type="button"
          class="sdb-credit-item"
          @click="onOpen(item.url)"
        >
          <span class="sdb-credit-main">
            <span class="sdb-credit-name">{{ item.name }}</span>
            <span class="sdb-credit-desc">{{ item.desc }}</span>
          </span>
          <span class="sdb-credit-side">
            <span class="sdb-credit-license">{{ item.license }}</span>
            <van-icon name="arrow" class="sdb-credit-arrow" />
          </span>
        </button>
      </section>
    </div>

    <div class="sdb-credits-foot">字体均依 SIL Open Font License 1.1 许可使用，版权归原作者所有。</div>
  </van-popup>
</template>

<style scoped>
.sdb-credits-popup {
  max-height: 72vh;
  display: flex;
  flex-direction: column;
  background: var(--sdb-bg);
  overflow: hidden;
}
.sdb-credits-head {
  padding: 20px 20px 12px;
  text-align: center;
}
.sdb-credits-title {
  margin: 0;
  font-size: var(--sdb-text-lg);
  font-weight: 500;
  color: var(--sdb-text);
}
.sdb-credits-sub {
  margin: 4px 0 0;
  font-size: var(--sdb-text-xs);
  color: var(--sdb-text-secondary);
}
.sdb-credits-body {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 4px 16px 12px;
}
.sdb-credits-group-title {
  margin: 14px 4px 6px;
  font-size: var(--sdb-text-xs);
  font-weight: 400;
  letter-spacing: 0.04em;
  color: var(--sdb-text-tertiary);
}
.sdb-credit-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 12px 14px;
  margin-bottom: 8px;
  background: var(--sdb-surface);
  border: 1px solid var(--sdb-border);
  border-radius: var(--sdb-radius-sm);
  text-decoration: none;
  font-family: inherit;
  font-size: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    transform var(--sdb-dur-fast) var(--sdb-ease-out),
    box-shadow var(--sdb-dur-fast) var(--sdb-ease-out);
}
.sdb-credit-item:active {
  transform: scale(0.98);
  box-shadow: var(--sdb-shadow-sm);
}
.sdb-credit-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.sdb-credit-name {
  font-size: var(--sdb-text-base);
  font-weight: 500;
  color: var(--sdb-text);
}
.sdb-credit-desc {
  font-size: var(--sdb-text-xs);
  color: var(--sdb-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sdb-credit-side {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.sdb-credit-license {
  padding: 2px 8px;
  font-size: 10px;
  color: var(--sdb-text-tertiary);
  background: var(--sdb-surface-2);
  border-radius: var(--sdb-radius-pill);
}
.sdb-credit-arrow {
  font-size: 14px;
  color: var(--sdb-text-tertiary);
}
.sdb-credits-foot {
  padding: 10px 20px calc(12px + env(safe-area-inset-bottom));
  text-align: center;
  font-size: 10px;
  color: var(--sdb-text-tertiary);
  background: var(--sdb-bg);
  border-top: 1px solid var(--sdb-border);
}
</style>

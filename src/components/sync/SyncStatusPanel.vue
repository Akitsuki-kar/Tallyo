<script setup lang="ts">
// 同步状态展示：状态徽标 / 上次同步时间 / 同步中进度 / 失败摘要 + 排查提示。
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useSyncStore } from '@/stores/sync';
import { dayjs } from '@/utils/dayjs';

const syncStore = useSyncStore();
const { status, lastSyncAt, error, progress } = storeToRefs(syncStore);

const statusMeta = computed(() => {
  switch (status.value) {
    case 'syncing':
      return { text: '同步中', color: 'var(--sdb-warning)' };
    case 'success':
      return { text: '同步成功', color: 'var(--sdb-success)' };
    case 'error':
      return { text: '同步失败', color: 'var(--sdb-danger)' };
    default:
      return { text: '未同步', color: 'var(--sdb-text-secondary)' };
  }
});

const lastSyncText = computed(() =>
  lastSyncAt.value ? dayjs(lastSyncAt.value).format('YYYY-MM-DD HH:mm') : '—',
);

const isCorsLike = computed(() => !!error.value && error.value.includes('docs/webdav-setup.md'));
</script>

<template>
  <van-cell-group inset title="同步状态" class="sdb-sync-group">
    <van-cell title="当前状态">
      <template #value>
        <span :style="{ color: statusMeta.color, fontWeight: 600 }">{{ statusMeta.text }}</span>
      </template>
    </van-cell>
    <van-cell title="上次同步" :value="lastSyncText" />
    <van-cell v-if="status === 'syncing'" title="进度">
      <template #value>
        <span class="sdb-sync-phase">{{ progress.phase }}（{{ progress.done }}/{{ progress.total }}）</span>
        <van-loading size="14px" class="sdb-sync-loading" />
      </template>
    </van-cell>
    <van-cell v-if="status === 'error'" title="错误信息">
      <template #label>
        <div class="sdb-sync-error">{{ error }}</div>
        <div v-if="isCorsLike" class="sdb-sync-cors">
          疑似网络 / CORS 拦截，请参考项目 docs/webdav-setup.md 配置反向代理后重试。
        </div>
      </template>
    </van-cell>
  </van-cell-group>
</template>

<style scoped>
.sdb-sync-group {
  margin: 8px 0 16px;
}
.sdb-sync-phase {
  margin-right: 6px;
  color: var(--sdb-text-secondary);
}
.sdb-sync-loading {
  display: inline-block;
  vertical-align: middle;
}
.sdb-sync-error {
  color: var(--sdb-danger);
  font-size: 13px;
  word-break: break-all;
}
.sdb-sync-cors {
  color: var(--sdb-warning);
  font-size: 12px;
  margin-top: 4px;
}
</style>

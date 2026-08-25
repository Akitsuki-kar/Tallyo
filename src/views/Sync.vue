<script setup lang="ts">
// 数据同步页：未配置态引导 → 配置区 + 状态区 + 立即同步。
// 同步完成后按决策 3 用 Toast 汇总「拉取 N 条 / 上传 M 条」，不逐条弹窗打断。
import { onMounted, ref } from 'vue';
import { showToast, showLoadingToast, closeToast } from 'vant';
import { storeToRefs } from 'pinia';
import { useSyncStore } from '@/stores/sync';
import EmptyState from '@/components/common/EmptyState.vue';
import SyncConfigForm from '@/components/sync/SyncConfigForm.vue';
import SyncStatusPanel from '@/components/sync/SyncStatusPanel.vue';

const syncStore = useSyncStore();
const { isConfigured, status } = storeToRefs(syncStore);
const syncing = ref(false);

onMounted(() => {
  void syncStore.loadConfig();
});

async function onSync(): Promise<void> {
  syncing.value = true;
  showLoadingToast({ message: '同步中...', forbidClick: true, duration: 0 });
  try {
    const res = await syncStore.sync();
    if (res.code === 0 && res.data) {
      // 体验⑩：透明化展示本次合并结果（拉取/上传/冲突）
      const conflictTip = res.data.conflicts > 0 ? `，合并 ${res.data.conflicts} 处冲突` : '';
      showToast(`已同步：拉取 ${res.data.pulled} 条 / 上传 ${res.data.pushed} 条${conflictTip}`);
    } else {
      showToast('同步失败：' + (res.message ?? '未知错误'));
    }
  } catch (e) {
    showToast('同步异常：' + (e instanceof Error ? e.message : String(e)));
  } finally {
    closeToast();
    syncing.value = false;
  }
}
</script>

<template>
  <div class="sdb-sync-view">
    <h2 class="sdb-page-title">数据同步</h2>

    <template v-if="isConfigured">
      <SyncStatusPanel />
      <div class="sdb-sync-run">
        <van-button
          type="primary"
          block
          :loading="syncing || status === 'syncing'"
          @click="onSync"
        >
          {{ status === 'syncing' ? '同步中...' : '立即同步' }}
        </van-button>
      </div>
      <SyncConfigForm class="sdb-sync-config" />
    </template>

    <template v-else>
      <EmptyState text="尚未配置同步" hint="填写 WebDAV 账号后，即可在多设备间同步数据" />
      <SyncConfigForm />
    </template>
  </div>
</template>

<style scoped>
.sdb-sync-view {
  max-width: 720px;
  margin: 0 auto;
}
.sdb-sync-run {
  padding: 0 16px 8px;
}
.sdb-sync-config {
  margin-top: 8px;
}
</style>

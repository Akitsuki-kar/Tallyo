<script setup lang="ts">
// 同步配置表单：WebDAV 地址 / 用户名 / 应用密码 / 启用开关 + 测试连接 / 保存。
// 安全：已保存的应用密码只显示掩码，不回显明文；明文仅在内存短暂存在并立即加密。
import { onMounted, reactive, ref } from 'vue';
import { showToast } from 'vant';
import { useSyncStore } from '@/stores/sync';
import { useSettingsStore } from '@/stores/settings';
import type { SyncConfig } from '@/types';

const emit = defineEmits<{ (e: 'saved'): void }>();
const syncStore = useSyncStore();
const settingsStore = useSettingsStore();

const form = reactive({
  url: '',
  username: '',
  password: '',
  enabled: false,
  syncTheme: true,
  syncSettings: true,
});
const hasSavedPassword = ref(false);
const saving = ref(false);
const testing = ref(false);
const autoBackup = ref(false);

onMounted(async () => {
  await syncStore.loadConfig();
  form.url = syncStore.config.url;
  form.username = syncStore.config.username;
  form.enabled = syncStore.config.enabled;
  // 旧配置可能没有这两个字段，用 ?? 兜底为 true（向后兼容）
  form.syncTheme = syncStore.config.syncTheme ?? true;
  form.syncSettings = syncStore.config.syncSettings ?? true;
  hasSavedPassword.value = !!syncStore.config.passwordEnc;
  await settingsStore.load();
  autoBackup.value = settingsStore.autoBackupEnabled;
});

async function onToggleAutoBackup(val: boolean): Promise<void> {
  autoBackup.value = val;
  await settingsStore.update({ autoBackupEnabled: val });
}

function isCrossOrigin(url: string): boolean {
  const u = url.trim();
  if (!u || u.startsWith('/')) return false; // 相对路径视为同源
  try {
    return new URL(u).origin !== location.origin;
  } catch {
    return false; // 非法 URL 交由连接测试暴露真实错误
  }
}

async function persistAndTest(): Promise<boolean> {
  if (!form.url.trim() || !form.username.trim()) {
    showToast('请填写 WebDAV 地址与用户名');
    return false;
  }
  // 同源反代（填 /dav/...）不会被浏览器安全策略拦截；跨域绝对地址在生产环境会被 CSP 拦截。
  if (isCrossOrigin(form.url)) {
    showToast('提示：检测到跨域地址，生产需同源反代（填 /dav/...），否则会被浏览器拦截');
  }
  const patch: Partial<SyncConfig> & { password?: string } = {
    url: form.url.trim(),
    username: form.username.trim(),
    enabled: form.enabled,
    syncTheme: form.syncTheme,
    syncSettings: form.syncSettings,
  };
  if (form.password) patch.password = form.password;
  await syncStore.saveConfig(patch);
  hasSavedPassword.value = true;
  form.password = '';
  return true;
}

async function onSave(): Promise<void> {
  saving.value = true;
  try {
    const okSave = await persistAndTest();
    if (okSave) {
      showToast('配置已保存');
      emit('saved');
    }
  } catch (e) {
    showToast('保存失败：' + (e instanceof Error ? e.message : String(e)));
  } finally {
    saving.value = false;
  }
}

async function onTest(): Promise<void> {
  testing.value = true;
  try {
    const okSave = await persistAndTest();
    if (!okSave) return;
    const res = await syncStore.testConnection();
    if (res.code === 0) showToast('连接成功');
    else showToast('连接失败：' + (res.message ?? ''));
  } catch (e) {
    showToast('连接失败：' + (e instanceof Error ? e.message : String(e)));
  } finally {
    testing.value = false;
  }
}
</script>

<template>
  <van-cell-group inset title="同步配置" class="sdb-sync-group">
    <van-field v-model="form.url" label="WebDAV 地址" placeholder="如 /dav/我的应用（同源反代）或 https://..." :border="false">
      <template #extra>
        <span class="sdb-sync-hint">开发 / 生产均建议填同源反代路径 /dav/...</span>
      </template>
    </van-field>
    <van-field v-model="form.username" label="用户名" placeholder="坚果云邮箱" :border="false" />
    <van-field
      v-model="form.password"
      type="password"
      label="应用密码"
      :placeholder="hasSavedPassword && !form.password ? '已保存（留空则不修改）' : '坚果云应用密码（非登录密码）'"
      :border="false"
    />
    <van-cell title="启用同步" center>
      <template #value>
        <van-switch v-model="form.enabled" />
      </template>
    </van-cell>
    <van-cell title="同步主题" label="关闭后各设备各自管深浅色" center>
      <template #value>
        <van-switch v-model="form.syncTheme" />
      </template>
    </van-cell>
    <van-cell title="同步应用设置" label="自动弹窗 / 默认视图 / 账单模板" center>
      <template #value>
        <van-switch v-model="form.syncSettings" />
      </template>
    </van-cell>
    <van-cell title="每周自动备份" label="启用且已配置同步时，每周自动备份到 WebDAV" center>
      <template #value>
        <van-switch :model-value="autoBackup" :disabled="!form.enabled" @change="onToggleAutoBackup" />
      </template>
    </van-cell>
    <div class="sdb-sync-actions">
      <van-button size="small" :loading="testing" @click="onTest">测试连接</van-button>
      <van-button size="small" type="primary" :loading="saving" @click="onSave">保存</van-button>
    </div>
  </van-cell-group>
  <p class="sdb-sync-note">
    应用密码仅在当前设备加密保存（密钥不跨设备、不随同步上传）。清除站点数据或更换设备后需重新填写。<br />
    每周自动备份会写入远端 <code>shuidian-dongzhang/backups/</code> 目录（JSON 快照，不含密码与密钥）。
  </p>
</template>

<style scoped>
.sdb-sync-group {
  margin: 8px 0 16px;
}
.sdb-sync-hint {
  font-size: 11px;
  color: var(--sdb-text-secondary);
}
.sdb-sync-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  padding: 12px 16px;
}
.sdb-sync-note {
  margin: 0 16px 16px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--sdb-text-tertiary);
}
</style>

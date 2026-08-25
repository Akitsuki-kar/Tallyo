<script setup lang="ts">
/**
 * 设备密钥云备份（体验⑭）
 *
 * 设计红线（与 D4 一致，且更严格）：
 * - 设备密钥明文只在本机内存短暂存在，绝不进 IndexedDB / 快照 / 日志 / 远端 data.json。
 * - 备份文件由「用户口令」二次加密（PBKDF2-SHA256 + AES-256-GCM），即便泄露也无法解密（口令足够强前提下）。
 * - 这是主动、可选操作；UI 明确提示用户使用强口令并妥善保管，任何情况下设备密钥不离开本机。
 */
import { ref, computed } from 'vue';
import { showToast, showSuccessToast, showConfirmDialog } from 'vant';
import { useSyncStore } from '@/stores/sync';
import { useSettingsStore } from '@/stores/settings';
import { exportKeyBackup, importKeyBackup } from '@/sync/crypto';
import { logger } from '@/utils/logger';

const syncStore = useSyncStore();
const settingsStore = useSettingsStore();

const exporting = ref(false);
const uploading = ref(false);
const importing = ref(false);
const downloading = ref(false);

// 导出表单：口令 + 确认
const exportPass = ref('');
const exportPass2 = ref('');
// 导入表单：口令
const importPass = ref('');
const importFromFileInput = ref<HTMLInputElement | null>(null);

const lastBackupAt = computed(() =>
  settingsStore.keyBackupAt ? new Date(settingsStore.keyBackupAt).toLocaleString('zh-CN') : '从未',
);
const syncReady = computed(() => syncStore.isConfigured);

function markBackedUp(): Promise<void> {
  return settingsStore.update({ keyBackupAt: new Date().toISOString() });
}

// ---- 导出到文件 ----
async function onExportFile(): Promise<void> {
  if (exportPass.value.length < 8) {
    showToast('备份口令至少 8 位');
    return;
  }
  if (exportPass.value !== exportPass2.value) {
    showToast('两次口令不一致');
    return;
  }
  exporting.value = true;
  try {
    const json = await exportKeyBackup(exportPass.value);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '水电动账-密钥备份.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    await markBackedUp();
    showSuccessToast('密钥备份已导出到文件');
    exportPass.value = '';
    exportPass2.value = '';
  } catch (e) {
    showToast('导出失败：' + (e instanceof Error ? e.message : String(e)));
  } finally {
    exporting.value = false;
  }
}

// ---- 上传到同步盘 ----
async function onUploadToCloud(): Promise<void> {
  if (exportPass.value.length < 8) {
    showToast('请先填写导出口令（至少 8 位）');
    return;
  }
  if (exportPass.value !== exportPass2.value) {
    showToast('两次口令不一致');
    return;
  }
  uploading.value = true;
  try {
    const json = await exportKeyBackup(exportPass.value);
    const res = await syncStore.uploadKeyBackup(json);
    if (res.code === 0) {
      await markBackedUp();
      showSuccessToast('已上传到同步盘');
      exportPass.value = '';
      exportPass2.value = '';
    } else {
      showToast('上传失败：' + (res.message ?? ''));
    }
  } catch (e) {
    showToast('上传失败：' + (e instanceof Error ? e.message : String(e)));
  } finally {
    uploading.value = false;
  }
}

// ---- 从文件恢复 ----
function triggerImportFile(): void {
  importFromFileInput.value?.click();
}

async function onImportFileSelected(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) await doImport(await file.text());
  input.value = ''; // 清空，允许重复选择同一文件
}

// ---- 从同步盘恢复 ----
async function onImportFromCloud(): Promise<void> {
  if (!importPass.value) {
    showToast('请先填写备份口令');
    return;
  }
  downloading.value = true;
  try {
    const res = await syncStore.downloadKeyBackup();
    if (res.code !== 0 || !res.data) {
      showToast('下载失败：' + (res.message ?? ''));
      return;
    }
    await doImport(res.data);
  } catch (err) {
    showToast('下载失败：' + (err instanceof Error ? err.message : String(err)));
  } finally {
    downloading.value = false;
  }
}

// ---- 统一的恢复逻辑（口令校验 + 确认 + 写回本机） ----
async function doImport(json: string): Promise<void> {
  if (!importPass.value) {
    showToast('请填写备份口令');
    return;
  }
  try {
    await showConfirmDialog({
      title: '恢复加密密钥',
      message: '恢复后会用备份中的密钥替换本机密钥，使已存的 WebDAV 密码可继续解密。确定继续？',
    });
  } catch {
    return; // 用户取消
  }
  importing.value = true;
  try {
    await importKeyBackup(json, importPass.value);
    showSuccessToast('密钥已恢复，原 WebDAV 密码可正常解密');
    importPass.value = '';
  } catch (e) {
    showToast('恢复失败：' + (e instanceof Error ? e.message : String(e)));
    logger.warn('[SDB:keyBackup]', '密钥恢复失败', {
      message: e instanceof Error ? e.message : String(e),
    });
  } finally {
    importing.value = false;
  }
}
</script>

<template>
  <van-cell-group inset title="设备密钥备份" class="sdb-keybackup-group">
    <div class="sdb-keybackup-warn">
      ⚠️ 设备密钥仅存本机，清除站点数据或更换设备后，已存的同步密码将无法解密。
      可把密钥用<b>你自设的口令</b>加密备份，换机时恢复。请务必牢记口令——口令丢失将无法恢复。
    </div>

    <!-- 导出（备份） -->
    <van-field
      v-model="exportPass"
      type="password"
      label="备份口令"
      placeholder="至少 8 位，用于加密密钥"
      :border="false"
    />
    <van-field
      v-model="exportPass2"
      type="password"
      label="确认口令"
      placeholder="再次输入"
      :border="false"
    />
    <div class="sdb-keybackup-actions">
      <van-button size="small" :loading="exporting" @click="onExportFile">导出到文件</van-button>
      <van-button
        size="small"
        type="primary"
        :loading="uploading"
        :disabled="!syncReady"
        @click="onUploadToCloud"
      >
        上传到同步盘
      </van-button>
    </div>
    <p v-if="!syncReady" class="sdb-keybackup-tip">未配置同步时，可选择「导出到文件」自行保管。</p>

    <van-divider>恢复</van-divider>

    <!-- 导入（恢复） -->
    <van-field v-model="importPass" type="password" label="备份口令" placeholder="导出时设置的口令" :border="false" />
    <div class="sdb-keybackup-actions">
      <van-button size="small" :loading="importing" @click="triggerImportFile">从文件恢复</van-button>
      <van-button
        size="small"
        type="primary"
        :loading="downloading"
        :disabled="!syncReady"
        @click="onImportFromCloud"
      >
        从同步盘恢复
      </van-button>
    </div>

    <p class="sdb-keybackup-meta">上次备份：{{ lastBackupAt }}</p>

    <input
      ref="importFromFileInput"
      type="file"
      accept=".json,application/json"
      style="display: none"
      @change="onImportFileSelected"
    />
  </van-cell-group>
</template>

<style scoped>
.sdb-keybackup-group {
  margin: 8px 0 16px;
}
.sdb-keybackup-warn {
  margin: 12px 16px;
  padding: 10px 12px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--sdb-text-secondary);
  background: var(--sdb-paper);
  border: 1px solid var(--sdb-border);
  border-radius: 10px;
}
.sdb-keybackup-warn b {
  color: var(--sdb-on-semantic);
}
.sdb-keybackup-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  padding: 12px 16px 0;
}
.sdb-keybackup-tip {
  margin: 8px 16px 0;
  font-size: 11px;
  color: var(--sdb-text-tertiary);
}
.sdb-keybackup-meta {
  margin: 12px 16px 4px;
  font-size: 11px;
  color: var(--sdb-text-tertiary);
}
</style>

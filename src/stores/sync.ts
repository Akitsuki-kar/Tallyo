/**
 * 同步 store（Phase 3 主逻辑）。
 * 导出名保持与 Phase 1 stub 一致：config / status / lastSyncAt / error / progress /
 * isConfigured / loadConfig / saveConfig / sync；并新增 testConnection。
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { SyncConfig, SyncStatus } from '@/types';
import * as kvRepo from '@/db/repositories/kvRepo';
import { encryptPassword, decryptPassword } from '@/sync/crypto';
import { createWebdavClient } from '@/sync/webdavClient';
import { acquireLock, releaseLock } from '@/sync/lock';
import { buildLocalSnapshot, applySnapshot, parseRemoteSnapshot, emptySnapshot } from '@/sync/snapshot';
import { mergeSnapshotDetailed } from '@/sync/merge';
import type { MergeStats, SyncSnapshot } from '@/sync/merge';
import { eventBus, EVENTS } from '@/utils/eventBus';
import { useSettingsStore } from '@/stores/settings';
import { useReadingsStore } from '@/stores/readings';
import { logger } from '@/utils/logger';
import { ERROR_CODES } from '@/utils/errorCodes';
import { ok, fail, type Result } from '@/utils/response';
import { isSdbError, type SdbError } from '@/sync/errors';

const CONFIG_KEY = 'syncConfig';
const DIR = 'shuidian-dongzhang';
const DATA_FILE = `${DIR}/data.json`;
const KEY_BACKUP_FILE = `${DIR}/key-backup.json`;

const DEFAULT_CONFIG: SyncConfig = {
  url: '',
  username: '',
  passwordEnc: '',
  enabled: false,
  syncTheme: true,
  syncSettings: true,
};

/** saveConfig 允许携带明文 password（不在 SyncConfig 类型中） */
export type SyncConfigPatch = Partial<SyncConfig> & { password?: string };

export const useSyncStore = defineStore('sync', () => {
  const config = ref<SyncConfig>({ ...DEFAULT_CONFIG });
  const status = ref<SyncStatus>('idle');
  const lastSyncAt = ref<string | undefined>(undefined);
  const error = ref<string | undefined>(undefined);
  const progress = ref<{ phase: string; done: number; total: number }>({ phase: '', done: 0, total: 0 });

  // 配置完整（启用 + 地址 + 用户名 + 已加密密码）才算可同步
  const isConfigured = computed(
    () => config.value.enabled && !!config.value.url && !!config.value.username && !!config.value.passwordEnc,
  );

  async function loadConfig(): Promise<void> {
    try {
      const rec = await kvRepo.getKv<SyncConfig>(CONFIG_KEY);
      if (rec && !rec.isDeleted && rec.value) {
        config.value = { ...DEFAULT_CONFIG, ...rec.value };
        if (rec.value.lastSyncAt) lastSyncAt.value = rec.value.lastSyncAt;
      }
    } catch (err) {
      logger.error('[SDB:sync]', '读取同步配置失败', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function saveConfig(patch: SyncConfigPatch): Promise<void> {
    try {
      const next: SyncConfig = { ...config.value, ...patch };
      // 明文密码：仅在提供时加密为 passwordEnc，绝不落库明文
      if (patch.password && patch.password.length > 0) {
        next.passwordEnc = await encryptPassword(patch.password);
      }
      // 确保不把明文 password 留在对象上
      delete (next as Partial<SyncConfigPatch>).password;

      const now = new Date().toISOString();
      const existing = await kvRepo.getKv<SyncConfig>(CONFIG_KEY);
      await kvRepo.putKv<SyncConfig>({
        key: CONFIG_KEY,
        value: next,
        updatedAt: now,
        syncVersion: (existing?.syncVersion ?? 0) + 1,
        isDeleted: false,
      });
      config.value = next;
    } catch (err) {
      logger.error('[SDB:sync]', '保存同步配置失败', {
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /** 探活：MKCOL + PROPFIND，供 UI「测试连接」使用。
   *  仅要求 地址/用户名/密码 三项齐全即可测（不依赖 enabled 开关：
   *  用户可能想先验证连通性再打开启用开关，此时不应被拦）。 */
  async function testConnection(): Promise<Result<void>> {
    if (!config.value.url || !config.value.username || !config.value.passwordEnc) {
      return fail(ERROR_CODES.SDB_VALIDATE, '请先填写完整的同步配置（地址/用户名/应用密码）');
    }
    try {
      const password = await decryptPassword(config.value.passwordEnc);
      const client = createWebdavClient({
        baseUrl: config.value.url.trim(),
        username: config.value.username,
        password,
      });
      await client.mkcol(DIR);
      await client.propfind(DATA_FILE);
      return ok(undefined, '连接成功');
    } catch (err) {
      return mapError(err);
    }
  }

  /** 错误归一化为 Result（带错误码与中文提示） */
  function mapError(err: unknown): Result<never> {
    if (isSdbError(err)) return fail(err.code, err.message);
    const msg = err instanceof Error ? err.message : String(err);
    return fail(ERROR_CODES.SDB_WEBDAV_CONN, msg);
  }

  /**
   * 每周自动备份（体验⑬）。
   * 仅当「已配置同步」且「用户启用自动备份」时执行；上次备份在 7 天内则跳过。
   * 备份写入远端 `${DIR}/backups/data-YYYYMMDD.json`，失败仅告警不影响主流程。
   */
  async function runAutoBackup(): Promise<void> {
    if (!isConfigured.value) return;
    const settingsStore = useSettingsStore();
    if (!settingsStore.autoBackupEnabled) return;
    if (settingsStore.lastAutoBackupAt) {
      const last = new Date(settingsStore.lastAutoBackupAt).getTime();
      if (!Number.isNaN(last) && Date.now() - last < 7 * 24 * 3600 * 1000) return;
    }
    try {
      const password = await decryptPassword(config.value.passwordEnc);
      const client = createWebdavClient({
        baseUrl: config.value.url.trim(),
        username: config.value.username,
        password,
      });
      await client.mkcol(DIR);
      await client.mkcol(`${DIR}/backups`);
      const snap = await buildLocalSnapshot({ syncSettings: config.value.syncSettings });
      const now = new Date();
      const ds = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
      const file = `${DIR}/backups/data-${ds}.json`;
      await client.put(file, JSON.stringify(snap));
      await settingsStore.update({ lastAutoBackupAt: now.toISOString() });
      logger.info('[SDB:sync]', '每周自动备份完成', { file });
    } catch (err) {
      logger.warn('[SDB:sync]', '自动备份失败（已跳过，不影响正常使用）', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * 上传设备密钥备份到 WebDAV（体验⑭）。
   * 备份由用户口令加密（见 @/sync/crypto），独立存放于 ${DIR}/key-backup.json，不进数据快照。
   */
  async function uploadKeyBackup(json: string): Promise<Result<void>> {
    if (!isConfigured.value) return fail(ERROR_CODES.SDB_VALIDATE, '请先配置并启用同步');
    try {
      const password = await decryptPassword(config.value.passwordEnc);
      const client = createWebdavClient({
        baseUrl: config.value.url.trim(),
        username: config.value.username,
        password,
      });
      await client.mkcol(DIR);
      await client.put(KEY_BACKUP_FILE, json);
      return ok(undefined);
    } catch (err) {
      return mapError(err);
    }
  }

  /** 从 WebDAV 下载设备密钥备份（体验⑭）。 */
  async function downloadKeyBackup(): Promise<Result<string>> {
    if (!isConfigured.value) return fail(ERROR_CODES.SDB_VALIDATE, '请先配置并启用同步');
    try {
      const password = await decryptPassword(config.value.passwordEnc);
      const client = createWebdavClient({
        baseUrl: config.value.url.trim(),
        username: config.value.username,
        password,
      });
      const text = await client.get(KEY_BACKUP_FILE);
      return ok(text);
    } catch (err) {
      return mapError(err);
    }
  }

  /** 持久化 lastSyncAt 到 kv */
  async function persistLastSyncAt(ts: string): Promise<void> {
    const existing = await kvRepo.getKv<SyncConfig>(CONFIG_KEY);
    const value: SyncConfig = { ...(existing?.value ?? config.value), lastSyncAt: ts };
    await kvRepo.putKv<SyncConfig>({
      key: CONFIG_KEY,
      value,
      updatedAt: new Date().toISOString(),
      syncVersion: (existing?.syncVersion ?? 0) + 1,
      isDeleted: false,
    });
  }

  /** 是否有需要写回本地的远端数据 */
  function hasPulled(pulled: Partial<SyncSnapshot>): boolean {
    return (
      (pulled.readings?.length ?? 0) > 0 ||
      (pulled.bills?.length ?? 0) > 0 ||
      (pulled.premises?.length ?? 0) > 0 ||
      (pulled.prices?.length ?? 0) > 0 ||
      (pulled.budgets?.length ?? 0) > 0 ||
      !!pulled.settings
    );
  }

  /**
   * 主同步链路：加锁 → 拉取 → 合并 → 应用 → 上传（If-Match 乐观并发，412 重试一次）→ 释放锁。
   */
  async function sync(): Promise<Result<MergeStats>> {
    // 离线直接返回，不发请求
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return fail(ERROR_CODES.SDB_NET_OFFLINE, '当前离线，无法同步');
    }

    const token = await acquireLock();
    if (!token) {
      return fail(ERROR_CODES.SDB_SYNC_LOCKED, '同步正在进行，请稍后再试');
    }

    status.value = 'syncing';
    error.value = undefined;
    let stats: MergeStats = { pulled: 0, pushed: 0, conflicts: 0 };

    try {
      const password = await decryptPassword(config.value.passwordEnc);
      const client = createWebdavClient({
        baseUrl: config.value.url.trim(),
        username: config.value.username,
        password,
      });

      progress.value = { phase: '创建同步目录', done: 0, total: 4 };
      await client.mkcol(DIR);

      progress.value = { phase: '拉取远端', done: 1, total: 4 };
      const meta = await client.propfind(DATA_FILE);
      let remoteEtag: string | undefined = meta.exists ? meta.etag : undefined;
      let remoteSnap = emptySnapshot();
      // ⚠️ 只凭 exists 判定是否拉取——不能依赖 etag 非空：
      // 部分 WebDAV 服务（含部分配置下的坚果云）不返回 getetag，若据此跳过拉取，
      // 远端会被当成空快照，导致「本地直接覆盖远端」、多端数据互相覆盖丢失。
      // etag 仅用于下方 PUT 的 If-Match 乐观锁（有则带，无则不带）。
      if (meta.exists) {
        remoteSnap = parseRemoteSnapshot(await client.get(DATA_FILE));
      }

      // 上传前先重建本地读数链：把 previousReading 校准后再进快照，
      // 这样修正结果本轮就能一起推上去，对端无需再等一轮才发现链变了。
      // 传 emitEvent=false：修正内容随即进入本次上传的快照，无需再触发补推。
      await useReadingsStore().relinkChains(undefined, false);

      // 冲突重试：412 → 重新拉取远端合并后重试一次
      let attempt = 0;
      while (true) {
        progress.value = { phase: '合并数据', done: 2, total: 4 };
        const localSnap = await buildLocalSnapshot({
          syncSettings: config.value.syncSettings,
        });
        const { merged, pulled, stats: s } = mergeSnapshotDetailed(localSnap, remoteSnap);
        stats = s;

        // 关闭「同步应用设置」时，远端设置即便被判为胜出也不会写入本地，
        // 从 pulled 中剔除，避免统计里出现永远不落地的虚假「拉取 1 条」。
        if (!config.value.syncSettings) delete pulled.settings;

        if (hasPulled(pulled)) {
          await applySnapshot(pulled, {
            syncTheme: config.value.syncTheme,
            syncSettings: config.value.syncSettings,
          });
        }

        progress.value = { phase: '上传快照', done: 3, total: 4 };
        try {
          remoteEtag = await client.put(DATA_FILE, JSON.stringify(merged), remoteEtag);
          break;
        } catch (putErr) {
          if (isSdbError(putErr) && putErr.kind === 'conflict' && attempt < 1) {
            attempt++;
            logger.warn('[SDB:sync]', '远端已被修改，重新拉取合并后重试');
            const fresh = await client.propfind(DATA_FILE);
            if (!fresh.exists) {
              remoteEtag = undefined;
              remoteSnap = emptySnapshot();
            } else {
              remoteEtag = fresh.etag;
              remoteSnap = parseRemoteSnapshot(await client.get(DATA_FILE));
            }
            continue;
          }
          throw putErr;
        }
      }

      const now = new Date().toISOString();
      lastSyncAt.value = now;
      config.value = { ...config.value, lastSyncAt: now };
      await persistLastSyncAt(now);

      status.value = 'success';
      progress.value = { phase: '同步完成', done: 4, total: 4 };
      eventBus.emit(EVENTS.SYNC_DONE, stats);
      return ok(stats);
    } catch (err) {
      status.value = 'error';
      const r = mapError(err) as Result<MergeStats>;
      error.value = r.message;
      logger.error('[SDB:sync]', '同步失败', {
        code: (err as SdbError)?.code,
        message: r.message,
      });
      return r;
    } finally {
      releaseLock(token);
    }
  }

    return {
      config,
      status,
      lastSyncAt,
      error,
      progress,
      isConfigured,
      loadConfig,
      saveConfig,
      testConnection,
      sync,
      runAutoBackup,
      uploadKeyBackup,
      downloadKeyBackup,
    };
});

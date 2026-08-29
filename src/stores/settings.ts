/**
 * 设置 store（全局：主题 / 自动弹窗 / 默认视图 / 账单模板；不含 unitPrice，D2 已移出）
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Settings, ThemeMode, DefaultView, BillTemplateId } from '@/types';
import * as kvRepo from '@/db/repositories/kvRepo';
import { applyThemeMode } from '@/composables/useTheme';
import { logger } from '@/utils/logger';

const SETTINGS_KEY = 'settings';

const DEFAULT_SETTINGS: Settings = {
  theme: 'light',
  autoPopQuickRecord: false,
  defaultView: 'home',
  templateId: 'receipt',
  updatedAt: '',
  autoBackupEnabled: false,
  lastAutoBackupAt: '',
  keyBackupAt: '',
};

export const useSettingsStore = defineStore('settings', () => {
  const theme = ref<ThemeMode>(DEFAULT_SETTINGS.theme);
  const autoPopQuickRecord = ref<boolean>(DEFAULT_SETTINGS.autoPopQuickRecord);
  const defaultView = ref<DefaultView>(DEFAULT_SETTINGS.defaultView);
  const templateId = ref<BillTemplateId>(DEFAULT_SETTINGS.templateId);
  const updatedAt = ref<string>(DEFAULT_SETTINGS.updatedAt);
  const autoBackupEnabled = ref<boolean>(DEFAULT_SETTINGS.autoBackupEnabled ?? false);
  const lastAutoBackupAt = ref<string>(DEFAULT_SETTINGS.lastAutoBackupAt ?? '');
  const keyBackupAt = ref<string>(DEFAULT_SETTINGS.keyBackupAt ?? '');

  const isDark = computed(() => theme.value === 'dark');

  async function load(): Promise<void> {
    try {
      const rec = await kvRepo.getKv<Settings>(SETTINGS_KEY);
      if (rec && !rec.isDeleted && rec.value) {
        const v = rec.value;
        theme.value = v.theme ?? DEFAULT_SETTINGS.theme;
        autoPopQuickRecord.value = v.autoPopQuickRecord ?? false;
        defaultView.value = v.defaultView ?? 'home';
        templateId.value = v.templateId ?? 'receipt';
        updatedAt.value = v.updatedAt ?? '';
        autoBackupEnabled.value = v.autoBackupEnabled ?? false;
        lastAutoBackupAt.value = v.lastAutoBackupAt ?? '';
        keyBackupAt.value = v.keyBackupAt ?? '';
      }
    } catch (err) {
      logger.error('store:settings', '加载设置失败', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
    applyThemeMode(theme.value);
  }

  async function update(patch: Partial<Settings>): Promise<void> {
    const now = new Date().toISOString();
    if (patch.theme !== undefined) theme.value = patch.theme;
    if (patch.autoPopQuickRecord !== undefined) autoPopQuickRecord.value = patch.autoPopQuickRecord;
    if (patch.defaultView !== undefined) defaultView.value = patch.defaultView;
    if (patch.templateId !== undefined) templateId.value = patch.templateId;
    if (patch.autoBackupEnabled !== undefined) autoBackupEnabled.value = patch.autoBackupEnabled;
  if (patch.lastAutoBackupAt !== undefined) lastAutoBackupAt.value = patch.lastAutoBackupAt;
  if (patch.keyBackupAt !== undefined) keyBackupAt.value = patch.keyBackupAt;
  updatedAt.value = now;

  const value: Settings = {
    theme: theme.value,
    autoPopQuickRecord: autoPopQuickRecord.value,
    defaultView: defaultView.value,
    templateId: templateId.value,
    updatedAt: now,
    autoBackupEnabled: autoBackupEnabled.value,
    lastAutoBackupAt: lastAutoBackupAt.value,
    keyBackupAt: keyBackupAt.value,
  };
    const existing = await kvRepo.getKv<Settings>(SETTINGS_KEY);
    const rec = {
      key: SETTINGS_KEY,
      value,
      updatedAt: now,
      syncVersion: (existing?.syncVersion ?? 0) + 1,
      isDeleted: false,
    };
    await kvRepo.putKv<Settings>(rec);
    if (patch.theme !== undefined) applyThemeMode(theme.value);
  }

  function applyTheme(): void {
    applyThemeMode(theme.value);
  }

  /**
   * 应用远端下发的设置（**同步链路专用**，请勿用于普通 UI 修改）。
   *
   * 与 update() 的关键差别：这里**沿用远端的 updatedAt**，而不是刷新成本地当前时间。
   *
   * 原因：设置是全对象单条 LWW（无 syncVersion，只比 updatedAt）。
   * 若应用远端时把 updatedAt 刷成「现在」，本地就会永远比远端新 ——
   *   A 拉远端 → 改时间戳 → 推上去 → B 拉（本地更旧）→ 改时间戳 → 推回来 → A 再拉……
   * 形成每次同步都白跑一轮的无限乒乓，且 conflicts 恒为 1。
   * 「同步主题」关闭时必然走这条路径（保留本地主题 = 必须与远端内容不同），
   * 所以必须冻结时间戳，让两端判等收敛。
   *
   * 用户后续在本地做任何设置修改仍走 update()，会照常刷新 updatedAt 并取胜。
   *
   * @param remote     远端设置对象
   * @param syncTheme  false 时保留本地主题，其余字段全部采用远端值
   */
  async function applyRemoteSettings(remote: Settings, syncTheme: boolean): Promise<void> {
    const next: Settings = syncTheme
      ? { ...remote }
      : { ...remote, theme: theme.value }; // 保留本地主题

    theme.value = next.theme;
    autoPopQuickRecord.value = next.autoPopQuickRecord;
    defaultView.value = next.defaultView;
    templateId.value = next.templateId;
    autoBackupEnabled.value = next.autoBackupEnabled ?? false;
    lastAutoBackupAt.value = next.lastAutoBackupAt ?? '';
    keyBackupAt.value = next.keyBackupAt ?? '';
    // 沿用远端 updatedAt：与远端保持同版本，避免下一轮又被判为「本地更新」
    updatedAt.value = remote.updatedAt;

    const value: Settings = { ...next, updatedAt: remote.updatedAt };
    const existing = await kvRepo.getKv<Settings>(SETTINGS_KEY);
    await kvRepo.putKv<Settings>({
      key: SETTINGS_KEY,
      value,
      updatedAt: new Date().toISOString(),
      syncVersion: (existing?.syncVersion ?? 0) + 1,
      isDeleted: false,
    });
    applyThemeMode(theme.value);
  }

  return {
    theme,
    autoPopQuickRecord,
    defaultView,
    templateId,
    updatedAt,
    autoBackupEnabled,
    lastAutoBackupAt,
    keyBackupAt,
    isDark,
    load,
    update,
    applyRemoteSettings,
    applyTheme,
  };
});

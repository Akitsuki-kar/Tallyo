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
    applyTheme,
  };
});

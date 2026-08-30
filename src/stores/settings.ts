/**
 * 设置 store（全局：主题 / 自动弹窗 / 默认视图 / 账单模板；不含 unitPrice，D2 已移出）
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type {
  Settings,
  ThemeMode,
  DefaultView,
  BillTemplateId,
  QuickRecordPop,
} from '@/types';
import * as kvRepo from '@/db/repositories/kvRepo';
import { applyThemeMode } from '@/composables/useTheme';
import { logger } from '@/utils/logger';

const SETTINGS_KEY = 'settings';

const DEFAULT_SETTINGS: Settings = {
  theme: 'light',
  quickRecordPop: 'off',
  autoMonthlyBill: true,
  defaultView: 'home',
  templateId: 'receipt',
  updatedAt: '',
  autoBackupEnabled: false,
  lastAutoBackupAt: '',
  keyBackupAt: '',
};

/**
 * 解析「启动弹快速记录」的时机，兼容 0.1.0 的布尔开关。
 *
 * 迁移口径：旧版 autoPopQuickRecord=true 时，App.vue 配合 localStorage 的日期去重，
 * 实际行为就是「每天首次打开弹一次」，因此映射到 'daily' 才是行为不变的迁移，
 * 而不是 'always'（那会让老用户升级后每次开 App 都被弹窗打断）。
 *
 * 同时容错非法值：远端快照被手改、或未来版本新增枚举回传到旧客户端时，一律回落 'off'。
 */
function normalizeQuickRecordPop(v: Partial<Settings> | undefined): QuickRecordPop {
  const raw = v?.quickRecordPop;
  if (raw === 'off' || raw === 'daily' || raw === 'always') return raw;
  if (v?.autoPopQuickRecord === true) return 'daily';
  return 'off';
}

export const useSettingsStore = defineStore('settings', () => {
  const theme = ref<ThemeMode>(DEFAULT_SETTINGS.theme);
  const quickRecordPop = ref<QuickRecordPop>(DEFAULT_SETTINGS.quickRecordPop);
  const autoMonthlyBill = ref<boolean>(DEFAULT_SETTINGS.autoMonthlyBill);
  const defaultView = ref<DefaultView>(DEFAULT_SETTINGS.defaultView);
  const templateId = ref<BillTemplateId>(DEFAULT_SETTINGS.templateId);
  const updatedAt = ref<string>(DEFAULT_SETTINGS.updatedAt);
  const autoBackupEnabled = ref<boolean>(DEFAULT_SETTINGS.autoBackupEnabled ?? false);
  const lastAutoBackupAt = ref<string>(DEFAULT_SETTINGS.lastAutoBackupAt ?? '');
  const keyBackupAt = ref<string>(DEFAULT_SETTINGS.keyBackupAt ?? '');
  /**
   * 是否已从 IndexedDB 读过一次设置。
   * 调用方（App.vue 启动弹窗判定）需要区分「用户确实关了这项」和「还没读库，现在拿到的是默认值」——
   * 靠某个字段是否为假来反推是否已加载会误判，必须有独立标记。
   */
  const loaded = ref(false);

  const isDark = computed(() => theme.value === 'dark');

  async function load(): Promise<void> {
    try {
      const rec = await kvRepo.getKv<Settings>(SETTINGS_KEY);
      if (rec && !rec.isDeleted && rec.value) {
        const v = rec.value;
        theme.value = v.theme ?? DEFAULT_SETTINGS.theme;
        quickRecordPop.value = normalizeQuickRecordPop(v);
        autoMonthlyBill.value = v.autoMonthlyBill ?? DEFAULT_SETTINGS.autoMonthlyBill;
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
    // 读失败也置位：此时内存里是 DEFAULT_SETTINGS，重复 load 也拿不到别的结果，
    // 不置位会让启动流程每次都重试一遍读库。
    loaded.value = true;
    applyThemeMode(theme.value);
  }

  async function update(patch: Partial<Settings>): Promise<void> {
    const now = new Date().toISOString();
    if (patch.theme !== undefined) theme.value = patch.theme;
    if (patch.quickRecordPop !== undefined) quickRecordPop.value = patch.quickRecordPop;
    if (patch.autoMonthlyBill !== undefined) autoMonthlyBill.value = patch.autoMonthlyBill;
    if (patch.defaultView !== undefined) defaultView.value = patch.defaultView;
    if (patch.templateId !== undefined) templateId.value = patch.templateId;
    if (patch.autoBackupEnabled !== undefined) autoBackupEnabled.value = patch.autoBackupEnabled;
    if (patch.lastAutoBackupAt !== undefined) lastAutoBackupAt.value = patch.lastAutoBackupAt;
    if (patch.keyBackupAt !== undefined) keyBackupAt.value = patch.keyBackupAt;
    updatedAt.value = now;

    const value: Settings = {
      theme: theme.value,
      quickRecordPop: quickRecordPop.value,
      autoMonthlyBill: autoMonthlyBill.value,
      // 向下兼容：0.1.0 客户端只认这个布尔字段，同步到老设备时仍能保持「弹/不弹」语义
      autoPopQuickRecord: quickRecordPop.value !== 'off',
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
    // 远端可能来自 0.1.0（只有布尔字段），统一走迁移解析
    quickRecordPop.value = normalizeQuickRecordPop(next);
    autoMonthlyBill.value = next.autoMonthlyBill ?? DEFAULT_SETTINGS.autoMonthlyBill;
    defaultView.value = next.defaultView;
    templateId.value = next.templateId;
    autoBackupEnabled.value = next.autoBackupEnabled ?? false;
    lastAutoBackupAt.value = next.lastAutoBackupAt ?? '';
    keyBackupAt.value = next.keyBackupAt ?? '';
    // 沿用远端 updatedAt：与远端保持同版本，避免下一轮又被判为「本地更新」
    updatedAt.value = remote.updatedAt;

    // 落库统一写迁移后的规范值：远端若来自 0.1.0 就没有新字段，
    // 直接原样存会让本地长期停留在旧结构（每次 load 都要再迁一遍）。
    // updatedAt 仍冻结为远端值，判等收敛不受影响（见上方大段说明）。
    const value: Settings = {
      ...next,
      quickRecordPop: quickRecordPop.value,
      autoMonthlyBill: autoMonthlyBill.value,
      autoPopQuickRecord: quickRecordPop.value !== 'off',
      updatedAt: remote.updatedAt,
    };
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
    quickRecordPop,
    autoMonthlyBill,
    defaultView,
    templateId,
    updatedAt,
    autoBackupEnabled,
    lastAutoBackupAt,
    keyBackupAt,
    loaded,
    isDark,
    load,
    update,
    applyRemoteSettings,
    applyTheme,
  };
});

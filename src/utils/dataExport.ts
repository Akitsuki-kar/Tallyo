/**
 * 数据导入导出工具（Phase 7）
 *
 * 复用同步基础设施（buildLocalSnapshot / parseRemoteSnapshot / applySnapshot / mergeSnapshotDetailed）
 * 实现本地数据的 JSON 文件导出与导入。
 *
 * 导出：全量快照（读数 / 账单 / 房源 / 单价 / 预算 / 应用设置），不含同步配置与加密密钥。
 * 导入：解析 JSON → 校验结构 → 与本地数据 LWW 合并 → 仅写回远端胜出的实体 → 刷新各 store。
 *       （而非直接覆盖本地——避免用旧文件覆盖新数据）
 */
import { buildLocalSnapshot, parseRemoteSnapshot, applySnapshot } from '@/sync/snapshot';
import { mergeSnapshotDetailed } from '@/sync/merge';
import { useReadingsStore } from '@/stores/readings';
import { useBillsStore } from '@/stores/bills';
import { usePremisesStore } from '@/stores/premises';
import { usePricesStore } from '@/stores/prices';
import { useBudgetsStore } from '@/stores/budgets';
import { useSettingsStore } from '@/stores/settings';
import { logger } from '@/utils/logger';
import { saveTextFile, type SaveTextResult } from '@/native/saveTextFile';

/**
 * 导出全量数据为 JSON 文件。
 * - Tauri 原生壳：弹系统保存对话框，用户自选位置，返回完整路径（见 saveTextFile）。
 * - Web / PWA：触发浏览器下载。
 * - 用户在系统对话框取消：outcome='cancelled'（调用方不应提示成功）。
 */
export async function exportData(): Promise<SaveTextResult> {
  const snapshot = await buildLocalSnapshot();
  const json = JSON.stringify(snapshot, null, 2);

  const now = new Date();
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const filename = `水电动账-${dateStr}.json`;

  return saveTextFile(filename, json);
}

/**
 * 从 JSON 文件导入数据。
 *
 * 采用 LWW 合并策略：先取本地全量快照，与导入文件 mergeSnapshotDetailed 合并，
 * 仅 apply 远端胜出的实体（pulled）。本地胜出的实体无需写入（已存在且为最新）。
 * 这样即使用户导入了旧文件，也不会用旧数据覆盖本地新数据。
 *
 * @param file 用户选择的 JSON 文件
 * @returns stats 合并统计（pulled/pushed/conflicts），供 UI 展示汇总
 * @throws 如果文件格式无效或写入失败
 */
export async function importData(file: File) {
  const text = await file.text();

  // 1. 解析 + 校验导入文件结构
  const imported = parseRemoteSnapshot(text);

  // 2. 取本地全量快照，与导入数据做 LWW 合并
  const local = await buildLocalSnapshot();
  const { pulled, stats } = mergeSnapshotDetailed(local, imported);

  // 3. 仅写回远端胜出的实体（本地胜出的已存在于本地，无需操作）
  await applySnapshot(pulled);

  // 4. 刷新所有 store 的内存状态（applySnapshot 内部已刷新，但此处额外保障一致性）
  const premises = usePremisesStore();
  const readings = useReadingsStore();
  const bills = useBillsStore();
  const prices = usePricesStore();
  const budgets = useBudgetsStore();
  const settings = useSettingsStore();

  await Promise.all([
    premises.load(),
    readings.load(),
    bills.load(),
    prices.load(),
    budgets.load(),
    settings.load(),
  ]);

  logger.info('[SDB:dataExport]', '数据导入完成', {
    file: file.name,
    pulled: stats.pulled,
    pushed: stats.pushed,
    conflicts: stats.conflicts,
  });

  return stats;
}

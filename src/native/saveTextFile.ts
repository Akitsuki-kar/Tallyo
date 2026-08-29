/**
 * 跨环境文本文件保存（导出数据 / 密钥备份共用）
 *
 * - Tauri 原生壳：弹**系统保存对话框**（用户自选位置），写入后返回完整路径
 *   —— 解决 WebView 内 `<a download>` 下载无下载栏、文件去向不可见的问题。
 * - Web / PWA：浏览器下载（进入下载目录），返回 outcome='downloaded'。
 * - 用户在系统对话框取消：返回 outcome='cancelled'（调用方不应提示成功）。
 *
 * 与 pdf.ts 的 PDF 导出同一套模式；仅文本场景（TextEncoder UTF-8 写入）。
 */
import { isTauriShell } from '@/utils/platform';
import { logger } from '@/utils/logger';

export type SaveOutcome = 'saved' | 'downloaded' | 'cancelled';

export interface SaveTextResult {
  outcome: SaveOutcome;
  /** outcome === 'saved' 时的完整文件路径（供 UI 明确告知用户） */
  path?: string;
}

/**
 * 保存一段文本为文件。
 *
 * @param filename    建议文件名（含扩展名，如 `水电动账-20260828.json`）
 * @param content     文本内容
 * @param filterName  系统对话框的过滤器名称（默认 JSON）
 */
export async function saveTextFile(
  filename: string,
  content: string,
  filterName = 'JSON',
): Promise<SaveTextResult> {
  // Tauri 原生壳：走系统保存对话框（体验与「数据在哪」问题的最佳解）。
  if (isTauriShell()) {
    try {
      // 字面量 specifier：Tauri 构建期由 Vite 正常打包进原生壳；Web 构建期被 vite.config 的
      // rollupOptions.external 标为外部（不解析/不打包）。本分支仅 Tauri 运行期经 isTauriShell() 进入。
      const { save } = (await import('@tauri-apps/plugin-dialog')) as {
        save: (opts: Record<string, unknown>) => Promise<string | null>;
      };
      const { writeFile } = (await import('@tauri-apps/plugin-fs')) as {
        writeFile: (path: string, data: Uint8Array) => Promise<void>;
      };
      const path = await save({
        defaultPath: filename,
        filters: [{ name: filterName, extensions: ['json'] }],
      });
      // 用户在系统对话框点取消：不落盘、不提示成功。
      if (!path) return { outcome: 'cancelled' };
      await writeFile(path, new TextEncoder().encode(content));
      return { outcome: 'saved', path };
    } catch (e) {
      logger.warn('[SDB:saveTextFile]', '原生保存失败，回退浏览器下载', {
        message: e instanceof Error ? e.message : String(e),
      });
      // 继续走下方浏览器下载兜底
    }
  }

  // Web / PWA / 原生回退：浏览器下载（文件进入浏览器下载目录）。
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return { outcome: 'downloaded' };
}

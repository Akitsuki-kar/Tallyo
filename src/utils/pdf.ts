/**
 * PDF 导出工具（D6：html2canvas + jsPDF）
 *
 * 将账单模板渲染的 DOM 元素捕获为图片，嵌入 A4 PDF 并触发下载。
 * 依赖通过动态 import 懒加载，避免计入主 chunk 体积。
 *
 * 注意：html2canvas 需要元素已渲染完成（display:none 的元素无法正确捕获），
 * 因此父组件应在弹层打开后再调用此函数。
 */
import { logger } from '@/utils/logger';
import { isTauriShell } from '@/utils/platform';

/**
 * 将 DOM 元素导出为 PDF 文件并下载。
 *
 * @param element  要捕获的 DOM 元素（账单模板根节点）
 * @param filename 文件名（不含 .pdf 后缀）
 */
export async function exportElementToPdf(
  element: HTMLElement,
  filename: string,
): Promise<void> {
  try {
    // 动态导入重依赖，避免计入主 bundle
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import('html2canvas'),
      import('jspdf'),
    ]);

    // 捕获 DOM → canvas
    const canvas = await html2canvas(element, {
      scale: 2, // 2x 清晰度
      useCORS: true,
      backgroundColor: getComputedStyle(document.body).backgroundColor || '#fff9f2',
      logging: false,
    });

    // A4 尺寸（mm）
    const pdfWidth = 210;
    const pdfHeight = 297;
    const margin = 10; // 页边距 mm

    // 计算图片在 PDF 中的尺寸（保持宽高比）
    const imgWidth = pdfWidth - margin * 2;
    const imgHeight = (canvas.height / canvas.width) * imgWidth;

    // 创建 PDF
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    // 将 canvas 转为 JPEG（体积小于 PNG）
    const imgData = canvas.toDataURL('image/jpeg', 0.92);

    // 如果图片高度超过一页内容区，分页处理
    const pageContentHeight = pdfHeight - margin * 2; // 每页可用内容高度
    const totalPages = Math.ceil(imgHeight / pageContentHeight);

    for (let page = 0; page < totalPages; page++) {
      if (page > 0) pdf.addPage();
      // 逐页偏移：image 整体上移，使该页对应的 image 片段出现在内容区域
      // page 0 → y = margin（顶部留白）；page 1 → y = margin - pageContentHeight（上移一页内容）
      const yOffset = margin - page * pageContentHeight;
      pdf.addImage(imgData, 'JPEG', margin, yOffset, imgWidth, imgHeight);
    }

    // 导出：Tauri 原生壳走系统保存对话框，体验优于浏览器下载；Web 仍用浏览器下载。
    if (isTauriShell()) {
      try {
        // 字面量 specifier：Tauri 构建期由 Vite 正常打包进原生壳；Web 构建期被 vite.config 的
        // rollupOptions.external 标为外部（不解析/不打包）。该分支被 isTauriShell() 守卫，浏览器永不执行。
        const { save } = (await import('@tauri-apps/plugin-dialog')) as any;
        const { writeFile } = (await import('@tauri-apps/plugin-fs')) as any;
        const path = await save({
          defaultPath: `${filename}.pdf`,
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        });
        if (path) {
          const bytes = pdf.output('arraybuffer') as ArrayBuffer;
          await writeFile(path, new Uint8Array(bytes));
          return;
        }
        // 用户在对话框取消：不落盘，直接返回（不触发浏览器下载）。
        return;
      } catch (e) {
        logger.warn('[SDB:pdf]', '原生保存失败，回退浏览器下载', {
          message: e instanceof Error ? e.message : String(e),
        });
        // 继续走下方浏览器下载兜底
      }
    }

    pdf.save(`${filename}.pdf`);
  } catch (err) {
    logger.error('[SDB:pdf]', 'PDF 导出失败', {
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

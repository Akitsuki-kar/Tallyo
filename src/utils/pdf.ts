/**
 * PDF 导出工具（D6：html2canvas-pro + jsPDF）
 *
 * 导出目标不是「屏幕上的控件截图」，而是一张**按 A4 比例排好的整页**——
 * 由 BillExportStage 在离屏处渲染：宽度贴合模板设计宽度、高度补足到 A4 比例、
 * 铺满纸纹底。这样 PDF 第一页正好被这张「纸」填满，不会出现在大白页中央
 * 贴一个小控件的割裂效果。
 *
 * 依赖通过动态 import 懒加载，避免计入主 chunk 体积。
 *
 * 注意：html2canvas-pro 需要元素已真实布局（display:none 的元素无法正确捕获），
 * 离屏渲染请用 position:fixed + 负偏移，而非 hidden/visibility。
 */
import { logger } from '@/utils/logger';
import { isTauriShell } from '@/utils/platform';

/** A4 页面尺寸（mm） */
const PAGE_W_MM = 210;
const PAGE_H_MM = 297;
/** 成像目标 DPI：过低文字发虚，过高在低端设备上容易撑爆 canvas */
const TARGET_DPI = 200;
/** A4 满宽在目标 DPI 下的像素宽度（≈1654px），用于反推捕获倍数 */
const TARGET_PX_W = (PAGE_W_MM / 25.4) * TARGET_DPI;

/**
 * 捕获元素为 canvas。
 *
 * 使用 html2canvas-pro（而非原版 html2canvas）：项目全部颜色 token 是 OKLCH
 * （oklch()），而原版 html2canvas 1.4.x 的 CSS 解析器不支持 OKLCH，解析 computed
 * style 会抛 "Attempting to parse an unsupported color function"（Web 端与原生壳
 * Windows/Android 导出 PDF 失败的根因）。html2canvas-pro 是官方 fork，原生支持
 * oklch/oklab/lab/lch/color() 等 CSS Color 4 颜色函数，API 与 1.4.x 完全兼容。
 *
 * 必须用 `html2canvas-pro` 包名 import：项目 package.json 依赖即 html2canvas-pro；
 * 若误写成 `html2canvas`，全新安装（npm ci）后该包不存在会直接解析失败，
 * 或残留旧包时解析到 1.4.1 复现 OKLCH 报错（jspdf 的 optionalDependencies 恰好
 * 也依赖 html2canvas@1.4.1，vite.config 已将其 external，见 buildExternals）。
 */
async function captureElement(element: HTMLElement): Promise<HTMLCanvasElement> {
  const [{ default: html2canvas }] = await Promise.all([import('html2canvas-pro')]);
  // 按元素实际宽度反推捕获倍数：窄模板（如 280px 小票）需要更大的倍数
  // 才能在铺满 A4 后仍保有足够清晰度
  const rect = element.getBoundingClientRect();
  const cssW = Math.round(rect.width) || element.offsetWidth || 794;
  const cssH = Math.round(rect.height) || element.offsetHeight || Math.round(cssW * 1.4143);
  const scale = Math.min(6, Math.max(2, Math.ceil(TARGET_PX_W / cssW)));
  return html2canvas(element, {
    scale,
    // 显式给出尺寸：元素是离屏渲染的（fixed + 负偏移），
    // 显式声明可避免 html2canvas 按窗口可视区推算裁剪框导致内容被切掉
    width: cssW,
    height: cssH,
    windowWidth: document.documentElement.clientWidth,
    windowHeight: document.documentElement.clientHeight,
    useCORS: true,
    // ⚠️ 必须关闭 foreignObjectRendering（false）：离屏元素（fixed + 负偏移）
    // 在该模式下会整体偏移到负坐标，画布内只剩透明像素，转 JPEG 后全黑
    // （实测 canvas 全 0,0,0,0，jpegLen 从 80KB 掉到 9KB）。html2canvas-pro 自带
    // CSS Color 4 解析器（oklch/lab/lch/oklab/color()），普通模式即可正确渲染
    // OKLCH token、本地字体与纸纹图，无需 foreignObject。
    foreignObjectRendering: false,
    // 固定米白底色：不依赖 body computed style（body 背景可能透明），
    // 透明背景转 JPEG 时会被编码成黑色（“一片黑”的另一个诱因）。
    backgroundColor: '#fff9f2',
    logging: false,
  });
}

/** 落盘：Tauri 原生壳走系统保存对话框，Web 走浏览器下载 */
async function savePdf(pdf: { output: (t: string) => unknown }, filename: string): Promise<void> {
  if (isTauriShell()) {
    // 字面量 specifier：Tauri 构建期由 Vite 正常打包进原生壳；Web 构建期被 vite.config 的
    // rollupOptions.external 标为外部（不解析/不打包）。该分支被 isTauriShell() 守卫，浏览器永不执行。
    const { save } = (await import('@tauri-apps/plugin-dialog')) as {
      save: (opts: Record<string, unknown>) => Promise<string | null>;
    };
    const { writeFile } = (await import('@tauri-apps/plugin-fs')) as {
      writeFile: (path: string, data: Uint8Array) => Promise<void>;
    };
    const path = await save({
      defaultPath: `${filename}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (!path) {
      // 用户在对话框取消：不落盘、不提示成功，也不回退浏览器下载（原生壳 WebView 下载无 UI，文件去向不可见）
      return;
    }
    const bytes = pdf.output('arraybuffer') as ArrayBuffer;
    await writeFile(path, new Uint8Array(bytes));
    return;
  }
  (pdf as unknown as { save: (n: string) => void }).save(`${filename}.pdf`);
}

/**
 * 将「整页」元素导出为 PDF，内容精确铺满页宽。
 *
 * 与「控件截图」的区别：本函数假定传入元素已按 A4 比例排版
 * （见 BillExportStage），因此按 PAGE_W_MM 满宽放置即为等比还原，不留页边距。
 * 元素高于单页时按整页高度顺延分页。
 *
 * @param element  已按 A4 比例排好的整页元素
 * @param filename 文件名（不含 .pdf 后缀）
 */
export async function exportPageToPdf(element: HTMLElement, filename: string): Promise<void> {
  try {
    const canvas = await captureElement(element);
    const { jsPDF } = await import('jspdf');
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    // 满页宽等比放置；高度按画布比例推出
    const imgW = PAGE_W_MM;
    const imgH = (canvas.height / canvas.width) * PAGE_W_MM;
    // JPEG：PNG 在 A4@200DPI 下会到数 MB，移动端 base64 编码压力大；0.95 肉眼无画质损失
    const imgData = canvas.toDataURL('image/jpeg', 0.95);

    const pages = Math.max(1, Math.ceil(imgH / PAGE_H_MM));
    for (let page = 0; page < pages; page++) {
      if (page > 0) pdf.addPage();
      // 逐页整体上移一页高度：page 0 → y=0；page 1 → y=-297，使该页对应的片段进入可视区
      pdf.addImage(imgData, 'JPEG', 0, -page * PAGE_H_MM, imgW, imgH);
    }

    await savePdf(pdf, filename);
  } catch (err) {
    logger.error('[SDB:pdf]', 'PDF 导出失败', {
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

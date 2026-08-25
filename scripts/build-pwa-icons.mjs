/**
 * PWA 图标处理脚本：从 AI 生成的 1024x1024 源图裁掉底部水印，
 * 缩放到 PWA 所需的标准尺寸（512/192/180）。
 *
 * 运行方式（从项目根）：
 *   "C:/Users/Karade/.workbuddy/binaries/node/versions/22.22.2/node.exe" scripts/build-pwa-icons.mjs
 *
 * sharp 安装在受管 Node.js 工作区下，ESM 不会读 NODE_PATH，
 * 所以这里用 createRequire 从工作区 node_modules 解析。
 */
import { createRequire } from 'node:module';
import { readdir, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ICONS_DIR = resolve(ROOT, 'public', 'icons');

// 从受管 Node.js 工作区加载 sharp（隔离环境，不污染项目依赖）
const requireFromWorkspace = createRequire(
  'C:/Users/Karade/.workbuddy/binaries/node/workspace/node_modules/',
);
const sharp = requireFromWorkspace('sharp');

/** 找到最新的 AI 生成源图（文件名含时间戳的最新一张）。 */
async function findLatestSource() {
  const entries = await readdir(ICONS_DIR);
  const sources = entries.filter(
    (f) => f.startsWith('App_icon_design_for') && f.endsWith('.png'),
  );
  if (sources.length === 0) throw new Error('未找到 AI 生成的源图');
  const stats = await Promise.all(
    sources.map(async (f) => ({ f, t: (await stat(resolve(ICONS_DIR, f))).mtimeMs })),
  );
  stats.sort((a, b) => b.t - a.t);
  return resolve(ICONS_DIR, stats[0].f);
}

/** 裁掉底部水印 + 缩放到目标尺寸并铺成 square。 */
async function buildOne(source, size, outName) {
  const bg = { r: 0xff, g: 0x8c, b: 0x42 }; // #FF8C42 terracotta 品牌色
  const meta = await sharp(source).metadata();
  // 裁掉底部 ~13%（保留 87%），去掉 AI 生成水印
  const cropH = Math.round(meta.height * 0.87);
  const buf = await sharp(source)
    .extract({ left: 0, top: 0, width: meta.width, height: cropH })
    .resize(size, size, { fit: 'cover' })
    .flatten({ background: bg })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const out = resolve(ICONS_DIR, outName);
  await writeFile(out, buf);
  const s = await stat(out);
  console.log(`  ✓ ${outName} (${size}x${size}, ${(s.size / 1024).toFixed(1)} KB)`);
}

async function main() {
  const source = await findLatestSource();
  console.log(`源图：${source}`);
  console.log('生成图标：');
  await buildOne(source, 512, 'pwa-512.png');
  await buildOne(source, 192, 'pwa-192.png');
  await buildOne(source, 180, 'apple-touch-icon.png');
  console.log('\n完成。');
}

main().catch((err) => {
  console.error('失败：', err);
  process.exit(1);
});
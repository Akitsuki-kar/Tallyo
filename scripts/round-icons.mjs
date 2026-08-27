/**
 * 应用图标加「圆角」一键处理：从 src-tauri/icons/icon.png 派生圆角版本，
 * 同步覆盖 PWA 三件套（pwa-512 / pwa-192 / apple-touch-icon）。
 *
 * 设计：18% 半径圆角矩形 mask，dest-in 合成 → 角落透明（视觉自然圆润，
 * macOS/Win11 系统会在此基础上再叠 squircle/圆角矩形遮罩，效果更好）。
 *
 * 用法（项目根）：
 *   "C:/Users/Karade/.workbuddy/binaries/node/versions/22.22.2/node.exe" scripts/round-icons.mjs
 */
import { createRequire } from 'node:module';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// 从受管 Node.js 工作区加载 sharp（同 build-pwa-icons.mjs）
const requireFromWorkspace = createRequire(
  'C:/Users/Karade/.workbuddy/binaries/node/workspace/node_modules/',
);
const sharp = requireFromWorkspace('sharp');

const ICON_SRC = resolve(ROOT, 'src-tauri/icons/icon.png');
const PWA_512 = resolve(ROOT, 'public/icons/pwa-512.png');
const PWA_192 = resolve(ROOT, 'public/icons/pwa-192.png');
const APPLE = resolve(ROOT, 'public/icons/apple-touch-icon.png');

/** 18% 圆角半径：跨平台均衡（macOS 22% / Win11 ~12% 之间），适合全出血图标 */
const RADIUS_PCT = 0.18;

/** 生成圆角矩形 SVG mask（dest-in 用），rx/ry = size * pct */
function roundedMask(size, radiusPct) {
  const radius = Math.round(size * radiusPct);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#fff"/>` +
      `</svg>`,
  );
}

/** 读取源图 → 缩放至 size → 加圆角 mask → 写出 */
async function build(srcPath, outPath, size) {
  const base = await sharp(srcPath).toBuffer();
  await sharp(base)
    .resize(size, size, { fit: 'cover' })
    .composite([{ input: roundedMask(size, RADIUS_PCT), blend: 'dest-in' }])
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  const s = await stat(outPath);
  console.log(`  ✓ ${outPath.replace(ROOT + '\\', '')} (${size}x${size}, ${(s.size / 1024).toFixed(1)} KB)`);
}

async function main() {
  const meta = await sharp(ICON_SRC).metadata();
  const srcSize = meta.width ?? 1024;
  console.log(`源图：${ICON_SRC.replace(ROOT + '\\', '')} (${srcSize}x${meta.height})`);
  console.log(`圆角半径：${Math.round(srcSize * RADIUS_PCT)}px (${(RADIUS_PCT * 100).toFixed(0)}%)`);
  console.log('生成圆角图标：');

  // 1. icon.png（Tauri 全平台源）：保持原尺寸，仅加圆角
  await build(ICON_SRC, ICON_SRC, srcSize);
  // 2. PWA 三件套：从圆角后的 icon.png 缩放派生
  await build(ICON_SRC, PWA_512, 512);
  await build(ICON_SRC, PWA_192, 192);
  await build(ICON_SRC, APPLE, 180);

  console.log('\n下一步：npx tauri icon src-tauri/icons/icon.png  重派生 Tauri 全套（ico/icns/各尺寸）');
}

main().catch((err) => {
  console.error('失败：', err);
  process.exit(1);
});
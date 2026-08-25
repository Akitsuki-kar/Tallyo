// 生成 PWA 图标（纯色 PNG，确保 manifest 引用文件存在、构建不缺文件）
// 用法：node scripts/gen-icons.mjs  （或 npm run gen:icons）
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import zlib from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(__dirname, '../public');
const iconsDir = resolve(publicDir, 'icons');
mkdirSync(iconsDir, { recursive: true });

// CRC32 表
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

// 生成纯色 RGBA PNG
function makePNG(size, [r, g, b]) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 6; // 颜色类型 RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const row = Buffer.alloc(1 + size * 4);
  for (let x = 0; x < size; x++) {
    row[1 + x * 4] = r;
    row[1 + x * 4 + 1] = g;
    row[1 + x * 4 + 2] = b;
    row[1 + x * 4 + 3] = 255;
  }
  const rows = [];
  for (let y = 0; y < size; y++) rows.push(row);
  const raw = Buffer.concat(rows);
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const ORANGE = [255, 140, 66];
writeFileSync(resolve(iconsDir, 'pwa-192.png'), makePNG(192, ORANGE));
writeFileSync(resolve(iconsDir, 'pwa-512.png'), makePNG(512, ORANGE));
console.log('PWA icons generated: pwa-192.png, pwa-512.png');

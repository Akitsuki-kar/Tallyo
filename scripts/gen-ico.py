#!/usr/bin/env python3
"""
生成全帧圆角 Windows 图标（icon.ico）。

背景：`npx tauri icon` 生成的 .ico 里 ≤32px 帧是 BMP 编码（AND-mask 无平滑 alpha），
16/24/32px 圆角角落在 Windows 上显示为不透明方形（64/256px 为 PNG 帧才带 alpha）。
Windows 任务栏/标题栏/快捷方式图标用的正是 16–48px —— 因此观感「非圆角」。

本脚本手动构造 ICO：每个尺寸帧直接嵌入 PNG（Windows Vista+ 支持 PNG 压缩帧，
带完整 alpha），并按 18% 半径重新施加圆角 mask —— 任何尺寸都是真圆角。

用法（项目根，venv 需含 pillow）：
  C:/Users/Karade/.workbuddy/binaries/python/envs/default/Scripts/python.exe scripts/gen-ico.py

流程约定：每次改图标 → 先 scripts/round-icons.mjs（圆角 icon.png + PWA）
→ 再本脚本（圆角 .ico）→ npx tauri icon 仅用于派生 Android/iOS 资源（勿覆盖 icon.ico）。
"""
import io
import os
import struct
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'src-tauri', 'icons', 'icon.png')
OUT = os.path.join(ROOT, 'src-tauri', 'icons', 'icon.ico')
RADIUS_PCT = 0.18  # 与 round-icons.mjs 保持一致
SIZES = [16, 24, 32, 48, 64, 128, 256]


def rounded(src_img: Image.Image, size: int) -> Image.Image:
    """缩放到 size 并重新施加圆角矩形 alpha mask（保证任意尺寸圆角精确）。

    注意：不能直接用 ImageDraw.rounded_rectangle —— 小尺寸（16/24/32px）
    rasterizer 舍入会失效。正确做法：黑底 + 中央十字白矩形 + 四角白色实心圆
    （圆心在 (r,r)，角点 (0,0) 到圆心距离 r√2 > r → 透明），数学精确。
    """
    img = src_img.resize((size, size), Image.LANCZOS)
    radius = max(1, round(size * RADIUS_PCT))
    mask = Image.new('L', (size, size), 0)
    draw = ImageDraw.Draw(mask)
    # 中央十字主体
    draw.rectangle([radius, 0, size - radius - 1, size - 1], fill=255)
    draw.rectangle([0, radius, size - 1, size - radius - 1], fill=255)
    # 四角白色实心圆（半径 radius，圆心在 (radius-0.5, radius-0.5)）
    r2 = 2 * radius
    draw.ellipse([0, 0, r2 - 1, r2 - 1], fill=255)
    draw.ellipse([size - r2, 0, size - 1, r2 - 1], fill=255)
    draw.ellipse([0, size - r2, r2 - 1, size - 1], fill=255)
    draw.ellipse([size - r2, size - r2, size - 1, size - 1], fill=255)
    img.putalpha(mask)
    return img


def build_ico(frames: list[Image.Image], out_path: str) -> None:
    """手动打包 ICO：头部 + 目录表 + 各帧 PNG 数据（全 alpha 保留）。"""
    count = len(frames)
    entries: list[bytes] = []
    blobs: list[bytes] = []
    offset = 6 + 16 * count
    for im in frames:
        w, h = im.size
        buf = io.BytesIO()
        im.save(buf, format='PNG')
        blob = buf.getvalue()
        # 尺寸 0 表示 256（ICO 目录字节只能表示 0-255）
        dim = 0 if w >= 256 else w
        entries.append(struct.pack('<BBBBHHII', dim, dim, 0, 0, 1, 32, len(blob), offset))
        offset += len(blob)
        blobs.append(blob)
    with open(out_path, 'wb') as f:
        f.write(struct.pack('<HHH', 0, 1, count))
        f.write(b''.join(entries))
        f.write(b''.join(blobs))


def main() -> None:
    src = Image.open(SRC).convert('RGBA')
    frames = [rounded(src, s) for s in SIZES]
    build_ico(frames, OUT)
    print(f'OK -> {OUT} ({os.path.getsize(OUT)} bytes, sizes={SIZES}, 全 PNG 帧)')


if __name__ == '__main__':
    main()

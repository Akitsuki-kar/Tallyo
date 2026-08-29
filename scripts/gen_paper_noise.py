#!/usr/bin/env python3
"""生成「纸纹底噪」贴片 paper-noise.png（128x128 RGBA）。

替代原来的内联 SVG feTurbulence 滤镜：
- feTurbulence 在每个用到 --sdb-paper 的元素上都会触发一次 CPU 滤镜光栅化，
  Android WebView 上按 DPR 逐元素生成位图，是滑动卡顿/耗电的主因之一。
- 预渲染成一张小位图后，重复平铺只是一次廉价的 GPU blit，不再逐元素跑滤镜。
- 噪点 alpha 控制在 ~3-6%，与旧 SVG（opacity 0.04 / 0.025）观感一致。

仅用标准库（zlib + struct）手写 PNG，无第三方依赖。种子固定保证可复现。
"""
import zlib
import struct
import random

W = H = 128
SEED = 20260829
OUT = "public/textures/paper-noise.png"

random.seed(SEED)

raw = bytearray()
for _ in range(H):
    raw.append(0)  # 每行 filter type = 0 (None)
    for _ in range(W):
        g = random.randint(0, 255)        # 灰度噪点
        a = random.randint(6, 16)         # 低 alpha，叠加成极轻纸纹
        raw += bytes((g, g, g, a))


def chunk(tag: bytes, data: bytes) -> bytes:
    body = tag + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)


png = (
    b"\x89PNG\r\n\x1a\n"
    + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 6, 0, 0, 0))
    + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    + chunk(b"IEND", b"")
)

with open(OUT, "wb") as f:
    f.write(png)

print(f"written {OUT} ({W}x{H}, {len(png)} bytes)")

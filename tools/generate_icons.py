#!/usr/bin/env python3
"""生成 PWA 图标（一次性脚本，不参与网页运行）。

用法：
    python3 tools/generate_icons.py

要求本机已安装 Pillow（当前 Mac 已安装）。
"""

import os

from PIL import Image, ImageDraw

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'icons')


def make_icon(size: int, maskable: bool = False) -> None:
    img = Image.new('RGBA', (size, size), (29, 78, 216, 255))
    draw = ImageDraw.Draw(img)

    # 轻微的左上角高光，让图标不那么单调
    draw.ellipse(
        [-size * 0.25, -size * 0.35, size * 0.85, size * 0.45],
        fill=(45, 100, 235, 255),
    )

    if maskable:
        # maskable 图标要留出中心安全区
        points_ratio = [(0.33, 0.63), (0.46, 0.49), (0.55, 0.57), (0.68, 0.40)]
    else:
        points_ratio = [(0.24, 0.65), (0.42, 0.46), (0.54, 0.56), (0.73, 0.33)]

    points = [(x * size, y * size) for x, y in points_ratio]
    width = max(3, int(size * 0.06))
    draw.line(points, fill=(255, 255, 255, 255), width=width, joint='curve')

    end_x, end_y = points[-1]
    radius = width * 0.72
    draw.ellipse(
        [end_x - radius, end_y - radius, end_x + radius, end_y + radius],
        fill=(255, 255, 255, 255),
    )

    start_x, start_y = points[0]
    start_radius = width * 0.42
    draw.ellipse(
        [start_x - start_radius, start_y - start_radius,
         start_x + start_radius, start_y + start_radius],
        fill=(255, 255, 255, 190),
    )

    filename = f'icon-maskable-{size}.png' if maskable else f'icon-{size}.png'
    path = os.path.join(OUT_DIR, filename)
    img.save(path, 'PNG', optimize=True)
    print(path)


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in (180, 192, 512):
        make_icon(size)
    make_icon(512, maskable=True)


if __name__ == '__main__':
    main()

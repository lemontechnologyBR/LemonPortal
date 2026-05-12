#!/usr/bin/env python3
"""Remove ruído de alpha quase zero em public/icons/lemon-logo.png (ex.: preto a=1)."""
from __future__ import annotations

from pathlib import Path

from PIL import Image


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    path = root / "public" / "icons" / "lemon-logo.png"
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    px = im.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 8 or (r + g + b < 24 and a < 64):
                px[x, y] = (0, 0, 0, 0)
    im.save(path, "PNG")
    print("OK:", path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

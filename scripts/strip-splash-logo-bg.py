#!/usr/bin/env python3
"""Remove fundo teal + tarja cinza (mock de telefone) do splash-logo.png via flood-fill a partir das bordas."""
from __future__ import annotations

import sys
from collections import deque
from pathlib import Path

from PIL import Image


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    path_in = root / "public" / "images" / "splash-logo.png"
    path_out = path_in
    if len(sys.argv) >= 2:
        path_in = Path(sys.argv[1])
    if len(sys.argv) >= 3:
        path_out = Path(sys.argv[2])

    im = Image.open(path_in).convert("RGBA")
    w, h = im.size
    px = im.load()

    # Fundo principal do artefato (mesmo #1a5d77 do splash CSS)
    tr, tg, tb = 26, 93, 119

    def teal_dist(r: int, g: int, b: int) -> float:
        return ((r - tr) ** 2 + (g - tg) ** 2 + (b - tb) ** 2) ** 0.5

    def neutral_gray_frame(r: int, g: int, b: int) -> bool:
        lo, hi = 40, 78
        if not (lo <= r <= hi and lo <= g <= hi and lo <= b <= hi):
            return False
        return max(r, g, b) - min(r, g, b) <= 14

    def is_void(r: int, g: int, b: int, _: int) -> bool:
        if teal_dist(r, g, b) <= 40:
            return True
        return neutral_gray_frame(r, g, b)

    seen = [[False] * w for _ in range(h)]
    q: deque[tuple[int, int]] = deque()

    for x in range(w):
        for y in (0, h - 1):
            if not seen[y][x]:
                r, g, b, a = px[x, y]
                if is_void(r, g, b, a):
                    seen[y][x] = True
                    q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if not seen[y][x]:
                r, g, b, a = px[x, y]
                if is_void(r, g, b, a):
                    seen[y][x] = True
                    q.append((x, y))

    while q:
        x, y = q.popleft()
        r, g, b, _a = px[x, y]
        px[x, y] = (r, g, b, 0)
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx]:
                r2, g2, b2, a2 = px[nx, ny]
                if is_void(r2, g2, b2, a2):
                    seen[ny][nx] = True
                    q.append((nx, ny))

    # Aperta ao desenho: o mock costuma ser “telefone” alto com a logo num canto —
    # sem crop, no splash a marca fica um pontinho no meio da tela.
    pad = 20
    bb = im.split()[-1].getbbox()
    if bb is not None:
        x0, y0, x1, y1 = bb
        x0 = max(0, x0 - pad)
        y0 = max(0, y0 - pad)
        x1 = min(w, x1 + pad)
        y1 = min(h, y1 + pad)
        im = im.crop((x0, y0, x1, y1))

    im.save(path_out, "PNG")
    print("OK:", path_out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

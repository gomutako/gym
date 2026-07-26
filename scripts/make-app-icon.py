#!/usr/bin/env python3
"""Genera l'icona dell'app iOS a partire dal marchio del form di login.

Il marchio è quello di `views/LoginView.vue`: quadrato con gradiente dal primario
al passo 400 della scala e, al centro, il manubrio bianco — cinque segmenti ad
assi paralleli con estremi arrotondati, quindi disegnabili come capsule senza
bisogno di un rasterizzatore SVG.

I colori si leggono da `frontend/src/lib/palette.js`, l'unica sorgente della
palette: se il brand cambia, si rilancia questo script e l'icona segue.

    python3 scripts/make-app-icon.py

Scrive l'icona dell'app iOS e quelle del web (apple-touch-icon e PWA) in RGB
**senza canale alfa** e **senza angoli arrotondati**, come iOS richiede: la
maschera la applica il sistema.
"""
import re
import struct
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PALETTE = ROOT / 'frontend/src/lib/palette.js'

# Lo stesso marchio in tutti i posti dove l'app si presenta con un'icona.
TARGETS = [
    (ROOT / 'frontend/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', 1024),
    (ROOT / 'frontend/public/apple-touch-icon.png', 180),
    (ROOT / 'frontend/public/pwa-192x192.png', 192),
    (ROOT / 'frontend/public/pwa-512x512.png', 512),
]

SS = 3  # supersampling per lato: 9 campioni per pixel, bordi lisci senza alfa

# Il manubrio di LoginView.vue, in coordinate viewBox 0..24
STROKE = 2.2
SEGMENTS = [
    ((4, 9), (4, 15)),
    ((7, 7), (7, 17)),
    ((17, 7), (17, 17)),
    ((20, 9), (20, 15)),
    ((7, 12), (17, 12)),
]
# Larghezza dell'inchiostro (con gli estremi arrotondati) sul lato dell'icona.
INK_RATIO = 0.64


def brand_scale():
    """Legge la scala `brand` dalla palette JS."""
    src = PALETTE.read_text()
    block = re.search(r'export const brand = \{(.*?)\};', src, re.S)
    if not block:
        sys.exit(f'scala brand non trovata in {PALETTE}')
    steps = dict(re.findall(r'(\d+):\s*\'(#[0-9A-Fa-f]{6})\'', block.group(1)))
    for key in ('600', '400'):
        if key not in steps:
            sys.exit(f'passo {key} assente dalla scala brand')
    return steps


def rgb(hex_color):
    h = hex_color.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def dist_to_segment(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    length2 = dx * dx + dy * dy
    t = 0.0 if length2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length2))
    cx, cy = ax + t * dx, ay + t * dy
    return ((px - cx) ** 2 + (py - cy) ** 2) ** 0.5


def build(SIZE):
    steps = brand_scale()
    start, end = rgb(steps['600']), rgb(steps['400'])

    # Geometria del manubrio: scala tale che l'inchiostro occupi INK_RATIO del lato.
    r = STROKE / 2
    xs = [x for seg in SEGMENTS for x, _ in seg]
    ys = [y for seg in SEGMENTS for _, y in seg]
    ink_w = (max(xs) + r) - (min(xs) - r)
    ink_h = (max(ys) + r) - (min(ys) - r)
    scale = SIZE * INK_RATIO / ink_w
    off_x = (SIZE - ink_w * scale) / 2 - (min(xs) - r) * scale
    off_y = (SIZE - ink_h * scale) / 2 - (min(ys) - r) * scale
    radius = r * scale
    segs = [((ax * scale + off_x, ay * scale + off_y), (bx * scale + off_x, by * scale + off_y))
            for (ax, ay), (bx, by) in SEGMENTS]

    rows = []
    samples = SS * SS
    for y in range(SIZE):
        row = bytearray()
        for x in range(SIZE):
            # Gradiente `to-br`: proiezione sulla diagonale, come fa il CSS.
            t = (x + y) / (2 * (SIZE - 1))
            base = tuple(round(start[i] + (end[i] - start[i]) * t) for i in range(3))
            # Copertura del glifo: quota dei campioni dentro una delle capsule.
            hits = 0
            for sy in range(SS):
                py = y + (sy + 0.5) / SS
                for sx in range(SS):
                    px = x + (sx + 0.5) / SS
                    if any(dist_to_segment(px, py, ax, ay, bx, by) <= radius
                           for (ax, ay), (bx, by) in segs):
                        hits += 1
            if hits == 0:
                row += bytes(base)
            else:
                a = hits / samples
                row += bytes(round(base[i] + (255 - base[i]) * a) for i in range(3))
        rows.append(bytes(row))
    return rows


def write_png(path, rows, SIZE):
    raw = b''.join(b'\x00' + r for r in rows)  # filtro 0 per riga

    def chunk(tag, data):
        body = tag + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body))

    header = struct.pack('>IIBBBBB', SIZE, SIZE, 8, 2, 0, 0, 0)  # 8 bit, truecolor RGB
    png = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header)
           + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))
    path.write_bytes(png)


if __name__ == '__main__':
    for path, size in TARGETS:
        write_png(path, build(size), size)
        print(f'scritta {path.relative_to(ROOT)} ({size}x{size}, RGB senza alfa)')

#!/usr/bin/env python3
"""Draws the living-world effect sprites (client/src/world/ambience).

    python3 tools/ambience/make_fx.py

Writes client/public/assets/sprites/fx/fx.png (16x16 cells, 8 columns) and
cloud-shadow.png, and prints the frame table that client/src/world/ambience/frames.ts
mirrors. Every colour is read from client/src/style/tokens.ts (Resurrect 64), so the
sprites share the palette of the tiles and the turtles. Needs Pillow. It only writes its
own two files.
"""
import math
import re
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "client/public/assets/sprites/fx"
TOKENS = (ROOT / "client/src/style/tokens.ts").read_text()

R64 = re.findall(r"'(#[0-9a-f]{6})'", TOKENS.split("export const R64")[1].split("] as const")[0])
assert len(R64) == 64, len(R64)
NAMES = re.findall(r"(\w+): R64\[(\d+)\]", TOKENS)
C = {name: tuple(int(R64[int(i)][k : k + 2], 16) for k in (1, 3, 5)) + (255,) for name, i in NAMES}

# one letter per palette colour used by the pixel maps below
KEY = {
    "k": "ink", "w": "white", "m": "mist", "s": "silver",
    "g": "grass", "G": "green", "d": "greenDark", "p": "pine",
    "y": "amber", "l": "lemon", "o": "orange", "c": "copper", "n": "sand", "N": "sandDark", "u": "mud", "r": "rust",
    "b": "sky", "B": "blue", "L": "skyLight", "a": "aqua", "t": "mint", "T": "turquoise",
    "v": "violet", "P": "purple", "i": "pinkLight", "h": "hotPink", "R": "red", "C": "crimson",
}
CELL = 16
COLS = 8
CLEAR = (0, 0, 0, 0)


def cell(rows, outline=False, anchor="center", swap=None):
    """A 16x16 frame from a small pixel map. anchor: center | bottom (feet on the cell floor)."""
    h, w = len(rows), max(len(r) for r in rows)
    ox = (CELL - w) // 2
    oy = CELL - h - 1 if anchor == "bottom" else (CELL - h) // 2
    px = [[CLEAR] * CELL for _ in range(CELL)]
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch != ".":
                ch = (swap or {}).get(ch, ch)
                px[oy + y][ox + x] = C[KEY[ch]] if ch in KEY else C[ch]
    if outline:
        ink = C["ink"]
        src = [r[:] for r in px]
        for y in range(CELL):
            for x in range(CELL):
                if src[y][x][3]:
                    continue
                near = [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
                if any(0 <= a < CELL and 0 <= b < CELL and src[b][a][3] for a, b in near):
                    px[y][x] = ink
    return px


def shear(rows, lean):
    """Lean a plant: the top row moves `lean` pixels right, the root stays."""
    h = len(rows)
    w = max(len(r) for r in rows) + abs(lean)
    out = []
    for y, row in enumerate(rows):
        shift = round(lean * (h - 1 - y) / max(1, h - 1))
        out.append(("." * shift + row).ljust(w, "."))
    return out


TUFT = ["G...G..", "G.G.G.G", "dGd.GdG", ".dGdGd."]
FLOWER = [".i.", "iyi", ".i.", ".d.", ".d."]
BUTTERFLY_OPEN = ["vv.k.vv", "vPvkvPv", ".vvkvv.", ".vP.Pv."]
BUTTERFLY_SHUT = ["..vkv..", "..vkv..", "..PkP.."]
LEAF = [[".oo", "oc."], ["o..", "co.", ".c."], ["oc.", ".oo"]]
BIRD_STAND = ["..bbb..", ".bbkbyy", "Bbbbb..", ".Bwww..", "..k.k.."]
BIRD_HOP = ["..bbb..", ".bbkbyy", "Bbbbb..", ".Bwww..", "......."]
BIRD_UP = ["b.....b", "Bb...bB", ".BbbbB.", "..bbbyy"]
BIRD_DOWN = ["..bbb..", ".bbbbyy", "BbbBbB.", "B.....B"]
GULL_UP = ["w.....w", ".w...w.", "..wsw..", "...w..."]
GULL_DOWN = ["..wsw..", ".wwmww.", "w..m..w"]
SHADOW = [".kkkk.", "kkkkkk"]
SPLASH = [["..w..", ".LwL."], [".w.w.", "L...L"], ["w...w", ".....", "L...L"]]
# breath on a white snow floor: sky tones, so it still reads once it leaves the turtle
PUFF = [["wL", "Lm"], [".LL.", "LwwL", ".mL."], ["L.L.L", ".w.m.", "m.L.m", ".m.L."]]
SPARKLE = [["w"], [".w.", "wlw", ".w."], ["..w..", ".....", "w.l.w", ".....", "..w.."]]
SHARD = ["..a..", ".at.v", ".atvP", "TatvP"]
SCONCE = [[".1.", "121", ".2.", "sss", ".s."], ["1..", "12.", "22.", "sss", ".s."], ["...", ".1.", "121", "sss", ".s."]]
# the inside room accents: FACE_STYLE[face].ramp light / base in tokens.ts
ACCENT = {1: ("grassLight", "grass"), 2: ("lemon", "sand"), 3: ("white", "skyLight"), 4: ("green", "greenDark"), 5: ("skin", "peach"), 6: ("silver", "mauve")}


def tumbleweed(turn):
    rows = []
    for y in range(10):
        row = ""
        for x in range(10):
            dx, dy = x - 4.5, y - 4.5
            r = math.hypot(dx, dy)
            if r > 4.8:
                row += "."
                continue
            a = math.atan2(dy, dx) + turn * math.pi / 2
            twig = math.sin(a * 3 + r * 1.3)
            row += "N" if twig > 0.35 else "u" if twig > -0.25 or r > 3.9 else "c" if r < 1.5 else "."
        rows.append(row)
    return rows


def flag(phase):
    rows = [["."] * 9 for _ in range(13)]
    for y in range(13):
        rows[y][0] = "s"
    for x in range(1, 8):
        wave = round(math.sin(x * 0.9 + phase * 2 * math.pi / 3))
        tall = 5 if x < 5 else 3
        for y in range(tall):
            rows[1 + wave + y + (5 - tall) // 2][x] = "C" if y == tall - 1 or (x + phase) % 4 == 3 else "R"
    return ["".join(r) for r in rows]


def lit(rows, level):
    """Crystal shards: level 0 dim, 1 as drawn, 2 bright."""
    swap = [{"a": "T", "t": "a", "v": "P"}, {}, {"a": "w", "t": "a", "T": "a", "P": "v", "v": "i"}][level]
    return ["".join(swap.get(ch, ch) for ch in row) for row in rows]


FRAMES = []  # (name, pixels)


def add(name, frames):
    for f in frames:
        FRAMES.append((name, f))


add("tuft", [cell(shear(TUFT, lean), anchor="bottom") for lean in (0, 1, 2)])
add("flowerPink", [cell(shear(FLOWER, lean), anchor="bottom") for lean in (0, 1)])
add("flowerWhite", [cell(shear(FLOWER, lean), anchor="bottom", swap={"i": "w"}) for lean in (0, 1)])
add("butterflyViolet", [cell(BUTTERFLY_OPEN), cell(BUTTERFLY_SHUT)])
add("butterflyAmber", [cell(r, swap={"v": "y", "P": "o"}) for r in (BUTTERFLY_OPEN, BUTTERFLY_SHUT)])
add("leaf", [cell(r) for r in LEAF])
add("leafGreen", [cell(r, swap={"o": "g", "c": "G"}) for r in LEAF])
add("birdHop", [cell(BIRD_STAND, outline=True, anchor="bottom"), cell(BIRD_HOP, outline=True, anchor="bottom")])
add("birdFly", [cell(BIRD_UP, outline=True), cell(BIRD_DOWN, outline=True)])
add("gull", [cell(GULL_UP, outline=True), cell(GULL_DOWN, outline=True)])
add("shadow", [cell(SHADOW)])
add("tumbleweed", [cell(tumbleweed(t), outline=True) for t in range(4)])
add("flag", [cell(flag(p), outline=True, anchor="bottom") for p in range(3)])
add("splash", [cell(r, anchor="bottom") for r in SPLASH])
add("puff", [cell(r) for r in PUFF])
add("sparkle", [cell(r) for r in SPARKLE])
add("shard", [cell(lit(SHARD, level), anchor="bottom") for level in (0, 1, 2)])
for face in range(1, 7):
    # a white-hot core in the room's light tone: it has to read on a wall of the same accent
    C["1"], C["2"] = C["white"], C[ACCENT[face][0]]
    add(f"sconce{face}", [cell(rows, outline=True) for rows in SCONCE])

rows_n = math.ceil(len(FRAMES) / COLS)
sheet = Image.new("RGBA", (COLS * CELL, rows_n * CELL), CLEAR)
for i, (_, px) in enumerate(FRAMES):
    for y in range(CELL):
        for x in range(CELL):
            if px[y][x][3]:
                sheet.putpixel(((i % COLS) * CELL + x, (i // COLS) * CELL + y), px[y][x])
OUT.mkdir(parents=True, exist_ok=True)
sheet.save(OUT / "fx.png")

# a soft-edged pixel cloud, drawn in ink and shown at low alpha
W, H = 56, 32
cloud = Image.new("RGBA", (W, H), CLEAR)
BLOBS = [(16, 18, 13, 9), (30, 13, 14, 11), (42, 19, 11, 8), (26, 22, 18, 7)]
for y in range(H):
    for x in range(W):
        if any(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1 for cx, cy, rx, ry in BLOBS):
            cloud.putpixel((x, y), C["ink"])
cloud.save(OUT / "cloud-shadow.png")

table = {}
for i, (name, _) in enumerate(FRAMES):
    table.setdefault(name, []).append(i)
print(f"// {len(FRAMES)} frames, {COLS} columns")
for name, idx in table.items():
    print(f"  {name}: [{', '.join(map(str, idx))}],")

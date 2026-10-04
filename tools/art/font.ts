// m5x7 (Daniel Linssen, CC0) as a Phaser bitmap font: a white glyph atlas plus an
// AngelCode .fnt (XML). The TTF's outlines are pixel squares, so sampling the outline at
// every pixel centre at 16px gives the exact bitmap with no anti-aliasing.
import { readFileSync, writeFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { C } from '../../client/src/style/tokens';
import { Img } from './img';

const SIZE = 16;
const CHARS = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i));

type Pt = [number, number];

/** Flatten an opentype path into closed polygons (m5x7 only has straight lines). */
function polygons(path: opentype.Path): Pt[][] {
  const polys: Pt[][] = [];
  let cur: Pt[] = [];
  for (const c of path.commands) {
    if (c.type === 'M') {
      if (cur.length) polys.push(cur);
      cur = [[c.x, c.y]];
    } else if (c.type === 'L') cur.push([c.x, c.y]);
    else if (c.type === 'Q' || c.type === 'C') cur.push([c.x, c.y]);
    else if (c.type === 'Z') {
      if (cur.length) polys.push(cur);
      cur = [];
    }
  }
  if (cur.length) polys.push(cur);
  return polys;
}

/** Non-zero winding test. */
function inside(polys: Pt[][], x: number, y: number): boolean {
  let wind = 0;
  for (const p of polys)
    for (let i = 0; i < p.length; i++) {
      const [x1, y1] = p[i]!;
      const [x2, y2] = p[(i + 1) % p.length]!;
      if (y1 <= y !== y2 <= y) {
        const t = (y - y1) / (y2 - y1);
        if (x1 + t * (x2 - x1) > x) wind += y2 > y1 ? 1 : -1;
      }
    }
  return wind !== 0;
}

/** The rasterized glyphs, so the generator can also write text into images (badges). */
export const GLYPHS = new Map<string, { rows: boolean[][]; advance: number }>();

/** Draw a line of m5x7 into an image. Returns the width in pixels. */
export function drawText(img: Img, x: number, y: number, text: string, colour: string): number {
  let cx = x;
  for (const ch of text) {
    const g = GLYPHS.get(ch);
    if (!g) throw new Error(`drawText: no glyph for "${ch}" (build the font first)`);
    g.rows.forEach((row, j) => row.forEach((on, i) => on && img.set(cx + i, y + j, colour)));
    cx += g.advance;
  }
  return cx - x - 1;
}

export const textWidth = (text: string): number => [...text].reduce((w, ch) => w + GLYPHS.get(ch)!.advance, 0) - 1;

export function buildFont(ttf: string, dir: string): void {
  const buf = readFileSync(ttf);
  const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const scale = SIZE / font.unitsPerEm;
  const ascent = Math.round(font.ascender * scale);
  const lineHeight = Math.round((font.ascender - font.descender) * scale);

  const CELL = 16;
  const COLS = 16;
  const atlas = new Img(COLS * CELL, Math.ceil(CHARS.length / COLS) * CELL);
  const rows: string[] = [];
  CHARS.forEach((ch, i) => {
    const glyph = font.charToGlyph(ch);
    const polys = polygons(glyph.getPath(0, ascent, SIZE));
    const ox = (i % COLS) * CELL;
    const oy = Math.floor(i / COLS) * CELL;
    let maxX = 0;
    const bits: boolean[][] = [];
    for (let y = 0; y < CELL; y++) {
      bits.push([]);
      for (let x = 0; x < CELL; x++) {
        const on = inside(polys, x + 0.5, y + 0.5);
        bits[y]!.push(on);
        if (on) {
          atlas.set(ox + x, oy + y, C.white);
          maxX = Math.max(maxX, x + 1);
        }
      }
    }
    const advance = Math.round((glyph.advanceWidth ?? 0) * scale);
    GLYPHS.set(ch, { rows: bits, advance });
    rows.push(`    <char id="${ch.charCodeAt(0)}" x="${ox}" y="${oy}" width="${Math.max(maxX, 1)}" height="${CELL}" xoffset="0" yoffset="0" xadvance="${advance}" page="0" chnl="15"/>`);
  });
  atlas.save(`${dir}/fonts/m5x7.png`);
  writeFileSync(
    `${dir}/fonts/m5x7.xml`,
    `<?xml version="1.0"?>
<font>
  <info face="m5x7" size="${SIZE}" bold="0" italic="0" charset="" unicode="1" stretchH="100" smooth="0" aa="0" padding="0,0,0,0" spacing="0,0" outline="0"/>
  <common lineHeight="${lineHeight}" base="${ascent}" scaleW="${atlas.w}" scaleH="${atlas.h}" pages="1" packed="0"/>
  <pages>
    <page id="0" file="m5x7.png"/>
  </pages>
  <chars count="${CHARS.length}">
${rows.join('\n')}
  </chars>
</font>
`,
  );
  console.log(`font: unitsPerEm ${font.unitsPerEm}, ascent ${ascent}px, line ${lineHeight}px`);
}

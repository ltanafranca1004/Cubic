// A tiny pixel canvas for the art generator. Colours are '#rrggbb' strings from the
// palette in client/src/style/tokens.ts; null / '' is transparent.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PNG } from 'pngjs';
import { R64 } from '../../client/src/style/tokens';

export type Color = string | null;

const rgb = (c: string): [number, number, number] => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const PAL = R64.map((c) => ({ c: c as string, v: rgb(c) }));

/** Nearest Resurrect 64 colour ("redmean" distance: cheap and close to how we see). */
export function nearest(r: number, g: number, b: number): string {
  let best = PAL[0]!.c;
  let bestD = Infinity;
  for (const p of PAL) {
    const rm = (r + p.v[0]) / 2;
    const dr = r - p.v[0];
    const dg = g - p.v[1];
    const db = b - p.v[2];
    const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
    if (d < bestD) {
      bestD = d;
      best = p.c;
    }
  }
  return best;
}

export const luma = (c: string): number => {
  const [r, g, b] = rgb(c);
  return 0.299 * r + 0.587 * g + 0.114 * b;
};

export class Img {
  readonly px: Color[];

  constructor(
    readonly w: number,
    readonly h: number,
    fill: Color = null,
  ) {
    this.px = new Array<Color>(w * h).fill(fill);
  }

  static load(path: string): Img {
    const png = PNG.sync.read(readFileSync(path));
    const img = new Img(png.width, png.height);
    for (let i = 0; i < png.width * png.height; i++) {
      const a = png.data[i * 4 + 3]!;
      img.px[i] = a < 128 ? null : '#' + [0, 1, 2].map((k) => png.data[i * 4 + k]!.toString(16).padStart(2, '0')).join('');
    }
    return img;
  }

  get(x: number, y: number): Color {
    return x < 0 || y < 0 || x >= this.w || y >= this.h ? null : this.px[y * this.w + x]!;
  }

  set(x: number, y: number, c: Color): this {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = c;
    return this;
  }

  rect(x: number, y: number, w: number, h: number, c: Color): this {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c);
    return this;
  }

  /** Filled ellipse inside the box x,y,w,h. */
  ellipse(x: number, y: number, w: number, h: number, c: Color): this {
    const rx = w / 2;
    const ry = h / 2;
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const dx = (i + 0.5 - rx) / rx;
        const dy = (j + 0.5 - ry) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x + i, y + j, c);
      }
    return this;
  }

  /** Rows of characters; `key` maps a character to a colour ('.' and ' ' are transparent). */
  art(x: number, y: number, rows: readonly string[], key: Record<string, Color>): this {
    rows.forEach((row, j) =>
      [...row].forEach((ch, i) => {
        if (ch === '.' || ch === ' ') return;
        if (!(ch in key)) throw new Error(`art: no colour for "${ch}"`);
        this.set(x + i, y + j, key[ch]!);
      }),
    );
    return this;
  }

  /** Draw `src` (or a part of it) here. Transparent source pixels are skipped. */
  blit(src: Img, x: number, y: number, sx = 0, sy = 0, sw = src.w, sh = src.h, flipX = false): this {
    for (let j = 0; j < sh; j++)
      for (let i = 0; i < sw; i++) {
        const c = src.get(sx + (flipX ? sw - 1 - i : i), sy + j);
        if (c) this.set(x + i, y + j, c);
      }
    return this;
  }

  crop(x: number, y: number, w: number, h: number): Img {
    return new Img(w, h).blit(this, 0, 0, x, y, w, h);
  }

  clone(): Img {
    return this.crop(0, 0, this.w, this.h);
  }

  /** Change colours through `fn` (transparent pixels are left alone). */
  map(fn: (c: string, x: number, y: number) => Color): this {
    for (let i = 0; i < this.px.length; i++) if (this.px[i]) this.px[i] = fn(this.px[i]!, i % this.w, Math.floor(i / this.w));
    return this;
  }

  /** Snap every pixel to the palette. */
  quantize(): this {
    const seen = new Map<string, string>();
    return this.map((c) => {
      let q = seen.get(c);
      if (!q) seen.set(c, (q = nearest(...rgb(c))));
      return q;
    });
  }

  /** Swap exact colours. */
  swap(table: Record<string, Color>): this {
    return this.map((c) => (c in table ? table[c]! : c));
  }

  /** 1px outline around everything opaque (4-neighbours, or 8 with `corners`). */
  outline(c: string, corners = false): this {
    const src = this.clone();
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (src.get(x, y)) continue;
        const near = src.get(x - 1, y) || src.get(x + 1, y) || src.get(x, y - 1) || src.get(x, y + 1) || (corners && (src.get(x - 1, y - 1) || src.get(x + 1, y - 1) || src.get(x - 1, y + 1) || src.get(x + 1, y + 1)));
        if (near) this.set(x, y, c);
      }
    return this;
  }

  /** Whole-number upscale. */
  scale(n: number): Img {
    const out = new Img(this.w * n, this.h * n);
    for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) out.set(x, y, this.get(Math.floor(x / n), Math.floor(y / n)));
    return out;
  }

  /** Every colour used, to check an image is on-palette. */
  colours(): Set<string> {
    return new Set(this.px.filter((c): c is string => !!c));
  }

  save(path: string): void {
    const png = new PNG({ width: this.w, height: this.h });
    this.px.forEach((c, i) => {
      if (!c) return;
      const [r, g, b] = rgb(c);
      png.data[i * 4] = r;
      png.data[i * 4 + 1] = g;
      png.data[i * 4 + 2] = b;
      png.data[i * 4 + 3] = 255;
    });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, PNG.sync.write(png));
  }
}

/** Frames side by side in one strip. */
export function strip(frames: readonly Img[]): Img {
  const w = frames[0]!.w;
  const h = frames[0]!.h;
  const out = new Img(w * frames.length, h);
  frames.forEach((f, i) => out.blit(f, i * w, 0));
  return out;
}

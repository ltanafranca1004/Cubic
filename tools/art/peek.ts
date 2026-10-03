// Dev helper: blow a tileset up with a labelled 16px grid so tile coordinates can be read
// off by eye.  tsx art/peek.ts <in.png> <out.png> [scale] [x0 y0 cols rows]
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const DIGITS = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111'];

const [, , src, out, scaleArg, x0a, y0a, ca, ra] = process.argv;
const img = PNG.sync.read(readFileSync(src!));
const S = Number(scaleArg ?? 3);
const T = 16;
const x0 = Number(x0a ?? 0);
const y0 = Number(y0a ?? 0);
const cols = Number(ca ?? Math.ceil(img.width / T) - x0);
const rows = Number(ra ?? Math.ceil(img.height / T) - y0);
const M = 14;
const W = cols * T * S + M;
const H = rows * T * S + M;
const o = new PNG({ width: W, height: H });
const set = (x: number, y: number, r: number, g: number, b: number) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  o.data[i] = r;
  o.data[i + 1] = g;
  o.data[i + 2] = b;
  o.data[i + 3] = 255;
};
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) set(x, y, 40, 40, 48);
for (let y = 0; y < rows * T * S; y++) {
  for (let x = 0; x < cols * T * S; x++) {
    const sx = x0 * T + Math.floor(x / S);
    const sy = y0 * T + Math.floor(y / S);
    const checker = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? 90 : 110;
    let r = checker;
    let g = checker;
    let b = checker + 20;
    if (sx < img.width && sy < img.height) {
      const i = (sy * img.width + sx) * 4;
      const a = img.data[i + 3]! / 255;
      r = Math.round(img.data[i]! * a + r * (1 - a));
      g = Math.round(img.data[i + 1]! * a + g * (1 - a));
      b = Math.round(img.data[i + 2]! * a + b * (1 - a));
    }
    if (x % (T * S) === 0 || y % (T * S) === 0) {
      r = 255;
      g = 0;
      b = 255;
    }
    set(x + M, y + M, r, g, b);
  }
}
const num = (n: number, px: number, py: number) => {
  [...String(n)].forEach((ch, k) => {
    const d = DIGITS[Number(ch)]!;
    for (let i = 0; i < 15; i++) if (d[i] === '1') for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) set(px + k * 8 + (i % 3) * 2 + a, py + Math.floor(i / 3) * 2 + b, 255, 255, 0);
  });
};
for (let c = 0; c < cols; c++) num(c + x0, M + c * T * S + 4, 2);
for (let r = 0; r < rows; r++) num(r + y0, 0, M + r * T * S + 4);
writeFileSync(out!, PNG.sync.write(o));
console.log(`${img.width}x${img.height} -> ${W}x${H} (${Math.ceil(img.width / T)}x${Math.ceil(img.height / T)} tiles)`);

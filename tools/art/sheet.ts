// Dev helper: lay several PNGs out on one checkerboard sheet, scaled up, to review them.
//   tsx art/sheet.ts <out.png> <scale> <bg #rrggbb|checker> <a.png> <b.png> ...
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';

const [, , out, scaleArg, bg, ...files] = process.argv;
const S = Number(scaleArg);
const imgs = files.map((f) => PNG.sync.read(readFileSync(f)));
const PAD = 6;
const MAXW = 1500;
let x = PAD;
let y = PAD;
let rowH = 0;
const at: [number, number][] = [];
let W = 0;
for (const im of imgs) {
  if (x + im.width * S + PAD > MAXW && x > PAD) {
    x = PAD;
    y += rowH + PAD;
    rowH = 0;
  }
  at.push([x, y]);
  x += im.width * S + PAD;
  rowH = Math.max(rowH, im.height * S);
  W = Math.max(W, x);
}
const H = y + rowH + PAD;
const o = new PNG({ width: W, height: H });
const rgb = bg && bg.startsWith('#') ? [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16)) : null;
for (let j = 0; j < H; j++)
  for (let i = 0; i < W; i++) {
    const k = (j * W + i) * 4;
    const c = (Math.floor(i / 8) + Math.floor(j / 8)) % 2 ? 150 : 175;
    o.data[k] = rgb ? rgb[0]! : c;
    o.data[k + 1] = rgb ? rgb[1]! : c;
    o.data[k + 2] = rgb ? rgb[2]! : c + 20;
    o.data[k + 3] = 255;
  }
imgs.forEach((im, n) => {
  const [ox, oy] = at[n]!;
  for (let j = 0; j < im.height * S; j++)
    for (let i = 0; i < im.width * S; i++) {
      const s = (Math.floor(j / S) * im.width + Math.floor(i / S)) * 4;
      if (im.data[s + 3]! < 128) continue;
      const k = ((oy + j) * W + ox + i) * 4;
      o.data[k] = im.data[s]!;
      o.data[k + 1] = im.data[s + 1]!;
      o.data[k + 2] = im.data[s + 2]!;
    }
});
writeFileSync(out!, PNG.sync.write(o));
console.log(`${W}x${H}`);

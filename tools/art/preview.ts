// Contact sheet of all twelve faces drawn from the real maps with the generated tiles, to
// review the tilesets without starting the game.  tsx art/preview.ts <out.png> [scale]
import { FACE_SIZE, defaultEnv } from '../../shared/src/index';
import { Img } from './img';
import { FLOOR_WEIGHTED, TILE_FRAMES } from './tiles';

const ASSETS = new URL('../../client/public/assets/', import.meta.url).pathname;
const T = 16;
/** One face plus its 8px gutter. */
const CELL = FACE_SIZE * T + 8;
const hash = (f: number, x: number, y: number) => ((f * 73856093) ^ (x * 19349663) ^ (y * 83492791)) >>> 0;

const [, , out = 'preview.png', scale = '2'] = process.argv;
const sheet = new Img(6 * CELL + 8, 2 * CELL + 8, '#ffffff');
(['out', 'in'] as const).forEach((side, row) => {
  for (const face of [1, 2, 3, 4, 5, 6] as const) {
    const tiles = Img.load(`${ASSETS}tiles/${side}-${face}.png`);
    const map = defaultEnv.world[side][face];
    for (let y = 0; y < FACE_SIZE; y++)
      for (let x = 0; x < FACE_SIZE; x++) {
        const kind = map.tiles[y]![x]!;
        const list = kind === 'floor' ? FLOOR_WEIGHTED : TILE_FRAMES[kind];
        const f = list[hash(face, x, y) % list.length]!;
        sheet.blit(tiles, 8 + (face - 1) * CELL + x * T, 8 + row * CELL + y * T, (f % 8) * T, Math.floor(f / 8) * T, T, T);
      }
  }
});
sheet.scale(Number(scale)).save(out);

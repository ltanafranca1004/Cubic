import { FACE_SIZE, TILE_PX, defaultEnv, screenToCanon, type FaceId, type Vec } from '@cubic/shared';
import { isTall, propAt, propCell, shoreMask } from './decor';
import { PROP_COLS, PROP_H, PROP_W, WATER_CELL, waterRow, type PropName } from './sheet';

// DRESSING A FACE. Draws the biome layer of an outside face onto the game's canvas: the
// water with its banks, then every prop, top row first so a tree stands in front of what
// is behind it. It is part of the painted face, so it turns with the cube in a transition
// and looks the same in WebGL and in Canvas (plain drawImage, whole pixels, no blending).
//
// Everything here is worked out in SCREEN space: the face may be shown turned, a tree is
// always drawn upright, and a bank is drawn on the side of the screen the land is on.

export interface BiomeSheets {
  props: CanvasImageSource;
  water: CanvasImageSource;
}

const T = TILE_PX;

let shown = 0;
/** The animation tick of the face painted last: what is on screen now. The ambience layer draws its overlays with the same one. */
export const shownTick = (): number => shown;

/** The prop on a screen tile of an outside face, with the sheet cell to draw now. */
export function propOnScreen(face: FaceId, up: Vec, sx: number, sy: number, tick: number, reduceMotion: boolean): { prop: PropName; cell: number; tall: boolean } | null {
  if (sx < 0 || sy < 0 || sx >= FACE_SIZE || sy >= FACE_SIZE) return null;
  const tiles = defaultEnv.world.out[face].tiles;
  const [x, y] = screenToCanon('out', face, up, sx, sy);
  const prop = propAt(tiles, face, x, y);
  return prop ? { prop, cell: propCell(prop, tick, sx, sy, reduceMotion), tall: isTall(prop) } : null;
}

/** Water moves at half the speed of the game's animation tick: a slow shimmer. */
const waterFrame = (tick: number, reduceMotion: boolean) => (reduceMotion ? 0 : Math.floor(tick / 2));

export function dressFace(g: CanvasRenderingContext2D, sheets: BiomeSheets, face: FaceId, up: Vec, tick: number, reduceMotion: boolean): void {
  shown = tick;
  const tiles = defaultEnv.world.out[face].tiles;
  const row = waterRow(face, waterFrame(tick, reduceMotion));
  for (let sy = 0; sy < FACE_SIZE; sy++) {
    for (let sx = 0; sx < FACE_SIZE; sx++) {
      const [x, y] = screenToCanon('out', face, up, sx, sy);
      if (tiles[y]?.[x] !== 'water') continue;
      g.drawImage(sheets.water, shoreMask(tiles, face, up, sx, sy) * WATER_CELL, row * WATER_CELL, WATER_CELL, WATER_CELL, sx * T, sy * T, T, T);
    }
  }
  for (let sy = 0; sy < FACE_SIZE; sy++) {
    for (let sx = 0; sx < FACE_SIZE; sx++) {
      const p = propOnScreen(face, up, sx, sy, tick, reduceMotion);
      if (!p) continue;
      // the cell's lower half is this tile, its upper half hangs over the tile above
      g.drawImage(sheets.props, (p.cell % PROP_COLS) * PROP_W, Math.floor(p.cell / PROP_COLS) * PROP_H, PROP_W, PROP_H, sx * T, sy * T + T - PROP_H, PROP_W, PROP_H);
    }
  }
}

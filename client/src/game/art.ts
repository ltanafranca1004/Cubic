import type Phaser from 'phaser';
import { TILE_PX, type FaceId, type Side, type TileKind, type Vec } from '@cubic/shared';
import { drawPuzzleItem, drawPuzzleObject } from './puzzleArt';

// ART. The scene asks an ArtProvider for texture keys and never draws pixels itself, so a
// provider backed by real tilesets (assets/manifest.json) can replace CodeArt later
// without touching the scene.

export interface ArtProvider {
  /** Terrain tile. x,y are canonical (for per-tile variation); frame 0-3 animates. */
  tile(side: Side, face: FaceId, kind: TileKind, x: number, y: number, frame: number): string;
  /** Map / puzzle object by type and state. */
  object(side: Side, type: string, state: string | undefined, frame: number): string;
  item(kind: string): string;
  player(side: Side, step: number): string;
  /** One frame of the side's character sheet by index (row * columns + column), or null if there is no sheet. */
  playerFrame?(side: Side, index: number): string | null;
  /**
   * The biome layer of a face (water banks, trees, tall grass...), drawn over the terrain
   * tiles and under the objects. `up` is the face's screen-up: props are drawn upright.
   */
  dress?(g: CanvasRenderingContext2D, side: Side, face: FaceId, up: Vec, frame: number): void;
}

type G = CanvasRenderingContext2D;
const px = (g: G, x: number, y: number, w: number, h: number, c: string) => {
  g.fillStyle = c;
  g.fillRect(x, y, w, h);
};
const hash = (f: number, x: number, y: number) => ((f * 73856093) ^ (x * 19349663) ^ (y * 83492791)) >>> 0;

export const OUT_BASE: Record<FaceId, string> = { 1: '#7BC96F', 2: '#E3C27A', 3: '#6E5A55', 4: '#E8F0F5', 5: '#6FAF62', 6: '#9AA7A0' };
export const IN_BASE: Record<FaceId, string> = { 1: '#1B2233', 2: '#211C33', 3: '#2E1C1C', 4: '#182A30', 5: '#1C2420', 6: '#22182E' };
const OUT_SPECK: Record<FaceId, string> = { 1: '#69B25E', 2: '#CFA960', 3: '#5A4844', 4: '#C9D6DE', 5: '#5E9A53', 6: '#87938D' };
const T = TILE_PX;

function floor(g: G, side: Side, face: FaceId, variant: number) {
  if (side === 'out') {
    px(g, 0, 0, T, T, OUT_BASE[face]);
    const h = hash(face, variant, 7);
    for (let i = 0; i < 3; i++) px(g, ((h >> (i * 4)) % 14) + 1, ((h >> (i * 4 + 2)) % 14) + 1, 1, 1, OUT_SPECK[face]);
  } else {
    px(g, 0, 0, T, T, IN_BASE[face]);
    px(g, T - 1, 0, 1, T, 'rgba(255,255,255,.05)');
    px(g, 0, T - 1, T, 1, 'rgba(255,255,255,.05)');
  }
}

function terrain(g: G, side: Side, face: FaceId, kind: TileKind, variant: number, frame: number) {
  floor(g, side, face, variant);
  if (kind === 'wall') {
    if (side === 'in') {
      px(g, 0, 0, T, T, '#3A4560');
      px(g, 0, 0, T, 3, '#56648A');
      px(g, 0, 13, T, 3, '#2A3248');
    } else if (face === 5) {
      // a little mountain
      px(g, 1, 11, 14, 4, '#6A6F78');
      px(g, 3, 7, 10, 4, '#7A7F88');
      px(g, 5, 4, 6, 3, '#8A8F98');
      px(g, 6, 2, 3, 3, '#EEF2F3');
    } else {
      px(g, 1, 2, 14, 13, '#5E636B');
      px(g, 1, 1, 13, 12, '#8A8F98');
      px(g, 2, 2, 5, 2, '#B3B8C0');
    }
  } else if (kind === 'tree') {
    px(g, 7, 11, 2, 4, '#6B4A2B');
    px(g, 3, 4, 10, 7, '#2F7D45');
    px(g, 5, 2, 6, 2, '#2F7D45');
    px(g, 5, 4, 3, 2, '#3E9A56');
    if (face === 4) px(g, 5, 2, 6, 2, '#F4F8FA');
  } else if (kind === 'water') {
    px(g, 0, 0, T, T, '#4FA4E0');
    px(g, ((frame * 3) % 12) + 1, 4, 4, 1, '#8CCBF2');
    px(g, ((frame * 5 + 6) % 12) + 1, 10, 4, 1, '#8CCBF2');
  }
}

function object(g: G, side: Side, type: string, state: string | undefined, frame: number) {
  // the co-op puzzle objects (keypad, buttons, each face's own things): ./puzzleArt
  if (drawPuzzleObject((x, y, w, h, c) => px(g, x, y, w, h, c), type, state)) return;
  switch (type) {
    case 'plate':
      if (side === 'out') {
        px(g, 2, 2, 12, 12, '#7E8A94');
        px(g, 3, 3, 10, 10, state === 'on' ? '#E6EEF4' : '#B8C3CC');
      } else {
        px(g, 2, 2, 12, 12, '#F2C14E');
        px(g, 4, 4, 8, 8, state === 'on' ? '#FFE39A' : '#6B5420');
      }
      break;
    case 'door':
      if (state === 'open') {
        px(g, 0, 0, 3, T, '#6B3A1A');
        px(g, 13, 0, 3, T, '#6B3A1A');
      } else {
        px(g, 0, 0, T, T, '#3B2412');
        for (let i = 1; i < T; i += 4) px(g, i, 0, 2, T, '#B5652B');
        px(g, 0, 7, T, 2, '#8A4A1F');
      }
      break;
    case 'crystal':
      if (state === 'taken') {
        px(g, 5, 12, 6, 1, 'rgba(0,0,0,.2)');
        break;
      }
      px(g, 7, 2, 2, 2, '#FFC2F2');
      px(g, 5, 4, 6, 2, '#FF5FD7');
      px(g, 4, 6, 8, 3, '#E23FBF');
      px(g, 5, 9, 6, 2, '#B0228F');
      px(g, 7, 11, 2, 2, '#B0228F');
      if (frame % 2) px(g, 12, 3, 1, 1, '#fff');
      break;
    case 'portal': {
      const open = state === 'open';
      px(g, 0, 0, T, T, open ? '#4E2390' : '#2C2240');
      if (open) {
        for (let i = 0; i < 4; i++) {
          const a = (frame * Math.PI) / 8 + (i * Math.PI) / 2;
          px(g, 7 + Math.round(Math.cos(a) * 5), 7 + Math.round(Math.sin(a) * 5), 2, 2, '#E3C6FF');
        }
        px(g, 6, 6, 4, 4, '#C08CFF');
      } else px(g, 6, 6, 4, 4, '#4A3A66');
      break;
    }
    case 'target':
      // a pot
      px(g, 4, 6, 8, 2, '#C9743A');
      px(g, 5, 8, 6, 5, '#A85A28');
      px(g, 6, 13, 4, 1, '#7A3F1A');
      px(g, 5, 7, 6, 1, '#3B2412');
      break;
    default:
      // unknown object type: an obvious marker so missing art is easy to spot
      px(g, 3, 3, 10, 10, '#FF5FD7');
      px(g, 4, 4, 8, 8, '#2A1030');
      px(g, 7, 6, 2, 3, '#FF5FD7');
      px(g, 7, 10, 2, 1, '#FF5FD7');
  }
}

function item(g: G, kind: string) {
  // the battery and the flowers: ./puzzleArt/items.ts
  if (drawPuzzleItem((x, y, w, h, c) => px(g, x, y, w, h, c), kind)) return;
  if (kind === 'rose') {
    px(g, 7, 8, 1, 6, '#2F7D45');
    px(g, 8, 10, 2, 1, '#3E9A56');
    px(g, 5, 4, 5, 4, '#D9364B');
    px(g, 6, 3, 3, 1, '#F06A7C');
    px(g, 7, 5, 1, 2, '#8E1D2E');
  } else if (kind === 'key') {
    px(g, 4, 5, 4, 4, '#F2C14E');
    px(g, 5, 6, 2, 2, '#6B5420');
    px(g, 8, 7, 5, 1, '#F2C14E');
    px(g, 11, 8, 1, 2, '#F2C14E');
  } else {
    // generic bundle
    px(g, 4, 6, 8, 7, '#A8743A');
    px(g, 5, 5, 6, 1, '#6B4520');
    px(g, 7, 6, 2, 7, '#6B4520');
  }
}

// 8x8 sprite at 2px per cell: h hair/hat, f face, e eyes, b body, l legs.
const BODY = ['..hhhh..', '.hhhhhh.', '.hffffh.', '..fefe..', '.bbbbbb.', 'b.bbbb.b'];
const LEGS = [
  ['..l..l..', '.ll..ll.'],
  ['...ll...', '..l..l..'],
];
const PALETTES: Record<Side, Record<string, string>> = {
  out: { h: '#D9573B', f: '#F2C29B', e: '#1A1A1A', b: '#2D5BA8', l: '#3B2F2F' },
  in: { h: '#F2C14E', f: '#FFE7B0', e: '#3A2A10', b: '#C98B2A', l: '#6B4A1A' },
};

function player(g: G, side: Side, step: number) {
  const rows = [...BODY, ...LEGS[step % 2]!];
  rows.forEach((row, r) => [...row].forEach((ch, c) => ch !== '.' && px(g, c * 2, r * 2, 2, 2, PALETTES[side][ch]!)));
}

/** Placeholder art, drawn in code into 16x16 canvas textures (cached by key). */
export class CodeArt implements ArtProvider {
  constructor(private textures: Phaser.Textures.TextureManager) {}

  private make(key: string, draw: (g: G) => void): string {
    if (!this.textures.exists(key)) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = T;
      draw(canvas.getContext('2d')!);
      this.textures.addCanvas(key, canvas);
    }
    return key;
  }

  tile(side: Side, face: FaceId, kind: TileKind, x: number, y: number, frame: number): string {
    const variant = hash(face, x, y) % 6;
    const f = kind === 'water' ? frame % 4 : 0;
    return this.make(`t:${side}:${face}:${kind}:${variant}:${f}`, (g) => terrain(g, side, face, kind, variant, f));
  }

  object(side: Side, type: string, state: string | undefined, frame: number): string {
    const f = type === 'portal' ? frame % 4 : type === 'crystal' ? frame % 2 : 0;
    return this.make(`o:${side}:${type}:${state ?? ''}:${f}`, (g) => object(g, side, type, state, f));
  }

  item(kind: string): string {
    return this.make(`i:${kind}`, (g) => item(g, kind));
  }

  player(side: Side, step: number): string {
    return this.make(`p:${side}:${step % 2}`, (g) => player(g, side, step));
  }
}

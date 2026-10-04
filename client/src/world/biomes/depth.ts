import { FACE_SIZE, canonToScreen, defaultEnv, type FaceId, type Side, type Vec } from '@cubic/shared';
import { isTall, propAt } from './decor';

// DEPTH. Who is in front of whom between the turtle and the tall props (trees, pines,
// palms, cacti, the snowman, stalagmites: TALL in ./sheet.ts), and which props fade so the
// turtle behind them stays easy to see. Pure math: no Phaser, no DOM.
//
// Everything is in SCREEN tiles, after the face's view rotation: props stand upright on
// screen whichever way the face is turned. The rule is the one of any top-down game:
// whatever is lower on the screen is drawn in front. A tall prop stands on its base tile
// and reaches over the tile above it; the turtle stands on one tile and the item it
// carries rides over the tile above. A tall prop always stands on a solid tile, so the
// turtle is never on a prop's own base.

/** A faded prop is this opaque. */
export const FADE_ALPHA = 0.5;
/** How long a prop takes to fade and to come back. With reduce motion it is instant. */
export const PROP_FADE_MS = 150;

export interface Tile {
  sx: number;
  sy: number;
}

/** A tall prop of the face shown: its canonical tile (who it is) and its base tile on screen. */
export interface TallProp extends Tile {
  key: string;
  x: number;
  y: number;
}

/** The turtle on screen, and whether an item rides above its head. */
export interface Turtle extends Tile {
  carrying: boolean;
}

/** A prop's name for the fade: canonical, so it survives the view turning. */
export const propKey = (face: FaceId, x: number, y: number): string => `${face}:${x},${y}`;

const onFace = (t: Tile): boolean => t.sx >= 0 && t.sy >= 0 && t.sx < FACE_SIZE && t.sy < FACE_SIZE;

const cache = new Map<string, TallProp[]>();

/**
 * Every tall prop of a face as `side` sees it with `up` as screen-up, top row first (the
 * order they are painted in). The inside has no biome layer: nothing there is tall.
 */
export function tallProps(side: Side, face: FaceId, up: Vec): readonly TallProp[] {
  if (side !== 'out') return [];
  const id = `${face}:${up.join(',')}`;
  let list = cache.get(id);
  if (!list) {
    list = [];
    const tiles = defaultEnv.world.out[face].tiles;
    for (let y = 0; y < FACE_SIZE; y++)
      for (let x = 0; x < FACE_SIZE; x++) {
        const prop = propAt(tiles, face, x, y);
        if (!prop || !isTall(prop)) continue;
        const [sx, sy] = canonToScreen('out', face, up, x, y);
        list.push({ key: propKey(face, x, y), x, y, sx, sy });
      }
    list.sort((a, b) => a.sy - b.sy || a.sx - b.sx);
    cache.set(id, list);
  }
  return list;
}

/** The tiles a tall prop is drawn on: its base, and the tile above it. Off the face it is clipped, never wrapped. */
export function propTiles(p: Tile): Tile[] {
  return [{ sx: p.sx, sy: p.sy }, { sx: p.sx, sy: p.sy - 1 }].filter(onFace);
}

/** The tiles the turtle is drawn on: its own, and the one above when it carries an item. */
export function turtleTiles(t: Turtle): Tile[] {
  return [{ sx: t.sx, sy: t.sy }, ...(t.carrying ? [{ sx: t.sx, sy: t.sy - 1 }] : [])].filter(onFace);
}

/** The sort: a prop is in front of the turtle when its base is on a lower screen row. The carried item sorts with the turtle. */
export const inFront = (prop: Tile, turtle: Tile): boolean => prop.sy > turtle.sy;

/** Do the prop and the turtle (with its item) share a tile? */
export function overlaps(prop: Tile, turtle: Turtle): boolean {
  const mine = turtleTiles(turtle);
  return propTiles(prop).some((p) => mine.some((t) => t.sx === p.sx && t.sy === p.sy));
}

/**
 * The props that fade: the ones drawn in front of the turtle that cover it or its item. A
 * prop behind the turtle hides nothing (the turtle is drawn over it) and keeps its colour.
 */
export function fadingProps<P extends Tile>(turtle: Turtle, props: readonly P[]): P[] {
  return props.filter((p) => inFront(p, turtle) && overlaps(p, turtle));
}

/**
 * The props whose crown hangs over one of `tiles` (an item lying on the floor): the tall
 * props based on the tile right below. Such an item is drawn UNDER the crown, like the
 * turtle would be, and the prop stays faded for as long as it lies there, so it can be found.
 */
export function propsOver<P extends Tile>(tiles: readonly Tile[], props: readonly P[]): P[] {
  return props.filter((p) => p.sy > 0 && tiles.some((t) => t.sx === p.sx && t.sy === p.sy - 1));
}

/**
 * The props taken out of the painted face and drawn over the turtle instead: every prop
 * that is `faded` (fading, or still on its way back) and in front of the turtle, and with
 * each of them the tall props standing right below it in the same column, because those are in front of IT and would
 * otherwise end up under its trunk. In paint order: top row first.
 */
export function liftedProps<P extends Tile>(props: readonly P[], faded: (p: P) => boolean, turtle?: Tile): P[] {
  // a faded prop BEHIND the turtle (it hides an item, not the turtle) stays in the painted face, faded there
  const lifted = new Set<P>(props.filter((p) => faded(p) && (!turtle || inFront(p, turtle))));
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of props) {
      if (lifted.has(p)) continue;
      if (![...lifted].some((l) => l.sx === p.sx && l.sy === p.sy - 1)) continue;
      lifted.add(p);
      grew = true;
    }
  }
  return props.filter((p) => lifted.has(p)).sort((a, b) => a.sy - b.sy || a.sx - b.sx);
}

/**
 * How opaque each prop is right now. `aim` says which props should be faded; `step` moves
 * every prop towards its goal, so a prop the turtle walked away from comes back by itself,
 * also on a face that is no longer the one shown. Props not listed are fully opaque.
 */
export class PropFades {
  private alphas = new Map<string, number>();
  private goals = new Set<string>();

  /**
   * The props to fade from now on (keys): every other one goes back to full. The ones in
   * `settled` (an item lies under their crown) are faded at once when they are new here:
   * nobody watched them fade, the face was just entered or the item just appeared.
   */
  aim(keys: Iterable<string>, settled: Iterable<string> = []): void {
    this.goals = new Set(keys);
    for (const key of settled) {
      this.goals.add(key);
      if (!this.alphas.has(key)) this.alphas.set(key, FADE_ALPHA);
    }
    for (const key of this.goals) if (!this.alphas.has(key)) this.alphas.set(key, 1);
  }

  /** `ms` went by. With `instant` (reduce motion) every prop is at its goal at once. */
  step(ms: number, instant: boolean): void {
    const d = instant ? 1 : ((1 - FADE_ALPHA) * Math.max(0, ms)) / PROP_FADE_MS;
    for (const [key, alpha] of this.alphas) {
      const next = this.goals.has(key) ? Math.max(FADE_ALPHA, alpha - d) : Math.min(1, alpha + d);
      if (next >= 1 && !this.goals.has(key)) this.alphas.delete(key);
      else this.alphas.set(key, next);
    }
  }

  alpha(key: string): number {
    return this.alphas.get(key) ?? 1;
  }

  /** Is the prop faded at all, or about to be? Then it is drawn over the turtle. */
  faded(key: string): boolean {
    return this.alphas.has(key);
  }

  /** Is any prop still moving towards its goal? */
  get moving(): boolean {
    for (const [key, alpha] of this.alphas) if (alpha !== (this.goals.has(key) ? FADE_ALPHA : 1)) return true;
    return false;
  }

  /** Everything not fully opaque, for the dev hook and the tests. */
  entries(): [string, number][] {
    return [...this.alphas];
  }

  clear(): void {
    this.alphas.clear();
    this.goals.clear();
  }
}

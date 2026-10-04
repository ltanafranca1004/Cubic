import { loadWorld, parseStringMap, type FaceId, type GameEnv, type MapObject, type PuzzleModule, type Side, type TileRef } from '../src/index';
import { at } from '../src/puzzles/util';

// A SMALL TEST WORLD for the engine tests (game, bot, dev, signals). Not a test file.
// The engine tests play this instead of the shipped puzzles, so they keep passing when a
// real puzzle changes. Everything not listed here is the shipped terrain without objects.
//
//  face 1 outside: a walled crystal behind a door, and the item "rose" (kind rose)
//  face 1 inside:  a plate. Standing on it opens the door (puzzle "plate-door")
//  face 6 outside: the target "pot" (accepts rose). Placing the rose solves "rose-pot"
//  face 6 both sides, only with { portal: true }: four portal tiles (the old win rule)

const OUT_1 = [
  'T..........T',
  '...T.....T..',
  '............',
  '............',
  '....###.....',
  '....#.#.....',
  '....#.#.....',
  '........~~..',
  '.......~~~T.',
  '............',
  '............',
  'T..........T',
];
const BLANK: string[] = Array(12).fill('............');
const IN_1 = BLANK.map((r, y) => (y === 6 ? '...#........' : r));

const object = (type: string, x: number, y: number, name = '', props: MapObject['props'] = {}): MapObject => ({ type, x, y, name, props });

/** Where the fixture's things are (canonical tiles). */
export const FIX = {
  crystal: { face: 1, x: 5, y: 5 },
  door: { face: 1, x: 5, y: 6 },
  plate: { face: 1, x: 8, y: 3 },
  rose: { face: 1, x: 2, y: 9 },
  pot: { face: 6, x: 8, y: 8 },
  portal: { face: 6, x: 5, y: 5 },
} satisfies Record<string, TileRef>;

interface PlateState {
  pressed: boolean;
  taken: boolean;
}

/** Inside stands on the plate; while they do, the door outside is open. Outside takes the crystal. */
export const plateDoor: PuzzleModule<PlateState> = {
  id: 'plate-door',
  face: 1,
  init: () => ({ pressed: false, taken: false }),
  // Stays open once solved, so nobody gets sealed in.
  isBlocked: (s, _ctx, side, tile) => side === 'out' && at(FIX.door, tile) && !s.pressed && !s.taken,
  onEnter(s, ctx, side, tile) {
    if (side === 'in' && at(FIX.plate, tile)) {
      s.pressed = true;
      ctx.emit('door-open');
    }
    if (side === 'out' && at(FIX.crystal, tile)) s.taken = true;
  },
  onLeave(s, ctx, side, tile) {
    if (side === 'in' && at(FIX.plate, tile)) {
      s.pressed = false;
      if (!s.taken) ctx.emit('door-close');
    }
  },
  isSolved: (s) => s.taken,
  visible(s, _ctx, side) {
    if (side === 'in') return [{ type: 'plate', x: FIX.plate.x, y: FIX.plate.y, state: s.pressed ? 'on' : 'off' }];
    return [
      { type: 'door', x: FIX.door.x, y: FIX.door.y, state: s.pressed || s.taken ? 'open' : 'closed' },
      { type: 'crystal', x: FIX.crystal.x, y: FIX.crystal.y, state: s.taken ? 'taken' : 'idle' },
    ];
  },
  objective: (s, _ctx, side) => (side === 'in' ? 'A plate on the floor.' : s.pressed ? 'The door is open. Go!' : 'A crystal sits behind a sealed door.'),
};

/** Outside carries the rose from face 1 to the pot on face 6. */
export const rosePot: PuzzleModule<{ done: boolean }> = {
  id: 'rose-pot',
  face: 6,
  init: () => ({ done: false }),
  onItem(s, ctx, ev) {
    if (ev.kind === 'placed' && ev.item.kind === 'rose' && ev.target?.name === 'pot') {
      s.done = true;
      ctx.emit('bloom');
    }
  },
  isSolved: (s) => s.done,
};

/**
 * The fixture world with its two puzzles. `portal: true` adds the portal on face 6, so the
 * game is only won once both players stand on it (the old rule); without it the last solve wins.
 */
export function fixtureEnv(opts: { portal?: boolean } = {}): GameEnv {
  const world = loadWorld();
  for (const side of ['out', 'in'] as Side[]) for (const face of [1, 2, 3, 4, 5, 6] as FaceId[]) world[side][face].objects = [];
  world.out[1] = parseStringMap('out', 1, OUT_1);
  world.out[1].objects = [object('door', FIX.door.x, FIX.door.y), object('crystal', FIX.crystal.x, FIX.crystal.y), object('item', FIX.rose.x, FIX.rose.y, 'rose', { kind: 'rose' })];
  world.in[1] = parseStringMap('in', 1, IN_1);
  world.in[1].objects = [object('plate', FIX.plate.x, FIX.plate.y)];
  world.in[6] = parseStringMap('in', 6, BLANK);
  world.out[6].objects = [object('target', FIX.pot.x, FIX.pot.y, 'pot', { accepts: 'rose' })];
  if (opts.portal) {
    for (const side of ['out', 'in'] as Side[]) for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) world[side][6].objects.push(object('portal', FIX.portal.x + dx, FIX.portal.y + dy));
  }
  return { world, puzzles: [plateDoor, rosePot] };
}

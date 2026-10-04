import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FACE_SIZE, SPAWN, canonToScreen, createGame, defaultEnv, isBlocked, objectiveFor, objectsOn, onRing, visibleObjects, type GameState } from '../src/index';
import { CODE_DIGITS, CODE_FONT, CODE_H, CODE_LOOKS, CODE_MARK, CODE_ORIGIN, CODE_W, readCode } from '../src/puzzles/hiddenCode';
import { solver, type Solver } from './harness';

// Hidden Code (face 1). Run just this file: npx tsx --test shared/test/hidden-code.test.ts

const FACE = 1;
const seen = (state: GameState, side: 'out' | 'in') => visibleObjects(state, side, FACE);
/** What the outside player reads in the grass. */
const codeIn = (state: GameState) => readCode(seen(state, 'out'))!;
const display = (state: GameState) =>
  seen(state, 'in')
    .filter((o) => o.type === 'display')
    .sort((a, b) => b.x - a.x)
    .map((o) => o.state);
/** The inside player steps on each key and presses E. */
const type = (t: Solver, keys: string[]) =>
  keys.flatMap((name) => {
    t.go('in', t.find('in', FACE, 'key', name));
    return t.interact('in');
  });
/** A 3-digit code that is not this game's. */
const wrong = (code: string) => `${code.slice(0, 2)}${(Number(code[2]) + 1) % 10}`;

test('hidden-code: the inside player types what the outside player reads, and ENTER solves it', () => {
  const state = createGame(7);
  const t = solver(state);
  const code = codeIn(state);
  assert.match(code, /^[1-9][0-9]{2}$/);

  const typed = type(t, [...code]);
  assert.equal(typed.filter((e) => e.type === 'puzzle' && e.name === 'key').length, CODE_DIGITS);
  assert.deepEqual(display(state), [...code], 'the display shows what was typed');
  assert.ok(!state.solved.includes(FACE), 'not before ENTER');

  const evs = type(t, ['enter']);
  assert.ok(evs.some((e) => e.type === 'puzzle' && e.name === 'chime'));
  assert.ok(state.solved.includes(FACE));
  assert.equal(state.strikes, 0);
  assert.deepEqual(display(state), [...code].map((d) => `${d}-green`));
  for (const key of seen(state, 'in').filter((o) => o.type === 'key')) assert.match(key.state!, /-green$/);

  // locked: more presses change nothing
  const before = JSON.stringify(state.puzzles);
  type(t, ['1', 'enter']);
  assert.equal(JSON.stringify(state.puzzles), before);
  assert.equal(state.strikes, 0);
});

test('hidden-code: a wrong code is a strike and clears the display; the right one still works after', () => {
  const state = createGame(7);
  const t = solver(state);
  const code = codeIn(state);

  const evs = type(t, [...wrong(code), 'enter']);
  assert.equal(state.strikes, 1);
  assert.ok(evs.some((e) => e.type === 'strike' && e.side === 'in'));
  assert.deepEqual(display(state), ['empty', 'empty', 'empty']);
  assert.ok(!state.solved.includes(FACE));

  // too short is wrong too; ENTER on an empty display is nothing
  type(t, [code[0]!, 'enter']);
  assert.equal(state.strikes, 2);
  type(t, ['enter']);
  assert.equal(state.strikes, 2);

  // a fourth digit is not taken
  type(t, [...code, '5']);
  assert.deepEqual(display(state), [...code]);
  type(t, ['enter']);
  assert.ok(state.solved.includes(FACE));
  assert.equal(state.strikes, 2);
});

test('hidden-code: only the inside player can type', () => {
  const state = createGame(7);
  const t = solver(state);
  for (const key of objectsOn(defaultEnv.world, 'in', FACE, 'key')) {
    t.go('out', { face: FACE, x: key.x, y: key.y });
    t.interact('out');
  }
  assert.deepEqual(display(state), ['empty', 'empty', 'empty']);
  assert.equal(state.strikes, 0);
});

test('hidden-code: each side sees only its own half', () => {
  for (const solved of [false, true]) {
    const state = createGame(11);
    if (solved) type(solver(state), [...codeIn(state), 'enter']);
    const out = seen(state, 'out');
    const inn = seen(state, 'in');
    assert.ok(out.length > 0 && out.every((o) => o.type === CODE_MARK), 'outside: the number and nothing else');
    assert.ok(out.every((o) => (CODE_LOOKS as readonly string[]).includes(o.state!)));
    assert.equal(inn.filter((o) => o.type === CODE_MARK).length, 0, 'inside never sees the number');
    assert.equal(readCode(inn), null);
    assert.deepEqual(inn.map((o) => o.type).sort(), [...Array(11).fill('key'), ...Array(CODE_DIGITS).fill('display')].sort());
  }
  // nothing an idle keypad shows depends on the code
  const idle = (seed: number) => JSON.stringify(seen(createGame(seed), 'in'));
  assert.equal(idle(1), idle(2));
  const state = createGame(11);
  assert.match(objectiveFor(state, 'out'), /upright/);
  assert.match(objectiveFor(state, 'in'), /ENTER/);
  assert.ok(!objectiveFor(state, 'in').includes(codeIn(state)));
});

test('hidden-code: the number is seeded: games differ, the same seed agrees, every digit turns up', () => {
  const codes = Array.from({ length: 200 }, (_, seed) => codeIn(createGame(seed)));
  assert.ok(new Set(codes).size > 100, 'codes repeat too much');
  assert.equal(codeIn(createGame(1234)), codeIn(createGame(1234)));
  assert.notEqual(codeIn(createGame(1)), codeIn(createGame(2)));
  for (const code of codes) assert.match(code, /^[1-9][0-9]{2}$/);
  for (let d = 0; d < 10; d++) assert.ok(codes.some((c) => c.slice(1).includes(String(d))), `digit ${d} never appears`);
});

test('hidden-code: the font is ten different 3x5 glyphs', () => {
  assert.equal(CODE_FONT.length, 10);
  for (const rows of CODE_FONT) assert.deepEqual([rows.length, ...rows.map((r) => r.length)], [5, 3, 3, 3, 3, 3]);
  assert.equal(new Set(CODE_FONT.map((rows) => rows.join('/'))).size, 10);
});

test('hidden-code: the number lies on open floor, off the spawn tiles, and blocks nothing', () => {
  assert.deepEqual([CODE_W, CODE_H], [11, 5]);
  const { tiles } = defaultEnv.world.out[FACE];
  for (let y = CODE_ORIGIN.y; y < CODE_ORIGIN.y + CODE_H; y++)
    for (let x = CODE_ORIGIN.x; x < CODE_ORIGIN.x + CODE_W; x++) {
      assert.ok(x >= 0 && x < FACE_SIZE && y >= 1 && y < FACE_SIZE - 1);
      assert.equal(tiles[y]![x], 'floor', `${x},${y}`);
      assert.ok(!(x === SPAWN.out.x && y === SPAWN.out.y), 'the outside spawn is a digit tile');
    }
  for (let seed = 0; seed < 40; seed++) {
    const state = createGame(seed);
    for (const o of seen(state, 'out')) {
      assert.ok(o.x >= CODE_ORIGIN.x && o.x < CODE_ORIGIN.x + CODE_W && o.y >= CODE_ORIGIN.y && o.y < CODE_ORIGIN.y + CODE_H, `seed ${seed}: ${o.x},${o.y} is outside the block`);
      assert.equal(isBlocked(state, 'out', { face: FACE, x: o.x, y: o.y }), false, 'the number is walked over');
    }
  }
  // the keypad is clear of the inside spawn and off the ring
  for (const o of defaultEnv.world.in[FACE].objects) {
    assert.ok(!onRing(o.x, o.y), `${o.type} ${o.name} is on the ring`);
    assert.ok(!(o.x === SPAWN.in.x && o.y === SPAWN.in.y));
  }
});

test('hidden-code: no ring tile is ever blocked, in any state', () => {
  const ringFree = (state: GameState, when: string) => {
    for (const side of ['out', 'in'] as const)
      for (let y = 0; y < FACE_SIZE; y++)
        for (let x = 0; x < FACE_SIZE; x++) if (onRing(x, y)) assert.equal(isBlocked(state, side, { face: FACE, x, y }), false, `${when}: ${side} ${x},${y}`);
  };
  const state = createGame(3);
  const t = solver(state);
  const code = codeIn(state);
  ringFree(state, 'fresh');
  type(t, [code[0]!]);
  ringFree(state, 'typing');
  type(t, [...wrong(code).slice(1), 'enter']);
  ringFree(state, 'after a strike');
  type(t, [...code, 'enter']);
  assert.ok(state.solved.includes(FACE));
  ringFree(state, 'solved');
});

test('hidden-code: on the inside screen the keypad reads like a phone and the display left to right', () => {
  const state = createGame(5);
  const up = state.players.in.pose.up;
  const screen = (o: { x: number; y: number }) => canonToScreen('in', FACE, up, o.x, o.y);
  const keys = objectsOn(defaultEnv.world, 'in', FACE, 'key');
  const rows = new Map<number, { sx: number; name: string }[]>();
  for (const k of keys) {
    const [sx, sy] = screen(k);
    rows.set(sy, [...(rows.get(sy) ?? []), { sx, name: k.name }]);
  }
  const read = [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r.sort((a, b) => a.sx - b.sx).map((k) => k.name).join(' '));
  assert.deepEqual(read, ['1 2 3', '4 5 6', '7 8 9', '0 enter']);

  type(solver(state), ['4', '2']);
  const cells = seen(state, 'in')
    .filter((o) => o.type === 'display')
    .sort((a, b) => screen(a)[0] - screen(b)[0])
    .map((o) => o.state);
  assert.deepEqual(cells, ['4', '2', 'empty']);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PUZZLE_SCRIPTS,
  agreeTurn,
  canonToScreen,
  createGame,
  decide,
  defaultEnv,
  devTeleport,
  newMind,
  objectsOn,
  observe,
  planAction,
  throughWall,
  upsOn,
  type FaceId,
  type LineKey,
} from '../src/index';
import { play } from './partnerSim';

// THE PUZZLE SCRIPTS (shared/src/bot/scripts), each against a simulated human who only does
// what the partner's lines ask (partnerSim.ts). Real moves through the engine, both sides.
//
// These tests are about puzzles as they are TODAY. Each one runs only if its puzzle id is
// in the game, so a puzzle that is removed or renamed skips its test instead of failing.
// When a puzzle's rules change, its script, the simulated human and its test here are the
// three things to update. The core (partner.test.ts) knows no puzzle and is not affected.

const SEED = 1_700_000_000_000;
const faceOf = (id: string): FaceId | undefined => defaultEnv.puzzles.find((p) => p.id === id)?.face;
const have = (...ids: string[]) => ids.every((id) => faceOf(id) !== undefined && PUZZLE_SCRIPTS.some((s) => s.id === id));
/** The simulated human knows exactly these five. */
const SIM = ['plate-door', 'glyph-code', 'mirror-maze', 'skylight', 'rose-pot'];
const wholeGame = have(...SIM) && defaultEnv.puzzles.length === SIM.length;

/** Lines that must be heard for the puzzle to have been solved by talking, per AI side. */
const PUZZLES: { id: string; needs?: string; out: LineKey[]; in: LineKey[] }[] = [
  { id: 'plate-door', out: ['plate-door.shut', 'plate-door.open'], in: ['plate-door.go', 'plate-door.on'] },
  { id: 'glyph-code', out: ['glyph-code.ready', 'glyph-code.going', 'glyph-code.next'], in: ['glyph-code.plate'] },
  { id: 'mirror-maze', out: ['mirror-maze.calib', 'mirror-maze.stepin'], in: ['mirror-maze.toDoor', 'mirror-maze.askCalib', 'mirror-maze.guide', 'mirror-maze.ok'] },
  { id: 'skylight', out: ['skylight.on', 'skylight.switch'], in: ['skylight.need', 'skylight.across1', 'skylight.crossing2'] },
  { id: 'rose-pot', needs: 'plate-door', out: ['rose-pot.take'], in: [] },
];

for (const p of PUZZLES) {
  for (const ai of ['out', 'in'] as const) {
    test(`${p.id}: the script does its half as the ${ai === 'out' ? 'OUTSIDE' : 'INSIDE'} player`, { skip: !have(p.id, ...(p.needs ? [p.needs] : [])) }, () => {
      const face = faceOf(p.id)!;
      const order = [...(p.needs ? [faceOf(p.needs)!] : []), face];
      for (let seed = 0; seed < 4; seed++) {
        const r = play(ai, { order, startAt: SEED + seed * 7919, until: (s) => s.solved.includes(face), maxMs: 5 * 60_000 });
        assert.ok(r.state.solved.includes(face), `seed ${seed}: not solved. ${r.decisions.at(-1)!.status}. Lines: ${r.lines.join(' ')}`);
        assert.equal(r.state.strikes, 0, `seed ${seed}: strikes`);
        for (const key of p[ai]) assert.ok(r.lines.includes(key), `seed ${seed}: never said ${key}. Lines: ${r.lines.join(' ')}`);
      }
    });
  }
}

test('glyph-code: the inside partner names one sign per step, the outside one walks once per sign typed', { skip: !have('glyph-code') }, () => {
  const face = faceOf('glyph-code')!;
  const inside = play('in', { order: [face], until: (s) => s.solved.includes(face) });
  const named = inside.lines.filter((k) => k.startsWith('glyph-code.sign.'));
  assert.ok(named.length > 0 && new Set(named).size > 1, named.join(' '));
  const outside = play('out', { order: [face], until: (s) => s.solved.includes(face) });
  assert.equal(outside.lines.filter((k) => k === 'glyph-code.going').length, outside.human.said.length); // the human typed signs, nothing else
});

test('mirror-maze: the outside partner calls one step per message, after one landmark answer', { skip: !have('mirror-maze') }, () => {
  const face = faceOf('mirror-maze')!;
  const r = play('out', { order: [face], until: (s) => s.solved.includes(face) });
  const calls = r.lines.filter((k) => k.startsWith('mirror-maze.go.'));
  assert.match(r.human.said[0]!, /^(up|down) (left|right)$/); // the one landmark answer
  assert.ok(r.human.said.slice(1).every((s) => s === 'yes'));
  assert.equal(calls.length, r.human.said.length - 2); // one call per "yes" after stepping in
});

test('mirror-maze: after a fall the stones move and the partner starts over from the doorway', { skip: !have('mirror-maze') }, () => {
  const face = faceOf('mirror-maze')!;
  const walking = play('in', { order: [face], mazeMistakes: 1, until: (s) => s.solved.includes(face) });
  assert.ok(walking.state.solved.includes(face));
  assert.equal(walking.state.strikes, 1);
  assert.ok(walking.lines.includes('mirror-maze.fellIn'));
  const calling = play('out', { order: [face], mazeMistakes: 1, until: (s) => s.solved.includes(face) });
  assert.ok(calling.state.solved.includes(face));
  assert.ok(calling.state.strikes >= 1);
  assert.ok(calling.lines.includes('mirror-maze.fell'));
});

test('mirror-maze: the trap floor is off limits to every walk, whatever asks for it', { skip: !have('mirror-maze') }, () => {
  const face = faceOf('mirror-maze')!;
  const s = createGame(SEED);
  devTeleport(s, 'out', face, SEED);
  devTeleport(s, 'in', face, SEED);
  const d = decide(newMind(), observe(s, 'in'), [], SEED);
  assert.ok(d.avoid.length > 10);
  // A model (or anything else) asking for the crystal gets no path.
  assert.ok('error' in planAction(s, 'in', { type: 'step_on', object: 'crystal' }, defaultEnv, undefined, d.avoid));
  // The same walk without the rule would go straight through.
  assert.ok('steps' in planAction(s, 'in', { type: 'step_on', object: 'crystal' }));
});

test('mirror-maze: the landmark question has one answer on this map', { skip: !have('mirror-maze') }, () => {
  // "Where is the crystal from the doorway: up left?" needs the crystal well off both axes.
  const face = faceOf('mirror-maze')!;
  const entry = objectsOn(defaultEnv.world, 'in', face, 'entry')[0]!;
  const crystal = objectsOn(defaultEnv.world, 'in', face, 'crystal')[0]!;
  assert.ok(Math.abs(crystal.x - entry.x) >= 3 && Math.abs(crystal.y - entry.y) >= 3, `entry ${entry.x},${entry.y} crystal ${crystal.x},${crystal.y}`);
});

test('skylight: the wrong pane first is sorted out by talking, without a strike', { skip: !have('skylight') }, () => {
  const face = faceOf('skylight')!;
  const r = play('in', { order: [face], wrongPaneFirst: true, until: (s) => s.solved.includes(face) });
  assert.ok(r.state.solved.includes(face));
  assert.equal(r.state.strikes, 0);
  assert.ok(r.lines.includes('skylight.other'));
  const out = play('out', { order: [face], until: (s) => s.solved.includes(face) });
  assert.ok(out.human.said.includes('go'));
  assert.equal(out.state.strikes, 0);
});

test('the whole game is won as either side, in any order, with or without "face N", with zero strikes', { skip: !wholeGame }, () => {
  const faces = defaultEnv.puzzles.map((p) => p.face);
  const orders = [faces, [...faces].reverse(), [...faces.slice(2), ...faces.slice(0, 2)]];
  for (const ai of ['out', 'in'] as const) {
    orders.forEach((order, i) => {
      for (const announce of [false, true]) {
        const r = play(ai, { order, announce, startAt: SEED + i * 104_729, maxMs: 15 * 60_000 });
        const what = `ai=${ai} order=${order.join('')} announce=${announce}`;
        assert.notEqual(r.state.wonAt, null, `${what}: not won, solved ${r.state.solved.join('')}. ${r.decisions.at(-1)!.status}`);
        assert.equal(r.state.strikes, 0, `${what}: strikes`);
        assert.ok(r.lines.includes('portal.in') && r.lines.includes('win'));
      }
    });
  }
});

test('a human who types like a person ("I think it shows a moon") is understood by the script alone', { skip: !wholeGame }, () => {
  for (const ai of ['out', 'in'] as const) {
    const r = play(ai, { chatty: true, maxMs: 15 * 60_000 });
    assert.notEqual(r.state.wonAt, null, `ai=${ai}: solved ${r.state.solved.join('')}`);
    assert.equal(r.state.strikes, 0);
  }
});

// ---------- the helpers scripts share ----------

test('through the wall: one landmark answer fixes the directions for every pair of views', () => {
  // The same wall seen from outside with one up and from inside with another: 16 pairs.
  const face: FaceId = 4;
  for (const outUp of upsOn(face)) {
    for (const inUp of upsOn(face)) {
      const outScreen = (x: number, y: number) => canonToScreen('out', face, outUp, x, y);
      const inScreen = (x: number, y: number) => canonToScreen('in', face, inUp, x, y);
      const vec = (f: (x: number, y: number) => [number, number], ax: number, ay: number, bx: number, by: number) => ({ col: f(bx, by)[0] - f(ax, ay)[0], row: f(bx, by)[1] - f(ax, ay)[1] });
      const seenIn = vec(inScreen, 3, 9, 8, 2);
      const answer = [seenIn.row < 0 ? 'up' : 'down', seenIn.col < 0 ? 'left' : 'right'] as const;
      const k = agreeTurn(vec(outScreen, 3, 9, 8, 2), answer);
      assert.notEqual(k, null);
      // Then every single step translates exactly.
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        assert.deepEqual(throughWall(vec(outScreen, 5, 5, 5 + dx, 5 + dy), k!), vec(inScreen, 5, 5, 5 + dx, 5 + dy));
      }
    }
  }
  assert.equal(agreeTurn({ col: 5, row: -7 }, ['up']), null); // half an answer is no answer
  assert.equal(agreeTurn({ col: 5, row: -7 }, ['up', 'down']), null);
});

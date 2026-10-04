import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { FACE_SIZE } from '@cubic/shared';
import { NARRATOR, NARRATOR_MAX, narratorLine } from '../src/content/narrator';
import {
  CAPTION_MS,
  CARD_MAX_MS,
  CARD_MIN_MS,
  CONTROLS_MAX_MS,
  HINT_GAP_MS,
  HINT_MS,
  HINT_TEXT,
  START_SETTLE_MS,
  atFaceEdge,
  createOnboarding,
  type GameSnapshot,
  type Onboarding,
} from '../src/ui/onboarding/rules';

// The hint rules are pure (no DOM, no Phaser), so they are tested here directly: once per
// session, what triggers each hint, what makes it fade, and "hints off".

const EDGE = FACE_SIZE - 1;
const game = (over: Partial<GameSnapshot> = {}): GameSnapshot => ({ id: 1, side: 'out', face: 1, x: 4, y: 4, gain: 1, solved: 0, won: false, ...over });

/** Drives the rules like the DOM layer does: one snapshot at a time, with a clock we own. */
function session(o: Onboarding = createOnboarding()) {
  let now = 1000;
  let g: GameSnapshot | null = game();
  let hints = true;
  return {
    o,
    set(over: Partial<GameSnapshot> | null) {
      g = over === null ? null : { ...(g ?? game()), ...over };
    },
    hints(on: boolean) {
      hints = on;
    },
    step(ms = 0, interacted = false) {
      now += ms;
      return o.step({ now, hints, game: g, interacted });
    },
  };
}

test('onboarding: a game starts with the side card, the controls and the narrator, and no context hint under the card', () => {
  const s = session();
  const v = s.step();
  assert.equal(v.card, 'out');
  assert.equal(v.controls, true);
  assert.equal(v.hint, null);
  assert.equal(v.caption, NARRATOR.intro.out[0]);
});

test('onboarding: the side card says ON outside and INSIDE inside, with the mirror line', () => {
  assert.equal(Object.values(HINT_TEXT.card.out).join(''), "You're ON the cube");
  assert.equal(Object.values(HINT_TEXT.card.in).join(''), "You're INSIDE the cube");
  assert.equal(HINT_TEXT.cardLine, 'Your partner is in the same spot on the other side. Their left is your right.');
  const s = session();
  s.set({ side: 'in' });
  assert.equal(s.step().card, 'in');
});

test('onboarding: the side card stays a moment after the first step, then goes; untouched it goes by itself', () => {
  const s = session();
  s.step();
  s.set({ x: 5 });
  assert.equal(s.step(200).card, 'out', 'a step right away does not take the card');
  assert.equal(s.step(CARD_MIN_MS).card, null, 'it goes once it has been up long enough');

  const idle = session();
  idle.step();
  assert.equal(idle.step(CARD_MAX_MS - 1).card, 'out');
  assert.equal(idle.step(1).card, null);
});

test('onboarding: the controls hint fades only after the player has moved AND interacted', () => {
  const s = session();
  s.step();
  assert.equal(s.step(100, true).controls, true, 'interacting alone is not enough');
  s.set({ x: 5 });
  assert.equal(s.step(100).controls, false, 'moved and interacted: gone');
  assert.equal(s.step(60_000).controls, false, 'and it does not come back');

  const walker = session();
  walker.step();
  walker.set({ y: 5 });
  assert.equal(walker.step(100).controls, true, 'moving alone is not enough');
  assert.equal(walker.step(100, true).controls, false);
});

test('onboarding: the controls hint lists every key of the brief and never sticks forever', () => {
  const keys = HINT_TEXT.controls.map((c) => `${c.keys.join('/')} ${c.does}`);
  assert.deepEqual(keys, ['WASD/Arrows move', 'E interact', 'Q drop', 'Enter chat', 'V talk', 'F ping']);
  const s = session();
  s.step();
  assert.equal(s.step(CONTROLS_MAX_MS - 1).controls, true);
  assert.equal(s.step(1).controls, false);
});

test('onboarding: the cube hint is the first context hint, once the card is gone', () => {
  const s = session();
  s.step();
  assert.equal(s.step(CARD_MAX_MS - 1).hint, null);
  assert.equal(s.step(1).hint, 'cube');
  assert.equal(s.step(HINT_MS - 1).hint, 'cube');
  assert.equal(s.step(1).hint, null, 'it goes after HINT_MS');
  assert.equal(s.step(60_000).hint, null, 'and is not shown twice');
});

/** A session past the side card and the cube hint. */
function settled() {
  const s = session();
  s.step();
  s.step(CARD_MAX_MS);
  s.step(HINT_MS);
  assert.equal(s.step(HINT_GAP_MS).hint, null);
  return s;
}

test('onboarding: the edge hint shows the first time the player stands on a face edge', () => {
  assert.equal(atFaceEdge(0, 4), true);
  assert.equal(atFaceEdge(4, EDGE), true);
  assert.equal(atFaceEdge(EDGE, 0), true);
  assert.equal(atFaceEdge(1, EDGE - 1), false);
  const s = settled();
  s.set({ x: EDGE - 1 });
  assert.equal(s.step(100).hint, null);
  s.set({ x: EDGE });
  assert.equal(s.step(100).hint, 'edge');
  assert.equal(HINT_TEXT.context.edge, 'Walk off the edge to fold onto the next face.');
  s.step(HINT_MS);
  s.set({ x: 4 });
  s.step(HINT_GAP_MS);
  s.set({ x: 0 });
  assert.equal(s.step(100).hint, null, 'once per session');
});

test('onboarding: folding onto the next face before the edge hint showed makes it unnecessary', () => {
  const s = session();
  s.step(); // the card is still up, so no context hint yet
  s.set({ face: 2, x: 0 });
  s.step(100);
  s.step(CARD_MAX_MS);
  s.step(HINT_MS); // the cube hint
  assert.equal(s.step(HINT_GAP_MS).hint, null, 'standing on the new face edge does not explain folding');
  assert.ok(s.o.seen().includes('edge'));
});

test('onboarding: the voice hint shows the first time the partner gets quieter, and only with a partner', () => {
  const s = settled();
  s.set({ gain: null }); // no partner, or voice off
  assert.equal(s.step(100).hint, null);
  s.set({ gain: 1 });
  assert.equal(s.step(100).hint, null);
  s.set({ gain: 0.35 });
  assert.equal(s.step(100).hint, 'voice');
  assert.equal(HINT_TEXT.context.voice, 'Your partner sounds farther away. Voice fades by face distance.');
  s.step(HINT_MS);
  s.set({ gain: 0 });
  assert.equal(s.step(HINT_GAP_MS).hint, null, 'once per session');
});

test('onboarding: one context hint at a time; a moment that passes while another is up comes again', () => {
  const s = session();
  s.step();
  s.set({ gain: 0.35 });
  assert.equal(s.step(CARD_MAX_MS).hint, 'cube', 'cube goes first');
  assert.equal(s.step(HINT_MS).hint, null, 'a breath between two hints');
  assert.equal(s.step(HINT_GAP_MS).hint, 'voice');
});

test('onboarding: every hint shows once per session, also across games', () => {
  const s = settled();
  s.set({ x: 6 });
  s.step(100, true); // controls done
  s.set({ id: 2, x: 4, y: 4 }); // play again
  const v = s.step(1000);
  assert.equal(v.card, null, 'the card for this side was already shown');
  assert.equal(v.controls, false);
  assert.equal(v.hint, null);
  assert.equal(v.caption, NARRATOR.intro.out[1], 'the narrator opens every game, with the next line');
  s.set({ id: 3, side: 'in' });
  assert.equal(s.step(60_000).card, 'in', 'the other side has its own card, once');
  s.set({ id: 4, side: 'in' });
  assert.equal(s.step(60_000).card, null);
});

test('onboarding: the game id settling right after the start is not a second game', () => {
  // the room turns to "playing" one message before the new game's state arrives
  const s = session();
  s.set({ id: 10 });
  s.step();
  s.set({ id: 11 });
  const v = s.step(100);
  assert.equal(v.card, 'out', 'the card is still the first one');
  assert.equal(v.caption, NARRATOR.intro.out[0]);
  s.set({ id: 12 });
  assert.equal(s.step(START_SETTLE_MS).caption, NARRATOR.intro.out[1], 'later, a new id is a new game');
});

test('onboarding: hints off shows no hint at all, hides what is up at once, and uses nothing up', () => {
  const off = session();
  off.hints(false);
  let v = off.step();
  assert.deepEqual([v.card, v.controls, v.hint], [null, false, null]);
  assert.equal(v.caption, NARRATOR.intro.out[0], 'the narrator is story, not a hint');
  off.set({ x: EDGE, gain: 0 });
  v = off.step(CARD_MAX_MS + HINT_MS);
  assert.deepEqual([v.card, v.controls, v.hint], [null, false, null]);
  assert.deepEqual(off.o.seen(), [], 'nothing was shown, so nothing is used up');
  off.hints(true);
  v = off.step(100);
  assert.equal(v.controls, true, 'back on: the controls hint is still owed');
  assert.equal(v.hint, 'cube');

  const mid = session();
  mid.step();
  mid.hints(false);
  v = mid.step(100);
  assert.deepEqual([v.card, v.controls, v.hint], [null, false, null], 'turning it off hides the card and the controls at once');
});

test('onboarding: nothing is shown off the game screen or over the win screen', () => {
  const s = session();
  s.step();
  s.set(null);
  assert.deepEqual(s.step(100), { card: null, controls: false, hint: null, caption: null });
  const won = session();
  won.step();
  won.set({ won: true });
  assert.deepEqual(won.step(100), { card: null, controls: false, hint: null, caption: null });
});

test('narrator: an intro line at game start, one line at the first solve only, each for a few seconds', () => {
  const s = session();
  assert.equal(s.step().caption, NARRATOR.intro.out[0]);
  assert.equal(s.step(CAPTION_MS).caption, null);
  s.set({ solved: 1 });
  assert.equal(s.step(100).caption, NARRATOR.firstSolve[0]);
  assert.equal(s.step(CAPTION_MS).caption, null);
  s.set({ solved: 2 });
  assert.equal(s.step(100).caption, null, 'only the first solve');

  // joining a game that already has solved puzzles is not "the first solve"
  const late = session();
  late.set({ solved: 2 });
  late.step();
  assert.equal(late.step(CAPTION_MS).caption, null);
  late.set({ solved: 3 });
  assert.equal(late.step(100).caption, NARRATOR.firstSolve[0]);
});

test('narrator: every line is short, plain text, and has no em dash', () => {
  const lines = [...NARRATOR.intro.out, ...NARRATOR.intro.in, ...NARRATOR.firstSolve];
  assert.ok(lines.length >= 3);
  for (const line of lines) {
    assert.ok(line.length < NARRATOR_MAX, `${line.length} chars: ${line}`);
    assert.doesNotMatch(line, /[—–]/);
  }
  assert.equal(NARRATOR_MAX, 80);
  assert.equal(narratorLine(['a', 'b'], 3), 'b');
});

test('onboarding: the rules stay pure and the layer is mounted once, with a repointable cube anchor', () => {
  const src = (path: string): string => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
  const rules = src('ui/onboarding/rules.ts');
  assert.doesNotMatch(rules, /document\.|window\.|Date\.now|Math\.random|setTimeout|setInterval|from 'phaser'/);
  assert.match(rules, /FACE_SIZE - 1/, 'the face edge comes from FACE_SIZE');
  assert.equal(src('app.ts').match(/mountOnboarding\(/g)?.length, 1);
  assert.match(src('ui/onboarding/anchors.ts'), /cube: '\.cu-net'/);
  assert.match(src('ui/settingsPanel.ts'), /toggle\('hints', 'Hints'\)/);
});

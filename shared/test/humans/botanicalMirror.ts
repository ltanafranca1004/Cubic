import { isFlower } from '../../src/bot/scripts/botanicalMirror';
import { colourIn, rowColumnIn } from '../../src/bot/scripts/kit456';
import { canonOf, cellOf } from '../../src/bot/scripts/relayKit';
import type { HumanScript } from '../partnerSim';

// The simulated human for BOTANICAL MIRROR (face 4), either side, only from its own screen.
// Outside: once face 6 is solved it looks for the flowers (one lies on each other face),
// carries them to face 4 one at a time, hears the AI name each pot with its colour and
// plants every flower from the tile next to its pot, facing it.
// Inside: the AI names a pot ("the pot is row R column C") and asks its colour: it says the
// colour of the flower it sees there. After a strike the AI says the colour in its hands
// and asks for the pot: it names it, "row R column C", counted from the edges beside faces
// 5 and 3 (the canonical tile).

const ID = 'botanical-mirror';
const RELAY = `${ID}.relay`;
const KIND = 'flower-';

export interface BotanicalMirrorHumanOptions {
  /** Never say anything. */
  mute?: boolean;
  /** Inside: say every pot's colour one pot off, until the partner says it struck (one strike), then the truth. */
  lie?: boolean;
}

interface Tile {
  x: number;
  y: number;
}

interface HumanMem {
  /** Outside: the pot of each colour, as the partner named them (canonical). */
  pots: Record<string, Tile>;
  /** Outside: faces with no loose flower on them. */
  empty: number[];
  /** Outside: the pot I have turned to face ("x,y"). */
  facing: string | null;
  /** Inside: the pot the partner asked about, the colour it holds in its hands, and whether it wants the pot for it. */
  tile: Tile | null;
  colour: string | null;
  wantPot: boolean;
  lied: boolean;
}

const key = (t: Tile) => `${t.x},${t.y}`;

export const botanicalMirrorHuman = (opts: BotanicalMirrorHumanOptions = {}): HumanScript<HumanMem> => ({
  id: ID,
  init: () => ({ pots: {}, empty: [], facing: null, tile: null, colour: null, wantPot: false, lied: false }),

  // Outside: fetch the flowers one at a time; plant the one in hand once its pot is known.
  errand({ side, o, mem, walk, move, interact }) {
    if (side !== 'out' || !o.solvedFaces.includes(6)) return false;
    const here = o.puzzleId === ID;
    const pots = here ? o.objects.filter((x) => x.type === 'f4-pot') : [];
    if (o.carrying) {
      const pot = isFlower(o.carrying) ? mem.pots[o.carrying.slice(KIND.length)] : undefined;
      // which pot: the partner says (play). Until then, just go to the face.
      if (!pot || !here) return false;
      const cell = cellOf(o, pot);
      // a free tile next to the pot (the pot itself is solid), then a step into the pot to face it, then E
      const beside = [[0, 1], [0, -1], [1, 0], [-1, 0]].map(([dc, dr]) => ({ col: cell.col + dc!, row: cell.row + dr! })).filter((c) => ['.', '@'].includes(o.grid[c.row]?.[c.col] ?? ''));
      const stand = beside.find((c) => c.col === o.position.col && c.row === o.position.row) ?? beside[0];
      if (!stand) return false;
      if (!walk(canonOf(o, stand))) mem.facing = null;
      else if (mem.facing !== key(pot)) {
        mem.facing = key(pot);
        move(cell.col - stand.col, cell.row - stand.row);
      } else {
        mem.facing = null;
        interact();
      }
      return true;
    }
    // empty hands: the flower I see here, else the next face I have not searched
    const loose = o.items.find((i) => isFlower(i.kind) && !pots.some((p) => p.col === i.col && p.row === i.row));
    if (loose) {
      if (walk(canonOf(o, loose))) interact();
      return true;
    }
    if (!here && !mem.empty.includes(o.face)) mem.empty.push(o.face);
    const next = o.puzzleList.map((p) => p.face).find((f) => f !== 4 && !mem.empty.includes(f));
    if (next === undefined) return false;
    walk({ face: next, x: 5, y: 0 }); // any tile of it: once there, I look around
    return true;
  },

  play({ side, o, mem, seen, next, say: speak }) {
    const say = (text: string) => void (opts.mute || speak(text));
    const line = next();
    if (!line) return;
    const words = line.key === RELAY ? String(line.args?.words ?? '') : '';
    const rc = rowColumnIn(words);
    const tile = rc.row !== undefined && rc.column !== undefined ? { x: rc.column - 1, y: rc.row - 1 } : null;
    const colour = colourIn(words);

    if (side === 'out') {
      // "the pot is row R column C the flower is pink": remember where each colour goes
      if (tile && colour) mem.pots[colour] = tile;
      if (line.key === `${ID}.in.strike`) mem.pots = {};
      if (line.key === `${ID}.in.ask` && o.carrying) say(`it is ${o.carrying.slice(KIND.length)}`);
      return;
    }

    // inside: I see the five flowers
    const pots = seen('f4-flowerpot').map((p) => ({ x: p.x, y: p.y, colour: p.state ?? '' }));
    const namePot = () => {
      const pot = pots.find((p) => p.colour === mem.colour);
      if (pot) say(`row ${pot.y + 1} column ${pot.x + 1}`);
      mem.wantPot = false;
    };
    if (tile && !colour) mem.tile = tile;
    if (colour && !tile) {
      mem.colour = colour;
      if (mem.wantPot) namePot();
    }
    if (line.key === `${ID}.out.colour` && mem.tile) {
      let pot = pots.find((p) => key(p) === key(mem.tile!));
      if (pot && opts.lie && !mem.lied) pot = pots[(pots.indexOf(pot) + 1) % pots.length];
      if (pot) say(pot.colour);
    }
    if (line.key === `${ID}.out.strike`) Object.assign(mem, { wantPot: true, lied: true });
    if (line.key === `${ID}.out.ask` && mem.colour) namePot();
  },
});

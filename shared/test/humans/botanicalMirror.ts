import { defaultEnv, objectsOn } from '../../src/index';
import { isFlower } from '../../src/bot/scripts/botanicalMirror';
import { colourIn, rowColumnIn } from '../../src/bot/scripts/kit456';
import { canonOf } from '../../src/bot/scripts/relayKit';
import type { HumanScript } from '../partnerSim';

// The simulated human for BOTANICAL MIRROR (face 4), either side, only from its own screen.
// Outside: it brings the flower from face 6 (errand), says its colour when asked and plants
// it in the pot the AI names. Inside: it hears the colour and names the pot that holds it:
// "row R column C", counted from the edges beside faces 5 and 3 (the canonical tile).

const ID = 'botanical-mirror';
const RELAY = `${ID}.relay`;

export interface BotanicalMirrorHumanOptions {
  /** Never say anything. */
  mute?: boolean;
  /** Inside: name a wrong pot first (one strike), then the right one. */
  lie?: boolean;
}

interface HumanMem {
  looked: boolean;
  colour: string | null;
  /** Outside: the pot the partner named (the canonical tile: row and column counted from the edges by faces 5 and 3). */
  pot: { x: number; y: number } | null;
  lied: boolean;
  /** Outside: ticks spent counting rows and columns before walking to the pot. */
  counting: number;
}

export const botanicalMirrorHuman = (opts: BotanicalMirrorHumanOptions = {}): HumanScript<HumanMem> => ({
  id: ID,
  init: () => ({ looked: false, colour: null, pot: null, lied: false, counting: 0 }),

  // Outside: pick the flower up where it fell (beside the crate of face 6) and bring it along.
  errand({ side, o, mem, walk, interact }) {
    if (side !== 'out' || !o.solvedFaces.includes(6) || o.carrying) return false;
    const flower = o.items.find((i) => isFlower(i.kind));
    if (flower) {
      if (walk(canonOf(o, flower))) interact();
      return true;
    }
    if (o.face === 6) mem.looked = true;
    if (mem.looked) return false;
    const crate = objectsOn(defaultEnv.world, 'out', 6, 'f6-crate')[0]!;
    walk({ face: 6, x: crate.x, y: crate.y });
    return true;
  },

  play({ side, o, mem, seen, next, walk, interact, say: speak }) {
    const say = (text: string) => void (opts.mute || speak(text));
    const line = next();
    const words = line?.key === RELAY ? String(line.args?.words ?? '') : '';
    if (side === 'in') {
      // the partner says the colour; I name the pot that holds it, counted from the edges by faces 5 and 3
      mem.colour = colourIn(words) ?? mem.colour;
      const pots = seen('f4-flowerpot');
      let pot = pots.find((p) => p.state === mem.colour);
      if (pot && opts.lie && !mem.lied && colourIn(words)) {
        mem.lied = true;
        pot = pots.find((p) => p !== pot);
      }
      if (pot && (colourIn(words) || line?.key === `${ID}.out.strike`)) say(`row ${pot.y + 1} column ${pot.x + 1}`);
      return;
    }
    if (line?.key === `${ID}.in.ask` && o.carrying) return say(`it is ${o.carrying.slice('flower-'.length)}`);
    const named = rowColumnIn(words);
    if (named.row !== undefined && named.column !== undefined) Object.assign(mem, { pot: { x: named.column - 1, y: named.row - 1 }, counting: 10 });
    if (mem.counting > 0) return void mem.counting--; // a person counts the tiles first (2 s)
    if (mem.pot && o.carrying && walk(mem.pot)) {
      interact();
      mem.pot = null;
    }
  },
});

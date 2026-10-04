import { defaultEnv, objectsOn } from '../../src/index';
import { symbolsIn } from '../../src/bot/scripts/kit456';
import { canonOf } from '../../src/bot/scripts/relayKit';
import { litName, watchShow } from '../../src/bot/scripts/sequenceLaser';
import { BATTERY_KIND } from '../../src/puzzles/chain';
import { EQUATION_TILES } from '../../src/puzzles/equationSafe';
import type { HumanScript } from '../partnerSim';

// The simulated human for SEQUENCE LASER (face 5), either side, only from its own screen.
// Inside: it carries the battery from the safe of face 2 to the emitter (errand), then
// presses the buttons the AI's relay lines name, in that order. Outside: it presses REPLAY,
// watches the symbols light up and types the names, three and then four.

const ID = 'sequence-laser';
const RELAY = `${ID}.relay`;
const SYMBOL = 'f5-symbol';

export interface SequenceLaserHumanOptions {
  /** Outside: say nothing until the AI asks. */
  shy?: boolean;
  /** Outside: never say anything. */
  mute?: boolean;
  /** Outside: say the order backwards (wrong). */
  lie?: boolean;
  /** Inside: ask "again" this many times before pressing. */
  again?: number;
  /** Inside: do not carry the battery. */
  lazy?: boolean;
}

interface HumanMem {
  powered: boolean;
  looked: boolean;
  todo: string[];
  watch: { at: number; seen: string[] } | null;
  order: string[] | null;
  ticks: number;
  agains: number;
}

/** What a human types for the order: the names, three and then four. */
export const orderChat = (order: readonly string[]): string[] => (order.length <= 3 ? [order.join(' ')] : [order.slice(0, 3).join(' '), order.slice(3).join(' ')]);

export const sequenceLaserHuman = (opts: SequenceLaserHumanOptions = {}): HumanScript<HumanMem> => ({
  id: ID,
  init: () => ({ powered: false, looked: false, todo: [], watch: null, order: null, ticks: 0, agains: 0 }),

  // Inside: the battery lies in front of the safe of face 2 (I saw it come out); the emitter is in the middle of face 5.
  errand({ side, o, mem, seen, walk, interact }) {
    if (side !== 'in' || opts.lazy || !o.solvedFaces.includes(2)) return false;
    if (o.face === 5) mem.powered = seen('f5-emitter').some((e) => e.state !== 'dead');
    if (mem.powered) return false;
    if (o.carrying === BATTERY_KIND) {
      const emitter = objectsOn(defaultEnv.world, 'in', 5, 'target')[0]!;
      if (walk({ face: 5, x: emitter.x, y: emitter.y })) interact();
      return true;
    }
    const battery = o.items.find((i) => i.kind === BATTERY_KIND);
    if (battery) {
      if (walk(canonOf(o, battery))) interact();
      return true;
    }
    if (o.face === 2) mem.looked = true;
    if (mem.looked) return false;
    walk({ face: 2, ...EQUATION_TILES.battery });
    return true;
  },

  play({ side, mem, seen, next, walk, interact, say }) {
    mem.ticks++;
    const symbols = seen(SYMBOL);
    if (side === 'in') {
      // press what the partner says, in the order they say it; a lit button is done
      for (let l = next(); l; l = next()) {
        if (l.key !== RELAY) continue;
        if (mem.agains < (opts.again ?? 0) && String(l.args?.words).startsWith('next')) {
          mem.agains++;
          mem.todo = [];
          say('again');
        } else mem.todo.push(...symbolsIn(String(l.args?.words ?? '')));
      }
      const button = (name: string) => symbols.find((s) => s.state === name || s.state === `${name}-lit`);
      while (mem.todo.length && (!button(mem.todo[0]!) || litName(button(mem.todo[0]!)!.state))) mem.todo.shift();
      if (mem.todo.length && walk(button(mem.todo[0]!)!)) interact();
      return;
    }
    // outside: REPLAY, watch, say it; say it again whenever the partner asks
    const replay = seen('f5-replay')[0];
    if (!replay || replay.state !== 'on') return;
    const now = mem.ticks * 200;
    const say_ = (order: readonly string[]) => (opts.lie ? [[...order].reverse().join(' ')] : orderChat(order)).forEach(say);
    if (!mem.order) {
      if (!mem.watch) {
        if (!walk(replay)) return;
        interact();
        mem.watch = { at: now, seen: [] };
        return;
      }
      const got = watchShow(mem.watch, symbols.map((s) => s.state), now);
      if (got === 'again') mem.watch = null;
      else if (got) {
        mem.order = got;
        while (next());
        if (!opts.shy && !opts.mute) say_(got);
      }
      return;
    }
    for (let l = next(); l; l = next()) if (!opts.mute && [`${ID}.in.first`, `${ID}.in.next`, `${ID}.in.strike`].includes(l.key)) say_(mem.order);
  },
});

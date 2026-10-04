import type { HumanScript } from '../partnerSim';

// The simulated human for EQUATION SAFE (face 2), either side, only from its own screen.
// Outside: it counts the bushes, birds and rocks and types the counts in chat. Inside: it
// multiplies what the AI's relay line said the way the row on its own wall says, types the
// answer and presses ENTER. (Carrying the battery on is face 5's part of the game.)

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const KINDS = ['bushes', 'birds', 'rocks'] as const;
const SEEN = { bushes: 'f2-bush', birds: 'f2-bird', rocks: 'f2-rock' } as const;
const CLUE: Record<string, (typeof KINDS)[number]> = { bush: 'bushes', bird: 'birds', rock: 'rocks' };

export interface EquationSafeHumanOptions {
  /** Outside: how the counts are typed. named "3 bushes 2 birds 1 rock" (default), backwards "rocks 1, birds 2, bushes 3", bare "3 2 1". */
  style?: 'named' | 'backwards' | 'bare';
  /** Outside: say nothing until the AI asks, then answer each question with one bare number. */
  shy?: boolean;
  /** Outside: never say anything. */
  mute?: boolean;
  /** Outside: say one bush too many. */
  lie?: boolean;
  /** Inside: ask "again" this many times before typing. */
  again?: number;
}

interface Mem {
  answer: string | null;
  said: boolean;
  agains: number;
}

export const equationSafeHuman = (opts: EquationSafeHumanOptions = {}): HumanScript<Mem> => ({
  id: 'equation-safe',
  init: () => ({ answer: null, said: false, agains: 0 }),
  play(ctx) {
    const { mem } = ctx;
    if (ctx.side === 'out') {
      if (opts.mute) return void ctx.next();
      const n = { bushes: ctx.seen(SEEN.bushes).length + (opts.lie ? 1 : 0), birds: ctx.seen(SEEN.birds).length, rocks: ctx.seen(SEEN.rocks).length };
      const line = ctx.next();
      const asked = KINDS.find((k) => line?.key === `equation-safe.ask.${k}`);
      if (opts.shy) {
        if (asked) ctx.say(String(n[asked]));
        return;
      }
      if (mem.said && !asked && line?.key !== 'equation-safe.wrong') return;
      mem.said = true;
      if (opts.style === 'bare') ctx.say(`${n.bushes} ${n.birds} ${n.rocks}`);
      else if (opts.style === 'backwards') ctx.say(`rocks ${n.rocks}, birds ${n.birds}, bushes ${n.bushes}`);
      else ctx.say(`${n.bushes} bushes ${n.birds} birds ${n.rocks} ${n.rocks === 1 ? 'rock' : 'rocks'}`);
      return;
    }
    // inside: "three bushes two birds one rocks", and the row on my own wall says what to do with them
    for (let line = ctx.next(); line; line = ctx.next()) {
      const words = String(line.args?.words ?? '').split(' ');
      if (line.key !== 'equation-safe.relay' || !KINDS.every((k) => words.includes(k))) continue;
      if (mem.agains < (opts.again ?? 0)) {
        mem.agains++;
        ctx.say('repeat');
        return;
      }
      const count = (k: string) => NUMBER_WORDS.indexOf(words[words.indexOf(k) - 1]!);
      let total = 1;
      for (const c of ctx.seen('f2-clue')) total *= c.state === 'three' ? 3 : c.state === 'two' ? 2 : CLUE[c.state ?? ''] ? count(CLUE[c.state!]!) : 1;
      mem.answer = String(total);
    }
    if (!mem.answer) return;
    const typed = ctx.seen('display').filter((d) => d.state !== 'empty').length;
    const key = ctx.seen('key').find((k) => k.state === (typed < mem.answer!.length ? mem.answer![typed] : 'enter'));
    if (key && ctx.walk(key)) ctx.interact();
  },
});

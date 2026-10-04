import { readCode } from '../../src/puzzles/hiddenCode';
import type { HumanScript } from '../partnerSim';

// The simulated human for HIDDEN CODE (face 1), either side, only from its own screen.
// Outside: it reads the number in the grass and types it in chat. Inside: it types on the
// keypad what the AI's relay line said, then ENTER.

const DIGIT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

export interface HiddenCodeHumanOptions {
  /** Outside: how the number is typed. spaced "4 7 2" (default), joined "472", words "four seven two", single: one digit per line. */
  style?: 'spaced' | 'joined' | 'words' | 'single';
  /** Outside: say nothing until the AI asks. */
  shy?: boolean;
  /** Outside: never say anything. */
  mute?: boolean;
  /** Outside: read a wrong number out (every digit one too high). */
  lie?: boolean;
  /** Inside: ask "again" this many times before typing. */
  again?: number;
}

interface Mem {
  /** Inside: the digits heard. Outside: whether the number was said. */
  code: string | null;
  said: boolean;
  agains: number;
}

export const hiddenCodeHuman = (opts: HiddenCodeHumanOptions = {}): HumanScript<Mem> => ({
  id: 'hidden-code',
  init: () => ({ code: null, said: false, agains: 0 }),
  play(ctx) {
    const { mem } = ctx;
    if (ctx.side === 'out') {
      const line = ctx.next();
      const asked = line?.key.startsWith('hidden-code.ask') || line?.key === 'hidden-code.wrong';
      if (opts.mute || (mem.said && !asked) || (opts.shy && !asked)) return;
      let code = readCode(ctx.seen('code-mark'));
      if (!code) return;
      if (opts.lie) code = [...code].map((d) => (Number(d) + 1) % 10).join('');
      mem.said = true;
      if (opts.style === 'single') for (const d of code) ctx.say(d);
      else ctx.say(opts.style === 'joined' ? code : opts.style === 'words' ? [...code].map((d) => DIGIT_WORDS[Number(d)]).join(' ') : [...code].join(' '));
      return;
    }
    // inside: "the code is four seven two"
    for (let line = ctx.next(); line; line = ctx.next()) {
      const words = String(line.args?.words ?? '');
      if (line.key !== 'hidden-code.relay' || !words.startsWith('the code is ')) continue;
      if (mem.agains < (opts.again ?? 0)) {
        mem.agains++;
        ctx.say(mem.agains % 2 ? 'again' : 'what?');
        return;
      }
      mem.code = words
        .slice('the code is '.length)
        .split(' ')
        .map((w) => DIGIT_WORDS.indexOf(w))
        .join('');
    }
    if (!mem.code) return;
    const typed = ctx.seen('display').filter((d) => d.state !== 'empty').length;
    const key = ctx.seen('key').find((k) => k.state === (typed < mem.code!.length ? mem.code![typed] : 'enter'));
    if (key && ctx.walk(key)) ctx.interact();
  },
});

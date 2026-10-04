import type { Goal, Observation } from '@cubic/shared';
import type { Brain } from './gemini';
import { idleHint, type Persona } from './prompt';

// A small rule-based partner. No key, no network. Two jobs:
//  - AI_FAKE=1: the whole AI, for development and as the demo fallback.
//  - With Gemini: it answers any turn where Gemini fails (429, 503, timeout, bad JSON),
//    so the game never stalls.
// Same contract as Gemini: it only reads its own observation and answers the same JSON.
// It follows the same goal as Gemini (chooseGoal) and walks on the same leash.

/** Everything the scripted partner can say. All of it is in the voice bank. */
export const SCRIPTED_LINES: Record<Persona, Record<string, string>> = {
  default: {
    idle: 'Nothing else I can do from here. What do you see?',
  },
  tsundere: {
    idle: 'Nothing to do over here. So? What do you see?',
  },
};

export function scriptedBrain(persona: Persona = 'default'): Brain {
  const L = SCRIPTED_LINES[persona];
  return {
    async think(turn) {
      const t = JSON.parse(turn) as { observation: Observation; chat: string[]; currentlyDoing: string | null; goal: Goal; partnerIdle: boolean };
      const o = t.observation;
      const goal = t.goal;
      const said = (s: string) => t.chat.some((line) => line.includes(s));
      // A quiet partner gets the next goal in one line, instead of the usual line.
      const hint = t.partnerIdle ? idleHint(goal) : null;
      const reply = (say: string | null, action: object | null = null) => ({ text: JSON.stringify({ say: hint ?? (say && !said(say) ? say : null), action }) });

      if (t.currentlyDoing) return reply(null);
      // A world with a portal: once it is awake, walk to it and step in.
      if (goal.kind === 'portal') return reply(null, o.objects.some((x) => x.type === 'portal') ? { type: 'step_on', object: 'portal' } : { type: 'go_face', face: goal.face });
      // Lost the partner: any next face is back within earshot.
      if (goal.kind === 'regroup') return reply(null, { type: 'go_face', face: o.edges.up.face });
      // (It knows no puzzle by heart: on a face with one it waits for the partner to lead.)
      // A puzzle it has seen on another face: walk there, but only on the leash.
      if (goal.kind === 'puzzle' && !goal.here && goal.inReach) return reply(null, { type: 'go_face', face: goal.face });
      // Nothing known to do: stay put, near the partner.
      return reply(L.idle!);
    },
  };
}

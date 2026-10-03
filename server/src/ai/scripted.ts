import type { Observation } from '@cubic/shared';
import type { Brain } from './gemini';
import type { Persona } from './prompt';

// A small rule-based partner. No key, no network. Two jobs:
//  - AI_FAKE=1: the whole AI, for development and as the demo fallback.
//  - With Gemini: it answers any turn where Gemini fails (429, 503, timeout, bad JSON),
//    so the game never stalls.
// Same contract as Gemini: it only reads its own observation and answers the same JSON.

const LINES: Record<Persona, Record<string, string>> = {
  default: {
    plateGo: 'I can see a plate on my floor. Standing on it now.',
    plateOn: 'I am on the plate. Tell me when you are through.',
    doorOpen: 'The door just opened! Going for the crystal.',
    doorShut: 'A sealed door, a crystal behind it. Is there a switch on your side?',
    portalIn: 'The portal is awake. Stepping in.',
    portalGo: 'Everything is solved. Heading to the portal on face 6.',
    idle: 'Nothing else I can do from here. What do you see?',
  },
  tsundere: {
    plateGo: 'Ugh, a plate on my floor. Fine, I will stand on it.',
    plateOn: 'I am on the plate. Hurry up, I am not doing this for you.',
    doorOpen: 'The door opened. I am getting the crystal, obviously.',
    doorShut: 'A sealed door and a crystal. Find the switch on your side already.',
    portalIn: 'The portal is awake. I am going in. Keep up.',
    portalGo: 'All solved. Portal, face 6. Do not make me wait.',
    idle: 'Nothing to do over here. So? What do you see?',
  },
};

export function scriptedBrain(persona: Persona = 'default'): Brain {
  const L = LINES[persona];
  return {
    async think(turn) {
      const t = JSON.parse(turn) as { observation: Observation; chat: string[]; currentlyDoing: string | null };
      const o = t.observation;
      const said = (s: string) => t.chat.some((line) => line.includes(s));
      const reply = (say: string | null, action: object | null = null) => ({ text: JSON.stringify({ say: say && !said(say) ? say : null, action }) });

      if (t.currentlyDoing) return reply(null);
      const on = (type: string) => o.objects.find((x) => x.type === type);
      const plate = on('plate');
      if (plate && plate.state !== 'on') return reply(L.plateGo!, { type: 'step_on', object: 'plate' });
      if (plate) return reply(L.plateOn!);
      const door = on('door');
      const crystal = on('crystal');
      if (door && crystal && crystal.state !== 'taken') {
        if (door.state === 'open') return reply(L.doorOpen!, { type: 'step_on', object: 'crystal' });
        return reply(L.doorShut!);
      }
      if (o.portalOpen && on('portal')) return reply(L.portalIn!, { type: 'step_on', object: 'portal' });
      if (o.portalOpen) return reply(L.portalGo!, { type: 'go_face', face: 6 });
      return reply(L.idle!);
    },
  };
}

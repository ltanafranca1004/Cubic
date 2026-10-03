import type { Observation } from '@cubic/shared';
import type { Brain } from './gemini';

// A tiny rule-based stand-in for Gemini (AI_FAKE=1). No key, no network: for developing
// the AI game flow and as an emergency demo fallback. It follows the same contract: it
// only reads its own observation and answers with the same JSON.

export const scriptedBrain: Brain = {
  async think(turn) {
    const t = JSON.parse(turn) as { observation: Observation; chat: string[]; currentlyDoing: string | null };
    const o = t.observation;
    const said = (s: string) => t.chat.some((line) => line.includes(s));
    const reply = (say: string | null, action: object | null = null) => ({ text: JSON.stringify({ say: say && !said(say) ? say : null, action }) });

    if (t.currentlyDoing) return reply(null);
    const on = (type: string) => o.objects.find((x) => x.type === type);
    const plate = on('plate');
    if (plate && plate.state !== 'on') return reply('I can see a plate on my floor. Standing on it now.', { type: 'step_on', object: 'plate' });
    if (plate) return reply('I am on the plate. Tell me when you are through.');
    const door = on('door');
    const crystal = on('crystal');
    if (door && crystal && crystal.state !== 'taken') {
      if (door.state === 'open') return reply('The door just opened! Going for the crystal.', { type: 'step_on', object: 'crystal' });
      return reply('There is a sealed door here with a crystal behind it. Is there a switch on your side?');
    }
    if (o.portalOpen && on('portal')) return reply('The portal is awake. Stepping in.', { type: 'step_on', object: 'portal' });
    if (o.portalOpen) return reply('Everything is solved. Heading to the portal on face 6.', { type: 'go_face', face: 6 });
    return reply('Nothing else I can do from here, I think. What do you see?');
  },
};

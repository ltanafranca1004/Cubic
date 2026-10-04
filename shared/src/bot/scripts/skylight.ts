import { far, route, same, type Cell } from './grid';
import type { PuzzleScript } from './types';

// SKYLIGHT (face 5).
// Outside: stand on a glass pane and say so. "go" (the human is across) or "no" (nothing
// they can reach is lit) sends the bot to the other pane. It never steps off otherwise.
// Inside: cross what is lit, wait on dry floor next to the next dark bridge and say so.
// It never touches a dark bridge.

const RESAY_MS = 25_000;

interface Mem {
  /** Outside: which pane (in reading order) it stands on. */
  pane: number | null;
  arrived: boolean;
}

export const skylightScript: PuzzleScript<Mem> = {
  id: 'skylight',
  lines: ['skylight.on', 'skylight.switch', 'skylight.need', 'skylight.other', 'skylight.across1', 'skylight.crossing2', 'skylight.fell'],
  init: () => ({ pane: null, arrived: false }),

  // Outside the panes (stepping off one can drop the partner), inside the dark bridges.
  hazards: (o) => o.objects.filter((x) => x.type === 'skylight' || (x.type === 'bridge' && x.state === 'dark')),

  play({ o, mem: s, objs, say, has, struck }) {
    const pos = o.position;
    if (o.you === 'out') {
      const panes = objs('skylight').sort((a, b) => a.row - b.row || a.col - b.col);
      if (!panes.length) return null;
      s.pane ??= panes.indexOf([...panes].sort((a, b) => far(a, pos) - far(b, pos))[0]!);
      if (s.arrived && has('go', 'no')) {
        s.pane = (s.pane + 1) % panes.length;
        s.arrived = false;
        say('skylight.switch', { force: true });
      }
      const pane = panes[s.pane]!;
      if (!same(pane, pos)) return { action: { type: 'goto', col: pane.col, row: pane.row }, allow: [pane], status: 'walking to a glass pane' };
      if (!s.arrived) {
        s.arrived = true;
        say('skylight.on', { force: true });
      } else say('skylight.on', { every: RESAY_MS, force: has('again') });
      return { action: null, hold: true, allow: [pane], status: 'standing on a glass pane to light a bridge below' };
    }

    const bridges = objs('bridge');
    const crystal = objs('crystal')[0];
    if (!bridges.length || !crystal) return null;
    if (struck) say('skylight.fell', { force: true });
    const isBridge = (c: Cell) => bridges.find((b) => same(b, c));
    // My way to the crystal as the room is drawn, and the first bridge on it that is still dark.
    const path = route(o, pos, crystal);
    if (!path) return null;
    const dark = path.findIndex((c, i) => i > 0 && isBridge(c)?.state === 'dark');
    if (dark < 0) {
      say('skylight.crossing2');
      return { action: { type: 'goto', col: crystal.col, row: crystal.row }, status: 'the way is lit: walking to the crystal' };
    }
    const wait = path[dark - 1]!;
    if (!same(wait, pos)) return { action: { type: 'goto', col: wait.col, row: wait.row }, status: 'walking up to the next dark bridge' };
    const ahead = path.filter((c) => isBridge(c)).length;
    if (ahead < bridges.length) say('skylight.across1', { every: RESAY_MS, force: has('again') });
    else if (bridges.some((b) => b.state === 'lit')) say('skylight.other', { every: RESAY_MS });
    else say('skylight.need', { every: RESAY_MS, force: has('again') });
    return { action: null, hold: true, status: 'waiting at a dark bridge for the partner to light it' };
  },
};

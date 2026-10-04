import type { MapObject } from '../maps/types';
import type { PuzzleCtx, PuzzleModule } from './types';
import { at, flood, type XY } from './util';

// SKYLIGHT (face 5: Rooftop outside, Pillars inside).
// The inside room has a crystal on an island, behind two rings of black water. Each ring
// has one bridge that only exists in the light. Outside, two glass panes are set in the
// roof: standing on pane "a" lights bridge "a", pane "b" lights bridge "b". The outside
// player cannot be on both, so the inside player crosses the first bridge, waits on the
// dry ring between the waters, and calls for the second pane.
//
// Why it takes two: a dark bridge blocks the inside player, and only the outside player's
// body on the glass lights it. Nothing inside can do that.
//
// Never stuck: a dark bridge can always be walked from its island side (you can leave,
// not enter), and if the light goes out under your feet you are put back on the last dry
// tile you stood on (one strike). Once the crystal is taken both bridges stay.
//
// Map objects used: outside "skylight" (name a | b), inside "bridge" (name a | b) and
// "crystal". The water is plain map terrain.

export const SKYLIGHT_FACE = 5;

interface State {
  /** The inside player has reached the crystal. */
  taken: boolean;
  /** The last tile of this face the inside player stood on that is not a bridge. */
  dry: XY | null;
}

const panes = (ctx: PuzzleCtx) => ctx.objects('out', SKYLIGHT_FACE, 'skylight');
const bridges = (ctx: PuzzleCtx) => ctx.objects('in', SKYLIGHT_FACE, 'bridge');
const open = (s: State, ctx: PuzzleCtx) => s.taken || ctx.solved;
/** The outside player is standing on a pane with this name. */
const held = (ctx: PuzzleCtx, name: string) => panes(ctx).some((p) => p.name === name && ctx.isOn('out', { face: SKYLIGHT_FACE, x: p.x, y: p.y }));
const lit = (s: State, ctx: PuzzleCtx, bridge: MapObject) => open(s, ctx) || held(ctx, bridge.name);

/** The inside player stands on the crystal's side of `bridge` (so they may walk out over it in the dark). */
function behind(ctx: PuzzleCtx, bridge: MapObject): boolean {
  const pose = ctx.player('in');
  const crystal = ctx.objects('in', SKYLIGHT_FACE, 'crystal')[0];
  if (pose.face !== SKYLIGHT_FACE || !crystal) return false;
  return flood(ctx.world.in[SKYLIGHT_FACE].tiles, crystal, [bridge]).some((t) => at(t, pose));
}

export const skylight: PuzzleModule<State> = {
  id: 'skylight',
  face: SKYLIGHT_FACE,

  init: () => ({ taken: false, dry: null }),

  isBlocked(s, ctx, side, tile) {
    if (side !== 'in') return false;
    const bridge = bridges(ctx).find((b) => at(b, tile));
    return !!bridge && !lit(s, ctx, bridge) && !behind(ctx, bridge);
  },

  onEnter(s, ctx, side, tile) {
    if (side === 'out') {
      if (!open(s, ctx) && panes(ctx).some((p) => at(p, tile))) ctx.emit('skylight-on');
      return;
    }
    if (!bridges(ctx).some((b) => at(b, tile))) s.dry = { x: tile.x, y: tile.y };
    if (!s.taken && at(ctx.objects('in', SKYLIGHT_FACE, 'crystal')[0], tile)) {
      s.taken = true;
      ctx.emit('skylight-taken');
    }
  },

  onLeave(s, ctx, side, tile) {
    if (side !== 'out' || open(s, ctx)) return;
    const pane = panes(ctx).find((p) => at(p, tile));
    if (!pane) return;
    ctx.emit('skylight-off');
    // The light went out. If the inside player is on that bridge, it is gone under them.
    const pose = ctx.player('in');
    const under = pose.face === SKYLIGHT_FACE ? bridges(ctx).find((b) => at(b, pose)) : undefined;
    if (under && under.name === pane.name && !lit(s, ctx, under) && s.dry) {
      ctx.teleport('in', s.dry.x, s.dry.y);
      ctx.strike('in');
      ctx.emit('skylight-fall');
    }
  },

  isSolved: (s) => s.taken,

  visible(s, ctx, side) {
    if (side === 'out') {
      return panes(ctx).map((p) => ({ type: 'skylight', x: p.x, y: p.y, state: held(ctx, p.name) ? 'on' : 'off' }));
    }
    return [
      // Where the light of each pane lands: the tile right behind it.
      ...panes(ctx).map((p) => ({ type: 'beam', x: p.x, y: p.y, state: held(ctx, p.name) ? 'on' : 'off' })),
      ...bridges(ctx).map((b) => ({ type: 'bridge', x: b.x, y: b.y, state: lit(s, ctx, b) ? 'lit' : 'dark' })),
      ...ctx.objects('in', SKYLIGHT_FACE, 'crystal').map((c) => ({ type: 'crystal', x: c.x, y: c.y, state: s.taken ? 'taken' : 'idle' })),
    ];
  },

  objective(_s, ctx, side) {
    const any = panes(ctx).some((p) => held(ctx, p.name));
    if (side === 'out') {
      return any ? 'You are standing on glass. Ask your partner before you step off.' : 'Two panes of glass are set in the roof. Each lets light into the room below.';
    }
    return any ? 'Light from above! A bridge shows where it falls. Cross while it lasts.' : 'A crystal behind two rings of black water. The bridges only exist in the light.';
  },
};

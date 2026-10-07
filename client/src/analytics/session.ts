import type { GameEvent, Side } from '@cubic/shared';
import { sameBindings } from '../input/bindings';
import type { Net } from '../net/client';
import type { Settings } from '../style/settings';
import { track } from './analytics';

// The usage events of one tab, from what the app already knows: the Net's room and game
// state, the game events it hands out, the menu actions and the settings. It only reads;
// nothing here decides anything. Both players send their own events (group by `room`).
// Never a name, chat text or a key binding's value: ids, counts and times only.

export type Mode = 'coop' | 'solo';
/** Why a game ended for this player before the win. */
export type LeftReason = 'leave' | 'inactive' | 'replaced' | 'room_gone' | 'tab_closed';

export interface Screen {
  layout: 'full' | 'compact';
  touch: boolean;
}

/** The game this tab already said `game_started` for, so a reload or a rejoin is not a second start. */
const GAME_KEY = 'cubic.stats.game';
/** A slider sends a change per step: one `settings_changed` once it has stood still this long. */
export const SETTLE_MS = 800;

function firstSight(id: string): boolean {
  try {
    if (sessionStorage.getItem(GAME_KEY) === id) return false;
    sessionStorage.setItem(GAME_KEY, id);
  } catch {
    // storage blocked: a reload counts the game again
  }
  return true;
}

interface Game {
  room: string;
  side: Side;
  mode: Mode;
  /** `GameState.startedAt`: a new one is a new game (PLAY AGAIN). */
  startedAt: number;
  solved: number;
  won: boolean;
}

export interface SessionStats {
  /** CREATE LOBBY or JOIN was pressed: the event goes out when the server answers with the room. */
  lobby(asked: 'created' | 'joined'): void;
  sidePicked(side: Side, mode: Mode): void;
  /** Every render: the game started, or it is gone. */
  sync(): void;
  events(events: GameEvent[]): void;
  /** The player is leaving the game. `beacon`: the page is going away too. */
  left(reason: LeftReason, beacon?: boolean): void;
  settings(next: Readonly<Settings>): void;
}

export function createSessionStats(net: Net, screen: () => Screen, start: Readonly<Settings>): SessionStats {
  let asked: 'created' | 'joined' | null = null;
  let game: Game | null = null;
  let seen: Settings = { ...start };
  const settling = new Map<string, ReturnType<typeof setTimeout>>();
  const since = (g: Game) => Math.max(0, Date.now() - g.startedAt);

  function left(reason: LeftReason, beacon = false): void {
    const g = game;
    game = null;
    if (!g || g.won) return;
    track('game_left', { room: g.room, side: g.side, mode: g.mode, faces_solved: g.solved, ms_played: since(g), reason }, { beacon });
  }

  function sync(): void {
    if (asked && !net.busy) {
      if (net.code) track(asked === 'created' ? 'lobby_created' : 'lobby_joined', { room: net.code });
      asked = null;
    }
    const s = net.state;
    if (!net.code || !net.side || !s || net.room?.phase !== 'playing') {
      // not a Leave (that one says so itself): the server took the room or the seat away
      if (game) left(net.lost ?? 'room_gone');
      return;
    }
    if (!game || game.room !== net.code || game.startedAt !== s.startedAt) {
      game = { room: net.code, side: net.side, mode: net.room.mode === 'ai' ? 'solo' : 'coop', startedAt: s.startedAt, solved: 0, won: false };
      if (firstSight(`${game.room}:${game.startedAt}`)) track('game_started', { room: game.room, side: game.side, mode: game.mode, ...screen() });
    }
    game.solved = s.solved.length;
    game.won = s.wonAt !== null;
  }

  return {
    lobby(kind) {
      asked = kind;
    },
    sidePicked: (side, mode) => track('side_picked', { side, mode }),
    sync,
    events(events) {
      sync();
      const g = game;
      const s = net.state;
      if (!g || !s) return;
      for (const e of events) {
        if (e.type === 'solve') track('face_solved', { room: g.room, side: g.side, face: e.face, puzzle_id: e.puzzle, ms_since_start: since(g) });
        // our own only: the partner sends theirs
        else if (e.type === 'strike' && e.side === g.side) track('strike', { room: g.room, side: g.side, face: s.players[g.side].pose.face });
        else if (e.type === 'win') {
          g.won = true;
          track('game_won', { room: g.room, side: g.side, mode: g.mode, ms_total: Math.max(0, (s.wonAt ?? Date.now()) - s.startedAt), strikes_total: s.strikes });
        }
      }
    },
    left,
    settings(next) {
      const changed = (Object.keys(next) as (keyof Settings)[]).filter((k) => (k === 'keys' ? !sameBindings(seen.keys, next.keys) : seen[k] !== next[k]));
      seen = { ...next };
      for (const key of changed) {
        if (key === 'aiVoice') track('ai_voice_picked', { voice: next.aiVoice });
        // the name only, never the value (a key binding is something the player typed)
        clearTimeout(settling.get(key));
        settling.set(
          key,
          setTimeout(() => {
            settling.delete(key);
            track('settings_changed', { setting: key });
          }, SETTLE_MS),
        );
      }
    },
  };
}

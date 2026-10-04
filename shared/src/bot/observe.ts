import { canonToScreen, compassDrift, neighbours, screenToCanon } from '../cube';
import { defaultEnv, itemsOn, objectiveFor, portalOpen, visibleObjects, type GameEnv } from '../game';
import { FACE_NAMES, objectsOn, tileAt } from '../maps';
import type { TileKind } from '../maps/types';
import { FACES, FACE_SIZE, type FaceId, type GameState, type Side } from '../types';
import { signalBars, voiceMix } from '../voice';

// What one side can perceive, as plain data for the AI partner. Built ONLY from that
// side's own view: its map, what puzzles show that side, its own body. It never contains
// the other side's map, objects, position or puzzle internals. Everything is in the
// observer's own screen orientation (col 0 = their left, row 0 = their top), exactly what
// a human on that side sees.

const TERRAIN_CHAR: Record<TileKind, string> = { floor: '.', wall: '#', tree: 'T', water: '~' };

export interface Observation {
  you: Side;
  face: FaceId;
  faceName: string;
  /** Degrees your "up" has turned from the face's own up. */
  compassDrift: number;
  /** Your tile: col 0 to FACE_SIZE-1 from your left, row 0 to FACE_SIZE-1 from your top. */
  position: { col: number; row: number };
  /** FACE_SIZE rows as you see them. '.' floor, '#' wall, 'T' tree, '~' water, '@' you, '*' something (see objects/items). */
  grid: string[];
  objects: { type: string; state?: string; col: number; row: number }[];
  items: { kind: string; col: number; row: number }[];
  carrying: string | null;
  /** The face beyond each edge of your view. */
  edges: Record<'up' | 'down' | 'left' | 'right', { face: FaceId; name: string; solved: boolean }>;
  objective: string;
  /** This face still has something to solve (the objective line above says the same). */
  puzzleHere: boolean;
  /** The id of the puzzle on this face, solved or not. null = this face has none. */
  puzzleId: string | null;
  /** The rules both players are told: which faces hold a puzzle (and which one), and where the portal is. */
  puzzleList: { id: string; face: FaceId }[];
  portalFace: FaceId | null;
  solvedFaces: FaceId[];
  portalOpen: boolean;
  strikes: number;
  /** How well you hear your partner: 3 same wall, 1 the next face over, 0 opposite side (silent). */
  voiceSignal: number;
  won: boolean;
}

export function observe(state: GameState, side: Side, env: GameEnv = defaultEnv): Observation {
  const player = state.players[side];
  const { face, up } = player.pose;
  const toScreen = (x: number, y: number) => {
    const [col, row] = canonToScreen(side, face, up, x, y);
    return { col, row };
  };
  const position = toScreen(player.pose.x, player.pose.y);
  const objects = visibleObjects(state, side, face, env).map((o) => ({ type: o.type, ...(o.state ? { state: o.state } : {}), ...toScreen(o.x, o.y) }));
  const items = itemsOn(state, side, face).map((i) => ({ kind: i.kind, ...toScreen(i.x, i.y) }));

  const grid: string[] = [];
  for (let row = 0; row < FACE_SIZE; row++) {
    let line = '';
    for (let col = 0; col < FACE_SIZE; col++) {
      const [x, y] = screenToCanon(side, face, up, col, row);
      if (col === position.col && row === position.row) line += '@';
      else if (objects.some((o) => o.col === col && o.row === row) || items.some((i) => i.col === col && i.row === row)) line += '*';
      else line += TERRAIN_CHAR[tileAt(env.world, side, face, x, y)];
    }
    grid.push(line);
  }

  const n = neighbours(player.pose);
  const edge = (f: FaceId) => ({ face: f, name: FACE_NAMES[side][f], solved: state.solved.includes(f) });
  const carried = player.carrying ? state.items[player.carrying] : null;
  return {
    you: side,
    face,
    faceName: FACE_NAMES[side][face],
    compassDrift: compassDrift(player.pose),
    position,
    grid,
    objects,
    items,
    carrying: carried ? carried.kind : null,
    edges: { up: edge(n.up), down: edge(n.down), left: edge(n.left), right: edge(n.right) },
    objective: objectiveFor(state, side, env),
    puzzleHere: env.puzzles.some((p) => p.face === face) && !state.solved.includes(face),
    puzzleId: env.puzzles.find((p) => p.face === face)?.id ?? null,
    puzzleList: env.puzzles.map((p) => ({ id: p.id, face: p.face })),
    portalFace: FACES.find((f) => objectsOn(env.world, side, f, 'portal').length > 0) ?? null,
    solvedFaces: [...state.solved],
    portalOpen: portalOpen(state, env),
    strikes: state.strikes,
    voiceSignal: signalBars(voiceMix(state).gain),
    won: state.wonAt !== null,
  };
}

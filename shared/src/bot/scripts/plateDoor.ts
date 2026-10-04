import type { PuzzleScript } from './types';

// PLATE AND DOOR (face 1). Inside: stand on the plate and stay. Outside: wait for the door
// to open, then walk through it to the crystal. Nothing has to be typed.

const RESAY_MS = 25_000;

export const plateDoorScript: PuzzleScript<null> = {
  id: 'plate-door',
  lines: ['plate-door.go', 'plate-door.on', 'plate-door.shut', 'plate-door.open'],
  init: () => null,

  play({ o, objs, say }) {
    if (o.you === 'in') {
      const plate = objs('plate')[0];
      if (!plate) return null;
      if (plate.state !== 'on') {
        say('plate-door.go');
        return { action: { type: 'goto', col: plate.col, row: plate.row }, status: 'walking to the plate' };
      }
      say('plate-door.on', { every: RESAY_MS });
      return { action: null, hold: true, status: 'holding the plate so the door stays open' };
    }
    const door = objs('door')[0];
    const crystal = objs('crystal')[0];
    if (!door || !crystal || crystal.state === 'taken') return null;
    if (door.state === 'open') {
      say('plate-door.open');
      return { action: { type: 'goto', col: crystal.col, row: crystal.row }, status: 'walking through the open door to the crystal' };
    }
    say('plate-door.shut', { every: RESAY_MS });
    return { action: null, status: 'waiting for the partner to open the door' };
  },
};

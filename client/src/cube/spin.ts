import { mul, rotX, rotY, type Mat3 } from './mat';
import { clearTarget, createTarget, drawCube, type CubeFaces } from './raster';

// THE MENU CUBE'S SPIN, rendered once into a strip of frames and then only played back.
// Pure typed arrays (the scene copies them onto a canvas), so the bake is timed and tested
// in node.

/** How far the cube is tipped towards the viewer, so its top shows. */
export const SPIN_TILT = (27 * Math.PI) / 180;
/** Frames in one full turn. */
export const SPIN_FRAMES = 96;

const smooth = (t: number): number => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};
/** How much of the turn one roll takes. */
const ROLL = 0.16;

/**
 * The view at a fraction (0..1) of the turn. The cube turns once on the spot like a
 * turntable, top and two sides in view. A plain turntable would show the rooftop the whole
 * way round and never the cave underneath, so twice per turn the cube also rolls half over
 * on its own x axis: first the cave comes up on top, then the rooftop again. All six
 * biomes come past, and the last frame leads back into the first.
 */
export function spinView(turn: number): Mat3 {
  const yaw = turn * Math.PI * 2 + Math.PI / 5;
  const roll = Math.PI * (smooth((turn - 0.25 + ROLL / 2) / ROLL) + smooth((turn - 0.75 + ROLL / 2) / ROLL));
  return mul(rotX(SPIN_TILT), mul(rotY(yaw), rotX(roll)));
}

export interface Strip {
  /** Size of one frame, in pixels. The cube is centred in it. */
  size: number;
  count: number;
  /** All frames, one after the other: count * size * size pixels (0xAABBGGRR). */
  px: Uint32Array;
}

/** The smallest frame that holds a cube with this half-edge at any angle. */
export const frameSize = (half: number): number => 2 * Math.ceil(half * Math.sqrt(3)) + 2;

export function bakeSpin(faces: CubeFaces, half: number, ink: number, count = SPIN_FRAMES): Strip {
  const size = frameSize(half);
  const frame = createTarget(size, size);
  const px = new Uint32Array(count * size * size);
  for (let i = 0; i < count; i++) {
    clearTarget(frame);
    drawCube(frame, faces, spinView(i / count), { cx: size / 2, cy: size / 2, half, ink });
    px.set(frame.px, i * size * size);
  }
  return { size, count, px };
}

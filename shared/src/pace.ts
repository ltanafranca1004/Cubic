// WALKING PACE. Constants only: the one place that says how fast a turtle walks. The
// client's held-key repeat (keyboard, gamepad and the touch d-pad all arrive as held keys),
// the walk animation and the AI partner's step timer all derive from WALK_PACE, so tuning
// it here changes every one of them together.

/**
 * THE knob: walking speed as a multiple of the original pace. 1 = one step every 130 ms
 * while a direction is held; 0.75 = 25% slower. A single tap is not paced: the first step
 * of a press always goes out at once.
 */
export const WALK_PACE = 0.75;

/** A duration of the original pace, stretched to the current one (whole milliseconds). */
export const paced = (ms: number): number => Math.round(ms / WALK_PACE);

/** One step this often while a direction is held. */
export const STEP_MS = paced(130);
/** How long after a step the walk frame is still shown: two steps, so a held walk never drops to idle. */
export const WALK_HOLD_MS = 2 * STEP_MS;
/** The AI partner walks one step this often (it was always a little slower than a held key). */
export const AI_STEP_MS = paced(200);

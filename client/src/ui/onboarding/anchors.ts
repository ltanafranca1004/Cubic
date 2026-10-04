// WHERE THE HINTS POINT. Every HUD element the onboarding layer attaches to, by selector,
// in one place: when an element is replaced (the cube net by the rotating cube HUD, say),
// repoint it here and nothing else changes.

export const ANCHOR = {
  /** "This is the cube": the HUD's picture of the cube. */
  cube: '.cu-net',
  /** The frame around the game canvas: the side card and the edge hint sit on it, the caption above it. */
  view: '#cu-view',
  /** The HUD's one-line key reminder: the controls hint covers it until it fades. */
  keys: '.cu-keys',
  /** The voice panel: "Your partner sounds farther away" points at it. */
  voice: '#cu-voice',
} as const;

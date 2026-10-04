// 3x3 matrices for the cube renderer. Pure numbers: no DOM, no Phaser.
//
// A view matrix is row-major and its three ROWS are the screen axes written in cube space:
// row 0 = screen right, row 1 = screen up, row 2 = towards the viewer. So `apply(m, v)` is
// where the cube-space vector v lands on screen. A mirrored view (the inside player's) has
// determinant -1; nothing here or in the rasterizer assumes a proper rotation.

export type V3 = readonly [number, number, number];
export type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export const fromRows = (a: V3, b: V3, c: V3): Mat3 => [a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]];

// ("+ 0" turns -0 into 0, as in shared/src/vec.ts)
export const apply = (m: Mat3, v: V3): V3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2] + 0, m[3] * v[0] + m[4] * v[1] + m[5] * v[2] + 0, m[6] * v[0] + m[7] * v[1] + m[8] * v[2] + 0];

/** a after b: `apply(mul(a, b), v) = apply(a, apply(b, v))`. */
export function mul(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[r * 3 + c] = a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!;
  return out as unknown as Mat3;
}

export const transpose = (m: Mat3): Mat3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

export const det = (m: Mat3): number => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);

/** Turn about the screen's x axis. Positive tips the top of the cube towards the viewer. */
export function rotX(rad: number): Mat3 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}

/** Turn about the screen's y axis. Positive brings the left side of the cube to the front. */
export function rotY(rad: number): Mat3 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}

export function rotZ(rad: number): Mat3 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

/** Rotation by `rad` about a unit axis (Rodrigues). */
export function rotAxis(axis: V3, rad: number): Mat3 {
  const [x, y, z] = axis;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const t = 1 - c;
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
}

/** The axis and angle (0..pi) of a proper rotation. A zero turn reports the y axis. */
export function axisAngle(q: Mat3): { axis: V3; angle: number } {
  const cos = Math.min(1, Math.max(-1, (q[0] + q[4] + q[8] - 1) / 2));
  const angle = Math.acos(cos);
  if (angle < 1e-6) return { axis: [0, 1, 0], angle: 0 };
  if (Math.PI - angle < 1e-4) {
    // a half turn: the axis is the largest column of (q + I)
    const cols: V3[] = [
      [q[0] + 1, q[3], q[6]],
      [q[1], q[4] + 1, q[7]],
      [q[2], q[5], q[8] + 1],
    ];
    const best = cols.reduce((a, b) => (len(b) > len(a) ? b : a));
    return { axis: unit(best), angle: Math.PI };
  }
  return { axis: unit([q[7] - q[5], q[2] - q[6], q[3] - q[1]]), angle };
}

const len = (v: V3): number => Math.hypot(v[0], v[1], v[2]);
export function unit(v: V3): V3 {
  const l = len(v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Snap every entry to -1, 0 or 1: for views that must stay exactly axis-aligned. */
export const snap = (m: Mat3): Mat3 => m.map((v) => Math.round(v) + 0) as unknown as Mat3;

/** Cubic ease in and out, 0..1. */
export const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

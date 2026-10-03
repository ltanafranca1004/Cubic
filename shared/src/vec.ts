import type { Vec } from './types';

export const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// "+ 0" turns -0 into 0 so vectors compare and serialize cleanly.
export const neg = (a: Vec): Vec => [-a[0] + 0, -a[1] + 0, -a[2] + 0];
export const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k];
export const eq = (a: Vec, b: Vec): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

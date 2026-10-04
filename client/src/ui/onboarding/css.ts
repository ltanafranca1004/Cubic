import { asset } from '../../style/assets';
import { C, ROLE } from '../../style/tokens';

// The onboarding layer's own stylesheet. Same rules as ../css.ts: sizes in art pixels
// ("4u"), the kit's 9-slices, the m5x7 font inherited from .cu. Every panel here is the
// LIGHT kit panel with ink text on both sides, so a hint reads the same inside and outside.

const url = (path: string) => `url("${asset(path)}")`;

const RAW = `
.cu-onb { position: absolute; inset: 0; pointer-events: none; z-index: 6; display: none; }
.cu[data-screen="game"] .cu-onb { display: block; }
.cu-onb > * { position: absolute; left: 0; top: 0; margin: 0; opacity: 0; visibility: hidden; transition: opacity 0.32s steps(4), visibility 0s 0.32s; }
.cu-onb > .on { opacity: 1; visibility: visible; transition: opacity 0.32s steps(4); }
.cu-onb.still > * { transition: none; }
.cu-onb .cu-panel { text-transform: none; }
.cu-onb b { font-weight: normal; }

.cu-onb-card { width: 204u; padding: 3u 3u 5u; display: flex; align-items: center; gap: 5u; }
.cu-onb-card i { display: block; flex: none; width: 46u; height: 44u; background: ${url('ui/cube-out.png')} 0 0 / 46u 44u no-repeat; }
.cu-onb-card[data-side="in"] i { background-image: ${url('ui/cube-in.png')}; }
.cu-onb-card h3 { font: inherit; font-weight: normal; margin: 0 0 4u; }
.cu-onb-card h3 b { color: ${ROLE.out.dark}; }
.cu-onb-card[data-side="in"] h3 b { color: ${ROLE.in.deep}; }
.cu-onb-card p { margin: 0; color: ${ROLE.dimOnLight}; }

.cu-onb-keys { width: 196u; padding: 0 1u 3u; display: flex; flex-wrap: wrap; justify-content: center; gap: 3u 7u; }
.cu-onb-keys > div { display: flex; align-items: center; gap: 2u; white-space: nowrap; }
.cu-onb-keys kbd { font: inherit; text-transform: uppercase; display: block; height: 11u; line-height: 7u; padding: 0 2u 0 3u; background: ${C.white}; color: ${ROLE.ink}; outline: 1u solid ${ROLE.ink}; box-shadow: 0 2u 0 ${ROLE.ink}; margin: 0 1u 2u; }
.cu-onb-keys > div > span { display: block; margin-top: -2u; }

.cu-onb-hint { width: 116u; padding: 0 2u 3u; display: flex; align-items: center; gap: 2u; }
.cu-onb-hint > span { flex: 1; }
.cu-onb-hint > i { display: none; margin: 0 -2u; }
.cu-onb-hint[data-arrow="left"] > i.left, .cu-onb-hint[data-arrow="right"] > i.right { display: block; }

`;

export const ONBOARDING_CSS = RAW.replace(/(-?\d+(?:\.\d+)?)u\b/g, 'calc($1px * var(--u))');

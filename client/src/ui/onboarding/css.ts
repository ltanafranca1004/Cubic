import { ROLE } from '../../style/tokens';
import { units } from '../css';

// The onboarding layer's own stylesheet. Same rules as ../css.ts: sizes in art pixels
// ("4u"), the kit's 9-slices, the m5x7 font inherited from .cu. Every panel here is the
// LIGHT kit panel with ink text on both sides, so a hint reads the same inside and outside.

const RAW = `
.cu-onb { position: absolute; inset: 0; pointer-events: none; z-index: 6; display: none; }
.cu[data-screen="game"] .cu-onb { display: block; }
.cu-onb > * { position: absolute; left: 0; top: 0; margin: 0; opacity: 0; visibility: hidden; transition: opacity 0.32s steps(4), visibility 0s 0.32s; }
.cu-onb > .on { opacity: 1; visibility: visible; transition: opacity 0.32s steps(4); }
.cu-onb.still > * { transition: none; }
.cu-onb .cu-panel { text-transform: none; }
.cu-onb b { font-weight: normal; }

/* The side card: small, at the top of the view, and the one part of this layer that takes
   the pointer (its GOT IT button; a click anywhere else closes it too). */
.cu-onb-card { width: 172t; padding: 1t 2t 3t; }
.cu-onb-card.on { pointer-events: auto; }
.cu-onb-card header { display: flex; align-items: center; justify-content: space-between; gap: 4t; margin: 0 0 3t; }
.cu-onb-card h3 { font: inherit; font-weight: normal; margin: -2t 0 0; white-space: nowrap; }
.cu-onb-card h3 b { color: ${ROLE.out.dark}; }
.cu-onb-card[data-side="in"] h3 b { color: ${ROLE.in.deep}; }
.cu-onb-card p { margin: 0; color: var(--dim); }
.cu-onb-card .cu-chipbtn > span { display: block; margin-top: -3t; }

.cu-onb-keys { max-width: calc(var(--view) - 8u); width: max-content; padding: 0 1t 3t; display: flex; flex-wrap: wrap; justify-content: center; gap: 3t 7t; }
.cu-onb-keys > div { display: flex; align-items: center; gap: 2t; white-space: nowrap; }
.cu-onb-keys > div > span { display: block; margin-top: -2t; }

.cu-onb-hint { width: 116t; padding: 0 2t 3t; display: flex; align-items: center; gap: 2t; }
.cu-onb-hint > span { flex: 1; }
.cu-onb-hint > i { display: none; margin: 0 -2u; }
.cu-onb-hint[data-arrow="left"] > i.left, .cu-onb-hint[data-arrow="right"] > i.right { display: block; }

`;

export const ONBOARDING_CSS = units(RAW);

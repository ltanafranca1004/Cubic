import { asset, ICONS } from '../../style/assets';
import { TOUCH } from '../../style/fit';
import { C, ROLE } from '../../style/tokens';

// The touch layer's own stylesheet: the on-screen controls, the two touch layouts of the
// game screen, the rotate card and the room-code keys. Same rules as ../css.ts: the kit's
// 9-slices, the m5x7 font inherited from .cu, art sizes in "u" (4u = four art pixels).
// What a THUMB presses is sized in real CSS pixels instead (44px is 44px on every phone).
//
// Everything here is keyed on .cu[data-touch] ("compact" on a phone, "wide" on a tablet),
// which only ui/mobile sets, and only on a touch screen: a desktop never matches a rule
// in this file. The numbers that place things (--m-*) are set by ui/mobile/index.ts from
// style/fit.ts, the same arithmetic the zoom of the game view comes from.

const url = (path: string) => `url("${asset(path)}")`;
const nine = (path: string, corner: number) => `border: ${corner}u solid transparent; border-image: ${url(path)} ${corner} fill / ${corner}u stretch;`;
const icon = (name: (typeof ICONS)[number]) => `-${ICONS.indexOf(name) * 16}u 0`;

const COMPACT = '.cu[data-touch="compact"]';
const WIDE = '.cu[data-touch="wide"]';
const GAME = '[data-screen="game"]';

const RAW = `
/* ---------- the page: no zoom, no scroll, no pull to refresh, no long-press menu ---------- */
html[data-touch], html[data-touch] body { height: 100dvh; overscroll-behavior: none; touch-action: none; -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
html[data-touch] body { position: fixed; inset: 0; }
/* the strips beside a notch take the colour of the screen they are next to */
html[data-touch][data-dark] body { background: ${ROLE.ink}; }
.cu[data-touch] {
  /* clear of the notch and the rounded corners; the bottom is kept (see style/scale.ts) */
  top: env(safe-area-inset-top, 0px); left: env(safe-area-inset-left, 0px); right: env(safe-area-inset-right, 0px);
  --sab: env(safe-area-inset-bottom, 0px);
  touch-action: none; -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent;
  cursor: auto;
}
/* no pointer on a touch screen (and no cursor file for a scale that is not a whole number) */
.cu[data-touch], .cu[data-touch] * { cursor: auto !important; }
/* the Controls tab rebinds keyboard keys: nothing to do there with fingers */
.cu[data-touch] .cu-tabs > [data-tab="controls"] { display: none; }
.cu[data-touch] .cu-tabs > span { min-height: 44px; display: flex; align-items: center; }
.cu[data-touch] input { touch-action: manipulation; -webkit-user-select: text; user-select: text; }
.cu[data-touch] .cu-log, .cu[data-touch] .cu-modal > .cu-panel { touch-action: pan-y; overscroll-behavior: contain; }

/* ---------- menus and panels under a thumb ---------- */
/* a panel never leaves the screen: it scrolls inside itself */
.cu[data-touch] .cu-modal > .cu-panel { max-width: calc(100% - 8px); max-height: calc(100% - 8px); overflow-y: auto; scrollbar-width: none; }
.cu[data-touch] .cu-modal > .cu-panel::-webkit-scrollbar { display: none; }
.cu[data-touch] .cu-modal .cu-btn, .cu[data-touch] .cu-vbtns .cu-btn { min-height: 44px; min-width: 64px; }
/* small things keep their look and get a larger place to press */
.cu[data-touch] .cu-gear, .cu[data-touch] .cu-toggle, .cu[data-touch] .cu-slider, .cu[data-touch] .cu-room, .cu[data-touch] .cu-top .cu-btn { position: relative; }
.cu[data-touch] .cu-gear::after, .cu[data-touch] .cu-room::after { content: ""; position: absolute; inset: -14px; }
.cu[data-touch] .cu-top .cu-btn::after { content: ""; position: absolute; inset: -12px; }
.cu[data-touch] .cu-toggle::after { content: ""; position: absolute; inset: -12px -10px; }
.cu[data-touch] .cu-slider::after { content: ""; position: absolute; inset: -12px 0; }
.cu[data-touch] .cu-set { min-height: 36px; }
.cu[data-touch] .cu-seg span { min-width: 40px; height: 32px; display: flex; align-items: center; justify-content: center; }
/* the keyboard hints mean nothing here: the buttons carry their own names */
.cu[data-touch] .cu-onb-keys { opacity: 0 !important; }
/* chat goes through the chat button (the field would sit under the on-screen keyboard) */
.cu[data-touch] #cu-chat { display: none; }

/* ---------- the controls ---------- */
.cu-m { display: none; }
.cu[data-touch]${GAME} .cu-m { display: block; }
.cu-m-btn {
  ${nine('ui/btn-dark-idle.png', 6)}
  position: relative; display: flex; align-items: center; justify-content: center; gap: 2u; min-width: 0; padding: 0;
  color: ${ROLE.paper}; white-space: nowrap; line-height: 7u; touch-action: none; pointer-events: auto;
}
/* (the label may run over the 9-slice's border: only its outer 2 pixels are drawn) */
.cu-m-btn > span { display: block; margin: -3u -4u 0; }
.cu-m-btn.on { border-image-source: ${url('ui/btn-dark-pressed.png')}; }
.cu-m-btn.on > span { margin-top: 1u; }
.cu-m-btn.go { border-image-source: ${url('ui/btn-in-idle.png')}; color: ${ROLE.ink}; }
.cu-m-btn.go.on { border-image-source: ${url('ui/btn-in-pressed.png')}; }
.cu-m-btn.lit { border-image-source: ${url('ui/btn-out-idle.png')}; color: ${ROLE.ink}; }
.cu-m-btn.lit.on { border-image-source: ${url('ui/btn-out-pressed.png')}; }
.cu-m-btn.warn { border-image-source: ${url('ui/btn-danger-idle.png')}; color: ${ROLE.paper}; }
.cu-m-btn.warn.on { border-image-source: ${url('ui/btn-danger-pressed.png')}; }
.cu-m-btn.idle { border-image-source: ${url('ui/btn-disabled.png')}; color: ${ROLE.dimOnLight}; }
.cu-m-btn[hidden] { display: none; }
/* a pixel dot: something new behind this button */
.cu-m-btn.new::after { content: ""; position: absolute; right: 0; top: 0; width: 5u; height: 5u; background: ${ROLE.signal}; outline: 1u solid ${ROLE.ink}; }

.cu-m-acts { position: absolute; z-index: 4; display: grid; grid-template-columns: repeat(3, var(--m-btn)); grid-auto-rows: ${TOUCH.buttonHeight}px; gap: ${TOUCH.gap}px; }
.cu-m-acts > i { display: block; }

/* the d-pad: a cross of four arms. The whole square listens; the angle picks the arm. */
.cu-m-pad { position: absolute; z-index: 4; width: var(--m-pad); height: var(--m-pad); display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-template-rows: repeat(3, minmax(0, 1fr)); touch-action: none; pointer-events: auto; }
.cu-m-pad > i { ${nine('ui/btn-dark-idle.png', 6)} position: relative; min-width: 0; min-height: 0; pointer-events: none; }
.cu-m-pad > i::before { content: ""; position: absolute; left: 50%; top: 50%; width: 16u; height: 16u; margin: -9u 0 0 -8u; background: ${url('ui/icons.png')} ${icon('left')} / ${ICONS.length * 16}u 16u no-repeat; }
.cu-m-pad > .up { grid-column: 2; grid-row: 1; }
.cu-m-pad > .left { grid-column: 1; grid-row: 2; }
.cu-m-pad > .right { grid-column: 3; grid-row: 2; }
.cu-m-pad > .down { grid-column: 2; grid-row: 3; }
.cu-m-pad > .hub { grid-column: 2; grid-row: 2; border: 0; border-image: none; background: ${ROLE.ink}; margin: -1u; }
.cu-m-pad > .hub::before { display: none; }
.cu-m-pad > .up::before { transform: rotate(90deg); }
.cu-m-pad > .down::before { transform: rotate(-90deg); }
.cu-m-pad > .right::before { background-position: ${icon('right')}; }
.cu-m-pad[data-dir="up"] > .up, .cu-m-pad[data-dir="down"] > .down, .cu-m-pad[data-dir="left"] > .left, .cu-m-pad[data-dir="right"] > .right { border-image-source: ${url('ui/btn-in-pressed.png')}; }
.cu-m-pad[data-dir="up"] > .up::before, .cu-m-pad[data-dir="down"] > .down::before, .cu-m-pad[data-dir="left"] > .left::before, .cu-m-pad[data-dir="right"] > .right::before { margin-top: -6u; }

/* in the dark rooms the controls are the light kit, as every button on a dark surface is */
.cu[data-side="in"] .cu-m > .cu-m-btn:not(.go):not(.warn):not(.lit):not(.idle), .cu[data-side="in"] .cu-m-acts > .cu-m-btn:not(.go):not(.warn):not(.lit):not(.idle) { border-image-source: ${url('ui/btn-light-idle.png')}; color: ${ROLE.ink}; }
.cu[data-side="in"] .cu-m > .cu-m-btn.on:not(.go):not(.warn):not(.lit):not(.idle), .cu[data-side="in"] .cu-m-acts > .cu-m-btn.on:not(.go):not(.warn):not(.lit):not(.idle) { border-image-source: ${url('ui/btn-light-pressed.png')}; }
.cu[data-side="in"] .cu-m-pad > i { border-image-source: ${url('ui/btn-light-idle.png')}; }
.cu[data-side="in"] .cu-m-pad > .hub { background: ${C.mist}; }

/* ---------- chat: a field at the top of the screen, clear of the on-screen keyboard ---------- */
.cu-m-chat { position: absolute; z-index: 9; top: 4px; left: 8px; right: 8px; max-width: 560px; margin: 0 auto; display: none; flex-direction: column; gap: 4px; padding: 2u; pointer-events: auto; }
.cu-m-chat.on { display: flex; }
.cu-m-chat > div { display: flex; gap: 4px; }
.cu-m-chat .cu-field { flex: 1; min-width: 0; height: 44px; text-transform: none; }
.cu-m-chat .cu-m-btn { height: 44px; flex: 1; padding: 0 2u; }
.cu-m-chat .cu-m-send, .cu-m-chat .cu-m-x { flex: none; width: 64px; }
/* the veil behind the chat field and behind the HUD panel: a tap on it closes them */
.cu-m-shade { position: absolute; inset: 0; z-index: 6; display: none; background: rgba(46, 34, 47, 0.72); pointer-events: auto; }
.cu[data-drawer="on"] .cu-m-shade, .cu-m-chat.on ~ .cu-m-shade { display: block; }
.cu[data-drawer="on"] .cu-m-shade { z-index: 8; }
.cu-m-chat.on ~ .cu-m-shade { z-index: 8; background: rgba(46, 34, 47, 0.45); }

/* ---------- the room code keys (join popup): two blocks beside the popup ---------- */
.cu-m-code { position: absolute; inset: 0; z-index: 6; display: none; align-items: center; justify-content: space-between; padding: 0 ${TOUCH.margin}px var(--sab); pointer-events: none; }
.cu-m-code.on { display: flex; }
/* (the popup is 196 art pixels wide, in the middle) */
.cu-m-code > div { display: grid; grid-template-columns: repeat(4, 1fr); grid-auto-rows: 48px; gap: ${TOUCH.gap}px; width: min(270px, calc((100% - 196u) / 2 - 2 * ${TOUCH.margin}px)); }
.cu-m-code .cu-m-btn { border-image-source: ${url('ui/btn-light-idle.png')}; color: ${ROLE.ink}; }
.cu-m-code .cu-m-btn.on { border-image-source: ${url('ui/btn-light-pressed.png')}; }
.cu-m-code .cu-m-btn.back { grid-column: span 3; border-image-source: ${url('ui/btn-dark-idle.png')}; color: ${ROLE.paper}; }
.cu-m-code .cu-m-btn.back.on { border-image-source: ${url('ui/btn-dark-pressed.png')}; }

/* ---------- rotate your device ---------- */
.cu-modal.cu-m-rotate { position: fixed; inset: 0; z-index: 20; background: ${ROLE.sky}; }
.cu-m-rotate .cu-panel { display: flex; flex-direction: column; align-items: center; gap: 6u; padding: 8u 10u 10u; text-align: center; }
.cu-m-rotate b { font: 32u/22u "m5x7", monospace; font-weight: normal; }
.cu-m-rotate p { margin: 0; text-transform: none; color: ${ROLE.dimOnLight}; }
/* a pixel phone that tips over onto its side, in two frames */
.cu-m-phone { position: relative; width: 44u; height: 44u; }
.cu-m-phone i { position: absolute; left: 13u; top: 4u; width: 18u; height: 36u; background: ${ROLE.ink}; box-shadow: inset 0 0 0 2u ${ROLE.ink}, inset 0 0 0 3u ${C.silver}; animation: cu-m-tip 1.6s steps(1) infinite; }
.cu-m-phone i::before { content: ""; position: absolute; left: 3u; top: 4u; right: 3u; bottom: 6u; background: ${ROLE.in.base}; }
.cu-m-phone i::after { content: ""; position: absolute; left: 7u; bottom: 2u; width: 4u; height: 2u; background: ${C.silver}; }
@keyframes cu-m-tip { 0% { transform: rotate(0deg); } 50% { transform: rotate(-90deg); } }
.cu[data-motion="reduce"] .cu-m-phone i { animation: none; transform: rotate(-90deg); }

/* ================= a phone held sideways ================= */
${COMPACT} { --frame: 0px; --hud-x: 0px; --hud-y: 0px; --view-x: calc(var(--m-vx) + var(--view) / 2); --view-top: var(--m-vy); }
${COMPACT}${GAME} .cu-hud { display: block; left: 0; width: 100%; pointer-events: none; animation: none; }
/* (with the panel open, the labels on the view would show through it) */
${COMPACT}[data-drawer="on"] .cu-edge { display: none; }
${COMPACT} .cu-mid { position: absolute; left: var(--m-vx); top: var(--m-vy); width: var(--view); height: var(--view); margin: 0; display: block; }
/* the faces across the edges: left and right in the rails, top and bottom on the view's own edge */
${COMPACT} .cu-edge { position: absolute; z-index: 3; }
${COMPACT} .cu-edge.t, ${COMPACT} .cu-edge.b { left: 0; right: 0; width: max-content; margin: 0 auto; padding: 0 3u 0 2u; background: ${ROLE.ink}; color: ${ROLE.paper}; }
${COMPACT} .cu-edge.t { top: 0; }
${COMPACT} .cu-edge.b { bottom: var(--sab); }
${COMPACT} .cu-edge.t.done, ${COMPACT} .cu-edge.b.done { color: ${ROLE.out.light}; }
${COMPACT} .cu-edge.t .cu-chip, ${COMPACT} .cu-edge.b .cu-chip { outline-color: ${ROLE.paper}; }
${COMPACT} .cu-edge.l, ${COMPACT} .cu-edge.r { top: 0; bottom: 0; height: max-content; margin: auto 0; }
${COMPACT} .cu-edge.l { right: calc(100% + 2u); }
${COMPACT} .cu-edge.r { left: calc(100% + 2u); }
${COMPACT} .cu-cubemap { left: var(--m-vx); width: var(--view); }
${COMPACT}${GAME} .cu-subs { bottom: calc(100% - var(--view-top) - var(--view) + 16u + var(--sab)); }
/* a hint that points at the HUD column has nothing to point at: the column is folded away */
${COMPACT} .cu-onb-hint[data-arrow="left"], ${COMPACT} .cu-onb-hint[data-arrow="right"] { display: none; }

/* left rail: what to do (always in sight) over the d-pad */
${COMPACT} .cu-m-glance { position: absolute; z-index: 4; left: ${TOUCH.margin}px; top: ${TOUCH.margin}px; width: calc(var(--m-rail) - var(--m-band) - ${2 * TOUCH.margin}px); max-height: calc(100% - var(--m-pad) - var(--sab) - ${4 * TOUCH.margin}px); overflow: hidden; display: flex; flex-direction: column; gap: 3u; pointer-events: auto; }
.cu-m-glance { display: none; }
.cu[data-side="in"] .cu-m-glance { ${nine('ui/panel-dark.png', 6)} color: ${ROLE.paper}; --dim: ${ROLE.dimOnDark}; }
.cu-m-glance .cu-face, .cu-m-glance .cu-prog { flex: none; }
.cu-m-glance .cu-m-clock { margin-left: auto; color: var(--dim); }
.cu-m-glance p { margin: 0; text-transform: none; font-size: calc(16px * var(--tu)); line-height: calc(13px * var(--tu)); overflow-wrap: anywhere; }
.cu-m-glance .cu-m-carry { display: flex; align-items: center; gap: 3u; height: 16u; flex: none; }
.cu-m-glance .cu-m-carry > span { display: block; margin-top: -2u; }
${COMPACT} .cu-m-pad { left: calc((var(--m-rail) - var(--m-band) - var(--m-pad)) / 2); bottom: calc(${TOUCH.margin}px + var(--sab)); }
/* right rail: the HUD button on top, the actions under the thumb */
${COMPACT} .cu-m-acts { right: ${TOUCH.margin}px; bottom: calc(${TOUCH.margin}px + var(--sab)); }
${COMPACT} .cu-m-info { position: absolute; z-index: 4; right: ${TOUCH.margin}px; top: ${TOUCH.margin}px; width: calc(3 * var(--m-btn) + ${2 * TOUCH.gap}px); height: 44px; }
.cu-m-info { display: none; }
${COMPACT} .cu-m-info { display: flex; }
${COMPACT}[data-drawer="on"] .cu-m-info { z-index: 10; width: 64px; }

/* the HUD column, folded away: the HUD button opens it as a panel over the game */
${COMPACT} .cu-col { display: none; }
${COMPACT}[data-drawer="on"] .cu-col {
  display: grid; position: absolute; z-index: 9; inset: 0; margin: auto; pointer-events: auto;
  width: min(calc(100% - 160px), 380u); height: min(calc(100% - 8px - var(--sab)), 236u);
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-rows: 44px auto auto minmax(0, 1fr);
  grid-template-areas: "top top" "where voice" "where stats" "where chat"; gap: var(--gap);
}
${COMPACT} .cu-where { grid-area: where; align-self: start; }
${COMPACT} .cu-voice { grid-area: voice; }
${COMPACT} .cu-stats { grid-area: stats; }
${COMPACT} .cu-chat { grid-area: chat; min-height: 0; }
/* the top bar (leave, room, gear) is the head of that panel */
${COMPACT}${GAME} .cu-top { display: none; }
${COMPACT}${GAME}[data-drawer="on"] .cu-top { display: flex; z-index: 10; left: 0; right: 0; margin: 0 auto; width: min(calc(100% - 160px), 380u); top: max(4px, calc((100% - var(--sab) - 236u) / 2)); }

/* ================= a tablet held sideways ================= */
/* the desktop layout, moved to the top; the controls are in the strip under it */
${WIDE} { --hud-y: 0px; }
${WIDE} .cu-col { margin-bottom: calc(${2 * TOUCH.buttonHeight + TOUCH.gap + 2 * TOUCH.margin}px + var(--sab)); }
${WIDE} .cu-m-pad { left: calc(var(--hud-x) + ${TOUCH.margin}px); bottom: calc(max(${TOUCH.margin / 2}px, (var(--m-strip) - var(--m-pad)) / 2) + var(--sab)); }
${WIDE} .cu-m-acts { right: var(--hud-x); bottom: calc(${TOUCH.margin}px + var(--sab)); }
`;

export const MOBILE_CSS = RAW.replace(/(-?\d+(?:\.\d+)?)u\b/g, 'calc($1px * var(--u))');

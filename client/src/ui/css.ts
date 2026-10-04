import { asset, ICONS } from '../style/assets';
import { C, FACE_STYLE, ROLE } from '../style/tokens';

// The stylesheet of the DOM UI (HUD, chat, voice, settings, win screen).
// Sizes are written in ART PIXELS with the unit "u" (4u = four art pixels) and turned into
// calc(4px * var(--u)), where --u is the whole-number UI scale. So the DOM is laid out on
// the same pixel grid as the canvases, and every image is scaled with nearest-neighbour.

const url = (path: string) => `url("${asset(path)}")`;
/** A 9-slice from the kit as a CSS border. `corner` is the slice size in art pixels. */
const nine = (path: string, corner: number) => `border: ${corner}u solid transparent; border-image: ${url(path)} ${corner} fill / ${corner}u stretch;`;

const faceVars = Object.entries(FACE_STYLE)
  .map(([face, s]) => `--face-${face}: ${s.base};`)
  .join('');

const RAW = `
@font-face { font-family: "m5x7"; src: ${url('fonts/m5x7.ttf')} format("truetype"); font-display: block; }

:root {
  --u: 2;
  --ink: ${ROLE.ink}; --paper: ${ROLE.paper}; --dim: ${ROLE.dimOnLight};
  --out: ${ROLE.out.base}; --in: ${ROLE.in.base}; --danger: ${ROLE.danger}; --ok: ${ROLE.ok};
  --signal: ${ROLE.signal}; --portal: ${ROLE.portal}; --p1: ${ROLE.p1.base}; --p2: ${ROLE.p2.base};
  ${faceVars}
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; overflow: hidden; background: ${ROLE.surface}; }
#app { height: 100%; }

.cu {
  position: fixed; inset: 0; overflow: hidden;
  font: 16u/13u "m5x7", monospace; color: var(--ink); text-transform: uppercase;
  -webkit-font-smoothing: none; font-smooth: never; text-rendering: optimizeSpeed;
  image-rendering: pixelated; user-select: none;
  cursor: var(--cursor), auto;
}
.cu[data-side="in"] { color: var(--paper); --dim: ${ROLE.dimOnDark}; }
.cu button, .cu input { font: inherit; text-transform: inherit; cursor: inherit; margin: 0; }
.cu canvas { image-rendering: pixelated; display: block; }
.cu [hidden] { display: none !important; }
.cu-stage { position: absolute; inset: 0; }

/* ---------- kit ---------- */
.cu-panel { ${nine('ui/panel.png', 6)} color: ${ROLE.ink}; --dim: ${ROLE.dimOnLight}; }
.cu[data-side="in"] .cu-hud .cu-panel { ${nine('ui/panel-dark.png', 6)} color: ${ROLE.paper}; --dim: ${ROLE.dimOnDark}; }
.cu-dim { color: var(--dim); }

.cu-btn {
  ${nine('ui/btn-dark-idle.png', 6)}
  height: 22u; padding: 0 4u; line-height: 7u; color: ${ROLE.paper}; background: none; white-space: nowrap;
  display: inline-flex; align-items: center; justify-content: center; gap: 3u;
}
.cu-btn > span { display: block; margin-top: -3u; }
.cu-btn:hover, .cu-btn:focus-visible { border-image-source: ${url('ui/btn-dark-hover.png')}; outline: none; }
.cu-btn:active > span { margin-top: 1u; }
.cu-btn:active { border-image-source: ${url('ui/btn-dark-pressed.png')}; }
${(['light', 'out', 'in', 'danger'] as const)
  .map(
    (v) => `
.cu-btn.${v} { border-image-source: ${url(`ui/btn-${v}-idle.png`)}; color: ${v === 'danger' ? ROLE.paper : ROLE.ink}; }
.cu-btn.${v}:hover, .cu-btn.${v}:focus-visible { border-image-source: ${url(`ui/btn-${v}-hover.png`)}; }
.cu-btn.${v}:active { border-image-source: ${url(`ui/btn-${v}-pressed.png`)}; }`,
  )
  .join('')}
.cu-btn:disabled, .cu-btn:disabled:hover, .cu-btn:disabled:active { border-image-source: ${url('ui/btn-disabled.png')}; color: ${ROLE.dimOnLight}; }
.cu-btn:disabled:active > span { margin-top: -3u; }

.cu-ico { display: inline-block; width: 16u; height: 16u; flex: none; background: ${url('ui/icons.png')} 0 0 / ${ICONS.length * 16}u 16u no-repeat; }
${ICONS.map((name, i) => `.cu-ico.${name} { background-position: -${i * 16}u 0; }`).join('\n')}

.cu-field {
  ${nine('ui/field.png', 4)}
  height: 18u; padding: 0 2u; line-height: 10u; width: 100%; color: ${ROLE.ink}; background: none; outline: none; text-transform: none;
}
.cu-field:focus { border-image-source: ${url('ui/field-active.png')}; }
.cu-field::placeholder { color: ${ROLE.dimOnLight}; text-transform: uppercase; }

/* ---------- top bar: leave, room code, gear. The same on every screen. ---------- */
.cu-top { position: absolute; top: 4u; left: 6u; right: 6u; height: 22u; display: flex; align-items: flex-start; justify-content: space-between; pointer-events: none; z-index: 5; }
.cu-top > * { pointer-events: auto; }
.cu-top-side { width: 80u; display: flex; }
.cu-top-side.r { justify-content: flex-end; }
.cu-room { ${nine('ui/tag.png', 4)} height: 18u; padding: 0 5u; line-height: 10u; color: ${ROLE.paper}; display: flex; gap: 5u; white-space: nowrap; }
.cu-room span { display: block; margin-top: -1u; }
.cu-room .k { color: ${ROLE.dimOnDark}; }
.cu-room .v { color: ${ROLE.in.base}; letter-spacing: 1u; }
.cu-gear { width: 16u; height: 16u; margin: 2u; padding: 0; border: 0; background: ${url('ui/gear.png')} 0 0 / 32u 16u no-repeat; }
.cu-gear:hover, .cu-gear:focus-visible, .cu-gear.on { background-position: -16u 0; outline: none; }
.cu-banner { position: absolute; top: 26u; left: 50%; transform: translateX(-50%); ${nine('ui/tag.png', 4)} height: 18u; padding: 0 5u; line-height: 10u; color: ${C.salmon}; white-space: nowrap; z-index: 5; }
.cu-banner span { display: block; margin-top: -1u; }

/* ---------- in-game HUD ---------- */
/* Sized for the smallest logical screen, 480x270, with a 192u game view (FACE_SIZE 12 x 16):
   across 115 + 6 + 226 + 6 + 115 = 468u, down 13 + 196 + 13 + 13 = 235u of the 236u. */
.cu-hud { position: absolute; inset: 28u 6u 6u 6u; display: none; grid-template-columns: minmax(115u, 150u) auto minmax(115u, 150u); justify-content: center; align-content: center; gap: 6u; align-items: stretch; }
.cu[data-screen="game"] .cu-hud { display: grid; animation: cu-in 0.48s steps(4) both; }
@keyframes cu-in { from { opacity: 0; } to { opacity: 1; } }
.cu-col { display: flex; flex-direction: column; gap: 4u; min-width: 0; max-height: 236u; }

.cu-mid { align-self: start; display: grid; grid-template-columns: 13u auto 13u; grid-template-rows: 13u auto 13u 13u; justify-items: center; align-items: center; column-gap: 2u; }
.cu-view { grid-column: 2; grid-row: 2; padding: 2u; background: ${ROLE.ink}; line-height: 0; }
#game { line-height: 0; }
.cu-edge { white-space: nowrap; color: ${ROLE.paper}; display: flex; align-items: center; gap: 3u; height: 13u; }
.cu[data-side="out"] .cu-edge { color: ${ROLE.ink}; }
.cu-edge.t { grid-column: 2; grid-row: 1; }
.cu-edge.b { grid-column: 2; grid-row: 3; }
.cu-edge.l { grid-column: 1; grid-row: 2; writing-mode: vertical-rl; transform: rotate(180deg); width: 13u; height: auto; }
.cu-edge.r { grid-column: 3; grid-row: 2; writing-mode: vertical-rl; width: 13u; height: auto; }
.cu-edge i { width: 5u; height: 5u; background: var(--c); outline: 1u solid ${ROLE.ink}; flex: none; }
.cu-edge.done { color: ${ROLE.out.dark}; }
.cu[data-side="in"] .cu-edge.done { color: ${ROLE.out.light}; }
.cu-keys { grid-column: 1 / 4; grid-row: 4; color: ${ROLE.dimOnDark}; white-space: nowrap; word-spacing: -2u; }
.cu[data-side="out"] .cu-keys { color: ${ROLE.ink}; }
.cu[data-side="in"] .cu-view { background: ${C.slate}; }
.cu[data-side="in"] .cu-room, .cu[data-side="in"] .cu-banner { border-image-source: ${url('ui/tag-light.png')}; }
.cu[data-side="in"] .cu-banner { color: ${ROLE.dangerDark}; }
.cu[data-side="in"] .cu-room .k { color: ${ROLE.dimOnLight}; }
.cu[data-side="in"] .cu-room .v { color: ${ROLE.in.deep}; }

.cu-you { display: flex; align-items: center; gap: 4u; }
.cu-hero { width: 16u; height: 16u; background: ${url('sprites/player-out.png')} 0 0 / 64u 16u; flex: none; }
.cu[data-side="in"] .cu-hero { background-image: ${url('sprites/player-in.png')}; }
.cu-you b { font-weight: normal; color: ${ROLE.out.dark}; }
.cu[data-side="in"] .cu-you b { color: ${ROLE.in.base}; }
.cu-where { display: flex; align-items: baseline; gap: 4u; }
.cu-where b { font-weight: normal; }
.cu-rule { height: 1u; background: var(--dim); opacity: 1; margin: 3u 0; }
.cu-drift { display: flex; align-items: center; gap: 4u; }
.cu-compass { width: 16u; height: 16u; background: ${url('ui/compass.png')} 0 0 / 16u 16u; flex: none; }
.cu-net { display: grid; grid-template-columns: repeat(4, 13u); grid-auto-rows: 13u; gap: 1u; margin: 1u 0; }
.cu-net div { background: ${C.mist}; color: ${ROLE.dimOnLight}; text-align: center; line-height: 9u; outline: 1u solid ${ROLE.ink}; position: relative; }
.cu-net div span { display: block; margin-top: -1u; padding-left: 1u; }
.cu[data-side="in"] .cu-net div { background: ${C.slate}; color: ${C.silver}; }
.cu-net div.ok, .cu[data-side="in"] .cu-net div.ok { background: var(--c); color: ${ROLE.ink}; }
.cu-net div.here { outline: 2u solid ${ROLE.focus}; z-index: 1; }
.cu-net div.portal, .cu[data-side="in"] .cu-net div.portal { background: ${ROLE.portal}; color: ${ROLE.paper}; animation: cu-blink 0.84s steps(2) infinite; }
@keyframes cu-blink { 50% { background: ${ROLE.portalDark}; } }
.cu-obj { margin: 0; text-transform: none; min-height: 39u; }
.cu-carry { display: flex; align-items: center; gap: 3u; min-height: 16u; }
.cu-item { width: 16u; height: 16u; background: ${url('sprites/items.png')} 0 0 / 48u 16u; flex: none; }

.cu-stats { display: flex; justify-content: space-between; align-items: center; }
.cu-stats > div { display: flex; align-items: center; gap: 2u; }
.cu-stats .x { color: ${ROLE.danger}; }
.cu-voice { display: flex; flex-direction: column; gap: 2u; }
.cu-vrow { display: flex; align-items: center; gap: 3u; min-height: 13u; }
.cu-dot { width: 5u; height: 5u; background: ${C.mauve}; outline: 1u solid ${ROLE.ink}; flex: none; margin: 0 1u; }
.cu-dot.on { background: var(--signal); }
.cu-signal { width: 16u; height: 16u; background: ${url('ui/signal.png')} 0 0 / 64u 16u; flex: none; margin-left: auto; }
.cu-vbtns { display: flex; gap: 3u; flex-wrap: wrap; margin-top: 2u; }
.cu-warn { color: ${ROLE.danger}; text-transform: none; }
.cu-note { text-transform: none; color: var(--dim); }
.cu-chat { flex: 1; min-height: 72u; display: flex; flex-direction: column; gap: 3u; }
.cu-log { flex: 1; min-height: 0; overflow-y: auto; text-transform: none; display: flex; flex-direction: column; gap: 3u; scrollbar-width: none; overflow-wrap: anywhere; }
.cu-log::-webkit-scrollbar { display: none; }
.cu-log b { font-weight: normal; text-transform: uppercase; }
.cu-log .out b { color: ${ROLE.out.dark}; }
.cu-log .in b { color: ${ROLE.in.dark}; }
.cu-log .ai b { color: ${ROLE.portalDark}; }
.cu[data-side="in"] .cu-log .out b { color: ${ROLE.out.light}; }
.cu[data-side="in"] .cu-log .in b { color: ${ROLE.in.base}; }
.cu[data-side="in"] .cu-log .ai b { color: ${ROLE.portal}; }
.cu-log .typing { color: var(--dim); }

/* ---------- modals: settings, win ---------- */
.cu-modal { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; z-index: 10; background: rgba(46, 34, 47, 0.45); }
.cu-modal.on { display: flex; }
.cu-modal > .cu-panel { animation: cu-drop 0.2s steps(4) both; }
@keyframes cu-drop { from { transform: translateY(-8u); opacity: 0; } to { transform: none; opacity: 1; } }
.cu-title { text-align: center; margin: 0 0 4u; }
.cu-settings { width: 232u; display: flex; flex-direction: column; gap: 3u; padding: 2u 4u 4u; }
.cu-set { display: flex; align-items: center; gap: 4u; height: 16u; }
.cu-set label { flex: 1; white-space: nowrap; }
.cu-set .val { width: 20u; flex: none; text-align: right; color: ${ROLE.dimOnLight}; }
.cu-set.off { color: ${ROLE.dimOnLight}; }
.cu-slider { position: relative; width: 72u; height: 12u; flex: none; touch-action: none; outline: none; }
.cu-slider .track, .cu-slider .fill { position: absolute; left: 0; top: 3u; height: 6u; ${nine('ui/slider-track.png', 2)} border-left-width: 4u; border-right-width: 4u; border-image-slice: 2 4 fill; border-image-width: 2u 4u; }
.cu-slider .track { right: 0; }
.cu-slider .fill { border-image-source: ${url('ui/slider-fill.png')}; min-width: 8u; }
.cu-slider .knob { position: absolute; top: 0; width: 8u; height: 12u; background: ${url('ui/slider-knob.png')} 0 0 / 8u 12u; }
.cu-slider:focus-visible .knob { outline: 1u solid ${ROLE.focus}; }
.cu-toggle { width: 22u; height: 12u; padding: 0; border: 0; flex: none; background: ${url('ui/toggle.png')} 0 0 / 44u 12u; outline: none; }
.cu-toggle.on { background-position: -22u 0; }
.cu-toggle:focus-visible { outline: 1u solid ${ROLE.focus}; }
.cu-actions { display: flex; justify-content: center; gap: 6u; margin-top: 4u; }

.cu-win { width: 200u; text-align: center; padding: 4u; }
.cu-win h2 { font: 32u/26u "m5x7", monospace; margin: 0 0 4u; color: ${ROLE.portalDark}; font-weight: normal; }
.cu-win p { margin: 0 0 2u; }
`;

/** "12u" to calc(12px * var(--u)). */
export const CSS = RAW.replace(/(-?\d+(?:\.\d+)?)u\b/g, 'calc($1px * var(--u))');

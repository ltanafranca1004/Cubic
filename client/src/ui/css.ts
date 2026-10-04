import { asset, ICONS } from '../style/assets';
import { C, FACE_HUD, ROLE, VIEW, textOn } from '../style/tokens';

// The stylesheet of the DOM UI (HUD, chat, voice, settings, pause, win screen).
// Sizes are written in ART PIXELS with two units, both turned into calc() by `units`:
//   "4u" = four art pixels at the UI scale       calc(4px * var(--u))
//          --u is the whole-number UI scale (style/scale.ts: uiScale in the menus, hudScale
//          in game). Art (9-slices, icons, the cube) and the gaps between boxes use it.
//   "4t" = four art pixels at the TEXT scale     calc(4px * var(--tu))
//          --tu is --u moved by the "Text size" setting (ui/a11y.ts textScale: S is one
//          step under, L one step over). ALL text uses it, and so does every box that
//          holds text (a button's height, a row, a chip), so a bigger text gets a bigger box.
// Both are whole numbers, so the DOM stays on a pixel grid and every image is scaled with
// nearest-neighbour. The game view has its own whole-number zoom, --z.

const url = (path: string) => `url("${asset(path)}")`;
/** A 9-slice from the kit as a CSS border. `corner` is the slice size in art pixels. */
const nine = (path: string, corner: number) => `border: ${corner}u solid transparent; border-image: ${url(path)} ${corner} fill / ${corner}u stretch;`;

/** --face-N is the HUD colour of face N on this side, --face-N-k the text that reads on it. */
const faceVars = (side: 'out' | 'in') =>
  Object.entries(FACE_HUD)
    .map(([face, c]) => `--face-${face}: ${c[side]}; --face-${face}-k: ${textOn(c[side])};`)
    .join(' ');

/** Everything that takes the keyboard focus, for the one focus outline. */
const FOCUSABLE = ['.cu-btn', '.cu-tabs', '.cu-gear', '.cu-toggle', '.cu-slider', '.cu-seg', '.cu-key', '.cu-chipbtn'];
const focusRule = (prefix = '') => FOCUSABLE.map((s) => `${prefix}${s}:focus-visible`).join(', ');

const RAW = `
@font-face { font-family: "m5x7"; src: ${url('fonts/m5x7.ttf')} format("truetype"); font-display: block; }

:root {
  --u: 2; --tu: 2;
  --ink: ${ROLE.ink}; --paper: ${ROLE.paper}; --dim: ${ROLE.dimOnLight};
  --out: ${ROLE.out.base}; --in: ${ROLE.in.base}; --danger: ${ROLE.danger}; --ok: ${ROLE.ok};
  --signal: ${ROLE.signal}; --portal: ${ROLE.portal}; --p1: ${ROLE.p1.base}; --p2: ${ROLE.p2.base};
  ${faceVars('out')}
}
* { box-sizing: border-box; }
/* never white: the stage canvas covers the window, and what is not covered yet is dark */
html, body { margin: 0; height: 100%; overflow: hidden; background: ${ROLE.ink}; }
#app { height: 100%; }

.cu {
  position: fixed; inset: 0; overflow: hidden;
  font: 16t/13t "m5x7", monospace; color: var(--ink); text-transform: uppercase;
  -webkit-font-smoothing: none; font-smooth: never; text-rendering: optimizeSpeed;
  image-rendering: pixelated; user-select: none;
  /* ONE CURSOR: the pixel arrow everywhere, the pixel hand on what can be clicked
     (the same two in the Phaser scenes: scenes/kit.ts HAND) */
  cursor: var(--cursor), auto;
  /* boxes that hold one line of text: the kit's border plus the line */
  --btn-h: calc(12u + 10t); --tag-h: calc(8u + 10t); --row-h: max(16u, 13t);
}
.cu[data-side="in"] { color: var(--paper); --dim: ${ROLE.dimOnDark}; ${faceVars('in')} }
/* anything that stands for a face: data-face gives it that face's colour */
${Object.keys(FACE_HUD)
  .map((f) => `.cu [data-face="${f}"] { --c: var(--face-${f}); --k: var(--face-${f}-k); }`)
  .join('\n')}
.cu button, .cu input, .cu label { font: inherit; text-transform: inherit; cursor: inherit; margin: 0; }
.cu button, .cu [role="slider"], .cu [role="radio"], .cu [role="tab"], .cu .cu-click { cursor: var(--cursor-hand), pointer; }
.cu button:disabled, .cu .off [role="slider"], .cu .off [role="radio"], .cu .off button { cursor: var(--cursor), auto; }
.cu canvas { image-rendering: pixelated; display: block; }
.cu [hidden] { display: none !important; }
.cu-stage { position: absolute; inset: 0; overflow: hidden; }

/* ---------- kit ---------- */
.cu-panel { ${nine('ui/panel.png', 6)} color: ${ROLE.ink}; --dim: ${ROLE.dimOnLight}; }
.cu[data-side="in"] .cu-hud .cu-panel { ${nine('ui/panel-dark.png', 6)} color: ${ROLE.paper}; --dim: ${ROLE.dimOnDark}; }
.cu-dim { color: var(--dim); }

.cu-btn {
  ${nine('ui/btn-dark-idle.png', 6)}
  height: var(--btn-h); padding: 0 4t; line-height: 7t; color: ${ROLE.paper}; background: none; white-space: nowrap;
  display: inline-flex; align-items: center; justify-content: center; gap: 3t; flex: none;
}
.cu-btn > span { display: block; margin-top: -3t; }
.cu-btn:hover, .cu-btn:focus-visible { border-image-source: ${url('ui/btn-dark-hover.png')}; outline: none; }
.cu-btn:active > span, .cu-btn:active > .cu-ico { transform: translateY(2u); }
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
.cu-btn:disabled:active > span { transform: none; }

.cu-ico { display: inline-block; width: 16u; height: 16u; flex: none; background: ${url('ui/icons.png')} 0 0 / ${ICONS.length * 16}u 16u no-repeat; }
${ICONS.map((name, i) => `.cu-ico.${name} { background-position: -${i * 16}u 0; }`).join('\n')}

.cu-field {
  ${nine('ui/field.png', 4)}
  height: var(--tag-h); padding: 0 2t; line-height: 10t; width: 100%; color: ${ROLE.ink}; background: none; outline: none; text-transform: none;
  cursor: var(--cursor), auto;
}
.cu-field:focus { border-image-source: ${url('ui/field-active.png')}; }
.cu-field::placeholder { color: ${ROLE.dimOnLight}; text-transform: uppercase; }

/* a small key cap: a key in a hint, and the small buttons on a hint (GOT IT) */
.cu-kbd, .cu-chipbtn {
  font: inherit; text-transform: uppercase; display: block; flex: none; height: 11t; line-height: 7t; padding: 0 2t 0 3t; white-space: nowrap;
  background: ${C.white}; color: ${ROLE.ink}; border: 0; outline: 1u solid ${ROLE.ink}; box-shadow: 0 2u 0 ${ROLE.ink}; margin: 0 1u 2u;
}
.cu-chipbtn:hover { background: ${ROLE.in.light}; }
.cu-chipbtn:active { transform: translateY(2u); box-shadow: none; }

/* ---------- top bar: leave, room code, gear. The same on every screen. ---------- */
.cu-top { position: absolute; top: 4u; left: 6u; right: 6u; height: var(--btn-h); display: flex; align-items: center; justify-content: space-between; gap: 2u; pointer-events: none; z-index: 5; }
.cu-top > * { pointer-events: auto; }
.cu-top-side { flex: 1 1 0; min-width: 0; display: flex; align-items: center; pointer-events: none; }
.cu-top-side > * { pointer-events: auto; }
.cu-top-side.r { justify-content: flex-end; }
.cu-top-mid { display: flex; align-items: center; gap: 3u; flex: none; }
.cu-room { ${nine('ui/tag.png', 4)} height: var(--tag-h); padding: 0 5t; line-height: 10t; color: ${ROLE.paper}; display: flex; gap: 5t; white-space: nowrap; }
.cu-room span { display: block; margin-top: -1t; }
.cu-room .k { color: ${ROLE.dimOnDark}; }
.cu-room .v { color: ${ROLE.in.base}; letter-spacing: 1t; }
.cu-gear { width: 16u; height: 16u; margin: 0 2u 3u; padding: 0; border: 0; flex: none; background: ${url('ui/gear.png')} 0 0 / 32u 16u no-repeat; }
.cu-gear:hover, .cu-gear:focus-visible, .cu-gear.on { background-position: -16u 0; outline: none; }
.cu-banner { position: absolute; top: calc(8u + var(--btn-h)); left: 50%; transform: translateX(-50%); ${nine('ui/tag.png', 4)} height: var(--tag-h); padding: 0 5t; line-height: 10t; color: ${C.salmon}; white-space: nowrap; z-index: 5; }
.cu-banner span { display: block; margin-top: -1t; }

/* ---------- in-game layout ---------- */
/* ONE GRID, two areas: "view" (the game, as large as it can be, with the label of the
   neighbouring face on each of its four edges) and "side" (one column with everything
   else). Every size is a variable, so another layout (a narrow landscape phone, say) only
   has to set them again and move the two areas.
     --z     the game view's whole-number zoom       (style/scale.ts viewZoom, set by cubicUI)
     --u     the scale of everything else in game    (style/scale.ts hudScale, set by cubicUI)
     --tu    the scale of the text                   (ui/a11y.ts textScale, set by cubicUI)
   The numbers are VIEW in style/tokens.ts, which viewZoom reads too. */
.cu {
  --z: 3;
  --view: calc(${VIEW.px}px * var(--z));
  --frame: ${VIEW.frame}u; --gap: ${VIEW.gap}u; --pad: 3u;
  /* the edge bands hold a line of text: they grow with a larger text, as far as the window lets them */
  --edge: max(${VIEW.edge}u, min(11t, calc((var(--vh, 100vh) - var(--view) - 2 * var(--frame) - 4u) / 2)));
  --col-min: ${VIEW.columnMin}u; --col-max: max(${VIEW.columnMax}u, ${VIEW.columnMax}t);
  /* the view with its frame and its four edge bands: a square */
  --mid: calc(var(--view) + 2 * var(--frame) + 2 * var(--edge) + 4u);
  --col: clamp(var(--col-min), calc(var(--vw, 100vw) - var(--mid) - 3 * var(--gap)), var(--col-max));
  --hud-w: calc(var(--mid) + var(--gap) + var(--col));
  --hud-x: max(var(--gap), calc((var(--vw, 100vw) - var(--hud-w)) / 2));
  --hud-y: max(0px, calc((var(--vh, 100vh) - var(--mid)) / 2));
  /* for what is placed on the view or on the column from outside the grid */
  --view-x: calc(var(--hud-x) + var(--mid) / 2);
  --view-top: calc(var(--hud-y) + var(--edge) + 2u + var(--frame));
  --col-x: calc(var(--hud-x) + var(--mid) + var(--gap));
}
/* whole pixels only: a canvas on a half pixel is blurred */
@supports (width: round(down, 1px, 1px)) {
  .cu {
    --edge: round(down, max(${VIEW.edge}u, min(11t, calc((var(--vh, 100vh) - var(--view) - 2 * var(--frame) - 4u) / 2))), 1px);
    --hud-x: round(down, max(var(--gap), calc((var(--vw, 100vw) - var(--hud-w)) / 2)), 1px); --hud-y: round(down, max(0px, calc((var(--vh, 100vh) - var(--mid)) / 2)), 1px);
  }
}
.cu-hud { position: absolute; top: 0; bottom: 0; left: var(--hud-x); width: var(--hud-w); display: none; grid-template-columns: var(--mid) var(--col); grid-template-rows: 100%; grid-template-areas: "view side"; column-gap: var(--gap); }
.cu[data-screen="game"] .cu-hud { display: grid; animation: cu-in 0.48s steps(4) both; }
@keyframes cu-in { from { opacity: 0; } to { opacity: 1; } }
/* in game the top bar (leave, room code, time, gear) is the head of the column */
.cu[data-screen="game"] .cu-top { left: var(--col-x); right: auto; width: var(--col); }
.cu[data-screen="game"] .cu-top-side { flex: 0 1 auto; }
.cu[data-screen="game"] .cu-room .k { display: none; }
.cu[data-screen="game"] .cu-banner { left: var(--view-x); top: calc(var(--view-top) + 4u); }

/* ----- the view ----- */
.cu-mid { grid-area: view; align-self: start; margin-top: var(--hud-y); display: grid; grid-template-columns: var(--edge) auto var(--edge); grid-template-rows: var(--edge) auto var(--edge); justify-items: center; align-items: center; gap: 2u; }
.cu-view { grid-column: 2; grid-row: 2; position: relative; padding: var(--frame); background: ${ROLE.ink}; line-height: 0; }
.cu[data-side="in"] .cu-view { background: ${C.slate}; }
.cu[data-side="in"] .cu-room, .cu[data-side="in"] .cu-banner { border-image-source: ${url('ui/tag-light.png')}; }
.cu[data-side="in"] .cu-banner { color: ${ROLE.dangerDark}; }
.cu[data-side="in"] .cu-room .k { color: ${ROLE.dimOnLight}; }
.cu[data-side="in"] .cu-room .v { color: ${ROLE.in.deep}; }
#game { line-height: 0; }
/* the face across each edge: its chip (colour and number, as on the cube) and its name */
.cu-edge { white-space: nowrap; color: ${ROLE.ink}; display: flex; align-items: center; gap: 3t; height: var(--edge); line-height: 13t; }
.cu[data-side="in"] .cu-edge { color: ${ROLE.paper}; }
.cu-edge.t { grid-column: 2; grid-row: 1; }
.cu-edge.b { grid-column: 2; grid-row: 3; }
.cu-edge.l { grid-column: 1; grid-row: 2; writing-mode: vertical-rl; transform: rotate(180deg); width: var(--edge); height: auto; }
.cu-edge.r { grid-column: 3; grid-row: 2; writing-mode: vertical-rl; width: var(--edge); height: auto; }
.cu-edge > span { display: block; margin-top: -2t; }
.cu-edge.l > span, .cu-edge.r > span { margin-top: 0; margin-right: -2t; }
.cu-edge.l .cu-chip { transform: rotate(180deg); }
.cu-edge.done { color: ${ROLE.out.deep}; }
.cu[data-side="in"] .cu-edge.done { color: ${ROLE.out.light}; }
/* a face chip: a square in the face's colour with its number. On the view's edges, around
   the cube and before the face's name. */
.cu-chip { display: block; flex: none; width: 9t; height: 9t; background: var(--c); color: var(--k); outline: 1u solid ${ROLE.ink}; font-style: normal; font-weight: normal; text-align: center; line-height: 10t; writing-mode: horizontal-tb; text-indent: 1t; }
.cu[data-side="in"] .cu-chip { outline-color: ${ROLE.paper}; }
/* where the controls hint of the onboarding sits (ui/onboarding/anchors.ts): inside the
   view, along its bottom. Nothing is drawn here. */
.cu-keys { position: absolute; left: 0; right: 0; bottom: 6u; height: 44u; pointer-events: none; }

/* ----- the column: where you are, voice, chat ----- */
.cu-col { grid-area: side; display: flex; flex-direction: column; gap: var(--gap); min-width: 0; min-height: 0; margin: calc(6u + var(--btn-h)) 0 var(--gap); }
.cu-where { display: grid; grid-template-columns: auto minmax(0, 1fr); grid-template-areas: "cube id" "obj obj"; gap: var(--pad) 4u; flex: none; }
.cu-id { grid-area: id; display: flex; flex-direction: column; justify-content: space-between; min-width: 0; }
.cu-side { display: block; font: 32t/22t "m5x7", monospace; font-weight: normal; margin-top: -4t; color: ${ROLE.out.dark}; white-space: nowrap; }
.cu[data-side="in"] .cu-side { color: ${ROLE.in.base}; }
.cu-face { display: flex; align-items: center; gap: 3t; height: 13t; white-space: nowrap; }
.cu-face > span, .cu-prog > span, .cu-prog > b { display: block; margin-top: -2t; }
.cu-prog { display: flex; align-items: center; gap: 3t; height: 13t; white-space: nowrap; }
.cu-prog b { font-weight: normal; color: ${ROLE.portalDark}; }
.cu[data-side="in"] .cu-prog b { color: ${ROLE.portal}; }
.cu-carry { display: flex; align-items: center; gap: 3t; height: var(--row-h); white-space: nowrap; overflow: hidden; }
.cu-carry > span { display: block; margin-top: -2t; }
.cu-item { width: 16u; height: 16u; background: ${url('sprites/items.png')} 0 0 / 48u 16u; flex: none; }
.cu-obj { grid-area: obj; margin: 0; text-transform: none; min-height: 26t; }
/* the cube (client/src/cube/hud.ts): a canvas in art pixels and a chip on each edge for the
   face that lies that way. The pips (one per puzzle: its face's colour once solved) are in .cu-prog. */
.cu-cube { grid-area: cube; --pc: var(--in); align-self: center; }
.cu-cube[data-partner="out"] { --pc: var(--out); }
.cu-cube-box { display: grid; grid-template-columns: max(11u, 11t) 56u max(11u, 11t); grid-template-rows: max(11u, 11t) 56u max(11u, 11t); justify-items: center; align-items: center; }
.cu-cube-c { grid-column: 2; grid-row: 2; width: 56u; height: 56u; }
.cu-cube-e { position: relative; }
.cu-cube-e.up { grid-column: 2; grid-row: 1; }
.cu-cube-e.down { grid-column: 2; grid-row: 3; }
.cu-cube-e.left { grid-column: 1; grid-row: 2; }
.cu-cube-e.right { grid-column: 3; grid-row: 2; }
.cu-cube-e.partner, .cu[data-side="in"] .cu-cube-e.partner { outline: 2u solid var(--pc); animation: cu-way 0.84s steps(2) infinite; z-index: 1; }
@keyframes cu-way { 50% { outline-color: ${ROLE.ink}; } }
.cu-pips { display: flex; gap: 2u; }
.cu-pips > i { position: relative; width: 9u; height: 8u; background: ${C.mist}; color: ${ROLE.ink}; outline: 1u solid ${ROLE.ink}; }
.cu-pips .cu-tick { position: absolute; right: 1u; top: 1u; }
.cu[data-side="in"] .cu-pips > i { background: ${C.slate}; color: ${ROLE.paper}; }
.cu-pips > i.ok, .cu[data-side="in"] .cu-pips > i.ok { background: var(--c); color: var(--k); }
.cu-pips > i.here { outline: 1u solid ${ROLE.focus}; z-index: 1; }
/* the cube map (Tab): over the view */
.cu-cubemap { position: absolute; top: 0; bottom: 0; left: 0; width: var(--mid); display: none; align-items: center; justify-content: center; z-index: 8; pointer-events: none; }
.cu-cubemap.on { display: flex; }
.cu-cubemap .cu-panel { display: flex; flex-direction: column; align-items: center; gap: 2t; padding: 2t 6t 3t; }
.cu-cubemap b { font-weight: normal; }
.cu-cubemap canvas { width: 132u; height: 132u; }

.cu-voice { display: flex; flex-direction: column; gap: var(--pad); flex: none; }
.cu-vrow { display: flex; align-items: center; gap: 3t; height: 13t; white-space: nowrap; }
.cu-vrow > span { display: block; margin-top: -2t; }
.cu-vrow .them { margin-left: auto; }
.cu-dot { width: 5u; height: 5u; background: ${C.mauve}; outline: 1u solid ${ROLE.ink}; flex: none; margin: 0 1u; }
.cu-dot.on { background: var(--signal); }
.cu-signal { width: 16u; height: 16u; background: ${url('ui/signal.png')} 0 0 / 64u 16u; flex: none; margin: -2u 0; }
.cu-vbtns { display: flex; gap: var(--pad); flex-wrap: wrap; }
.cu-vbtns .cu-btn { flex: 1 0 auto; }
.cu-warn { color: ${ROLE.danger}; text-transform: none; }
.cu-note { text-transform: none; color: var(--dim); }
/* time, and strikes once there are any: tags in the top bar */
.cu-stats { display: flex; gap: 2u; flex: none; }
.cu-stat { ${nine('ui/tag.png', 4)} height: var(--tag-h); padding: 0 4t 0 1u; color: ${ROLE.paper}; display: flex; align-items: center; gap: 2u; white-space: nowrap; line-height: 10t; }
.cu[data-side="in"] .cu-stat { border-image-source: ${url('ui/tag-light.png')}; color: ${ROLE.ink}; }
.cu-stat .cu-ico { margin: -4u 0; }
.cu-stat span { display: block; margin-top: -1t; }
.cu-stat.x { color: ${C.salmon}; }
.cu[data-side="in"] .cu-stat.x { color: ${ROLE.dangerDark}; }
.cu-chat { flex: 1; min-height: calc(12u + var(--pad) + 26t + var(--tag-h)); display: flex; flex-direction: column; gap: var(--pad); }
.cu-log { flex: 1; min-height: 0; overflow-y: auto; text-transform: none; display: flex; flex-direction: column; gap: 3t; scrollbar-width: none; overflow-wrap: anywhere; }
.cu-log::-webkit-scrollbar { display: none; }
.cu-log b { font-weight: normal; text-transform: uppercase; }
.cu-log .out b { color: ${ROLE.out.dark}; }
.cu-log .in b { color: ${ROLE.in.dark}; }
.cu-log .ai b { color: ${ROLE.portalDark}; }
.cu[data-side="in"] .cu-log .out b { color: ${ROLE.out.light}; }
.cu[data-side="in"] .cu-log .in b { color: ${ROLE.in.base}; }
.cu[data-side="in"] .cu-log .ai b { color: ${ROLE.portal}; }
.cu-log .typing, .cu-log .sys { color: var(--dim); }

/* ---------- modals: settings, pause, win ---------- */
/* The veil takes every click that is not on the panel, so nothing under it (the gear,
   Leave, a canvas button) can be pressed while a panel is open. */
.cu-modal { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; z-index: 10; background: rgba(46, 34, 47, 0.45); }
.cu-modal.on { display: flex; }
/* The panel drops in. It only MOVES: its opacity is never animated, so it cannot be seen
   half transparent however the animation is cut short or restarted. */
.cu-modal > .cu-panel { animation: cu-drop 0.2s steps(4) both; max-width: calc(var(--vw, 100vw) - 8u); max-height: calc(var(--vh, 100vh) - 8u); }
@keyframes cu-drop { from { transform: translateY(-8u); } to { transform: none; } }
.cu-title { text-align: center; margin: 0 0 4t; }
.cu-actions { display: flex; justify-content: center; gap: 6t; margin-top: 4t; }

/* the win screen: the title, the time, then leave or play again */
.cu-win { width: max(216u, 216t); text-align: center; padding: 4t 4t 6t; }
.cu-win h2 { font: 32t/26t "m5x7", monospace; margin: 0 0 6t; color: ${ROLE.portalDark}; font-weight: normal; }
.cu-win p { margin: 0; }
.cu-wintime { display: block; font: 32t/26t "m5x7", monospace; font-weight: normal; margin: 0 0 4t; }
.cu-win .cu-actions { margin-top: 8t; }

/* ---------- settings: three tabs in one box, two columns of rows each ---------- */
.cu-settings { width: min(calc(var(--vw, 100vw) - 12u), max(448u, 448t)); display: flex; flex-direction: column; gap: 3t; padding: 2t 4t 4t; }
.cu-tabs { display: flex; justify-content: center; gap: 2u; outline: none; }
.cu-tabs > span { display: block; ${nine('ui/btn-light-idle.png', 6)} height: var(--btn-h); padding: 0 6t; line-height: 7t; color: ${ROLE.dimOnLight}; white-space: nowrap; }
.cu-tabs > span > b { display: block; font-weight: normal; margin-top: -1t; }
.cu-tabs > span:hover { border-image-source: ${url('ui/btn-light-hover.png')}; }
/* the open tab is pressed in, dark and underlined: a shape, not only a colour */
.cu-tabs > span.on { border-image-source: ${url('ui/btn-dark-pressed.png')}; color: ${ROLE.paper}; }
.cu-tabs > span.on > b { margin-top: 3u; box-shadow: 0 2u 0 ${ROLE.focus}; }
/* every tab is as tall as the tallest (seven rows), so the box never changes size */
.cu-setbody { min-height: calc(7 * var(--row-h) + 6 * 3t); }
.cu-setgrid { display: none; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); column-gap: 8t; align-items: start; }
.cu-setgrid.on { display: grid; }
.cu-setcol { display: flex; flex-direction: column; gap: 3t; min-width: 0; }
.cu-sub { color: var(--dim); border-bottom: 1u solid var(--dim); height: var(--row-h); line-height: 13t; white-space: nowrap; }
.cu-set { display: flex; align-items: center; gap: 4t; height: var(--row-h); min-width: 0; }
.cu-set label { flex: 1; white-space: nowrap; min-width: 0; margin-top: -2t; }
.cu-set .val, .cu-state { width: 18t; flex: none; text-align: right; color: ${ROLE.dimOnLight}; margin-top: -2t; }
.cu-set.off { color: ${ROLE.dimOnLight}; }
.cu-slider { position: relative; width: 72u; height: 12u; flex: none; touch-action: none; outline: none; }
.cu-slider .track, .cu-slider .fill { position: absolute; left: 0; top: 3u; height: 6u; ${nine('ui/slider-track.png', 2)} border-left-width: 4u; border-right-width: 4u; border-image-slice: 2 4 fill; border-image-width: 2u 4u; }
.cu-slider .track { right: 0; }
.cu-slider .fill { border-image-source: ${url('ui/slider-fill.png')}; min-width: 8u; }
.cu-slider .knob { position: absolute; top: 0; width: 8u; height: 12u; background: ${url('ui/slider-knob.png')} 0 0 / 8u 12u; }
.cu-toggle { width: 22u; height: 12u; padding: 0; border: 0; flex: none; background: ${url('ui/toggle.png')} 0 0 / 44u 12u; outline: none; }
.cu-toggle.on { background-position: -22u 0; }
.cu-seg { display: flex; flex: none; gap: 1u; outline: none; background: ${ROLE.ink}; padding: 1u; }
.cu-seg span { display: block; height: 11t; min-width: 13t; padding: 0 3t; line-height: 7t; text-align: center; white-space: nowrap; background: ${C.mist}; color: ${ROLE.dimOnLight}; }
/* the chosen one is inverted and underlined: a shape, not only a colour */
.cu-seg span.on { background: ${ROLE.ink}; color: ${ROLE.paper}; box-shadow: inset 0 -2u 0 ${ROLE.focus}; }
.cu-seg span[hidden] { display: none; }
.cu-credit { text-align: center; text-transform: none; color: var(--dim); }
.cu-settings .cu-actions { margin-top: 1t; }

/* the controls tab: an action and the key it is on. Click the key, press a new one. */
.cu-key { ${nine('ui/field.png', 4)} height: var(--row-h); min-width: 30t; padding: 0 3t; line-height: 7t; flex: none; background: none; color: ${ROLE.ink}; white-space: nowrap; outline: none; display: flex; align-items: center; justify-content: center; }
.cu-key > span { display: block; margin-top: -3t; }
.cu-key:hover { border-image-source: ${url('ui/field-active.png')}; }
.cu-key.cap { border-image-source: ${url('ui/field-active.png')}; color: ${ROLE.in.deep}; }
/* the other row of a swap: marked for a moment */
.cu-set.swap { background: ${ROLE.in.light}; outline: 2u solid ${ROLE.in.light}; }
.cu-set.swap .cu-key { border-image-source: ${url('ui/field-active.png')}; }
.cu-set.fixed { color: var(--dim); text-transform: none; }
.cu-set.fixed span { margin-top: -2t; white-space: nowrap; }

/* ---------- pause menu: the buttons on the left, the controls as a table ---------- */
.cu-pause { padding: 2t 6t 6t; }
.cu-pause .cu-title { margin: 0; }
.cu-pause .cu-lead { text-align: center; text-transform: none; color: var(--dim); margin: 0 0 4t; }
.cu-pausegrid { display: grid; grid-template-columns: max-content max-content; column-gap: 12t; align-items: start; }
.cu-pausebtns { display: flex; flex-direction: column; gap: 5t; padding-top: calc(var(--row-h) + 3t); min-width: 88t; }
.cu-pausebtns .cu-btn { width: 100%; }
.cu-help { display: grid; grid-template-columns: max-content max-content; column-gap: 12t; align-items: center; }
.cu-help > * { height: 13t; line-height: 11t; white-space: nowrap; }
.cu-help > .h { color: var(--dim); height: var(--row-h); }
.cu-help > .a { text-transform: none; }
.cu-help > .rule { grid-column: 1 / -1; height: 1u; margin: 0 0 2t; background: var(--dim); }
.cu-help > .rule ~ .rule { margin: 2t 0 1t; }
/* (the gamepad line wraps to the table's width instead of stretching it) */
.cu-help > .pad { grid-column: 1 / -1; color: var(--dim); text-transform: none; white-space: normal; height: auto; line-height: 13t; width: 0; min-width: 100%; }

/* ---------- keyboard focus: one pixel outline, the same on every control ---------- */
${focusRule()} {
  outline: 2u solid ${ROLE.focus}; outline-offset: 1u; box-shadow: 0 0 0 4u ${ROLE.ink};
}
.cu-slider:focus-visible .knob { outline: 1u solid ${ROLE.focus}; }

/* ---------- shapes next to colours ---------- */
/* a pixel tick: solved */
.cu-tick { display: inline-block; position: relative; width: 4u; height: 3u; flex: none; }
.cu-tick::before { content: ""; position: absolute; left: 0; top: 0; width: 1u; height: 1u; box-shadow: 0 1u currentColor, 1u 2u currentColor, 2u 1u currentColor, 3u 0 currentColor; }
/* a pixel plus: you are here */
.cu-pip { position: absolute; left: 1u; bottom: 1u; width: 3u; height: 3u; }
.cu-pip::before { content: ""; position: absolute; left: 0; top: 0; width: 1u; height: 1u; box-shadow: 1u 0 currentColor, 0 1u currentColor, 1u 1u currentColor, 2u 1u currentColor, 1u 2u currentColor; }

/* ---------- quick-chat bubbles, over the game view ---------- */
.cu-over { position: absolute; inset: var(--frame); z-index: 2; pointer-events: none; line-height: 13t; }
.cu-bubble {
  position: absolute; transform: translate(-50%, -100%); margin-top: -3u; white-space: nowrap; text-transform: none;
  ${nine('ui/tag.png', 4)} padding: 0 3t; color: ${ROLE.paper}; z-index: 1;
}
.cu-bubble.under { transform: translate(-50%, 0); margin-top: 1u; }
.cu-bubble.mine { border-image-source: ${url('ui/tag-light.png')}; color: ${ROLE.ink}; }
/* the tail: it points at who is speaking */
.cu-bubble::after { content: ""; position: absolute; left: 50%; bottom: -6u; margin-left: -1u; width: 2u; height: 2u; background: ${ROLE.ink}; }
.cu-bubble.under::after { bottom: auto; top: -6u; }

/* ---------- captions and "Partner speaking" ---------- */
.cu-subs { position: absolute; left: 50%; bottom: max(6u, calc(var(--subs-lift, 0px) + 2u)); transform: translateX(-50%); z-index: 8; display: flex; flex-direction: column; align-items: center; gap: 2u; pointer-events: none; max-width: 90%; }
.cu-caption { ${nine('ui/tag.png', 4)} padding: 1t 5t 3t; color: ${ROLE.paper}; text-transform: none; text-align: center; max-width: 340t; }
/* in game they sit on the game view, along its bottom */
.cu[data-screen="game"] .cu-subs { left: var(--view-x); width: max-content; max-width: calc(var(--view) - 8u); bottom: max(calc(var(--vh, 100vh) - var(--view-top) - var(--view) + 4u), calc(var(--subs-lift, 0px) + 2u)); }
.cu[data-side="in"] .cu-caption { outline: 1u solid ${ROLE.dimOnDark}; }
.cu-caption b { font-weight: normal; text-transform: uppercase; color: ${ROLE.in.base}; }
.cu-speaking { ${nine('ui/tag-light.png', 4)} height: var(--tag-h); padding: 0 5t 0 1u; color: ${ROLE.ink}; display: flex; align-items: center; gap: 2u; white-space: nowrap; line-height: 10t; }
.cu-speaking .cu-ico { margin: -4u 0; }
.cu-speaking span { display: block; margin-top: -1t; }

/* ---------- high contrast (settings): no faint text, no colour-only text, hard edges, a heavier veil ---------- */
.cu[data-contrast="high"], .cu[data-contrast="high"] .cu-panel { --dim: ${ROLE.ink}; }
.cu[data-contrast="high"][data-side="in"], .cu[data-contrast="high"][data-side="in"] .cu-hud .cu-panel { --dim: ${ROLE.paper}; }
.cu[data-contrast="high"] .cu-panel { outline: 2u solid ${ROLE.ink}; }
.cu[data-contrast="high"][data-side="in"] .cu-hud .cu-panel { outline-color: ${ROLE.paper}; }
.cu[data-contrast="high"] .cu-modal { background: rgba(46, 34, 47, 0.88); }
.cu[data-contrast="high"] .cu-set .val, .cu[data-contrast="high"] .cu-state, .cu[data-contrast="high"] .cu-set.off, .cu[data-contrast="high"] .cu-seg span, .cu[data-contrast="high"] .cu-tabs > span, .cu[data-contrast="high"] .cu-key.cap { color: ${ROLE.ink}; }
.cu[data-contrast="high"] .cu-seg span.on, .cu[data-contrast="high"] .cu-tabs > span.on { color: ${ROLE.paper}; }
.cu[data-contrast="high"] .cu-seg span { background: ${ROLE.paper}; }
.cu[data-contrast="high"] .cu-seg span.on { background: ${ROLE.ink}; }
.cu[data-contrast="high"] .cu-set.off label { text-decoration: line-through; }
.cu[data-contrast="high"] .cu-field::placeholder { color: ${ROLE.ink}; }
.cu[data-contrast="high"] .cu-btn:disabled { color: ${ROLE.ink}; text-decoration: line-through; }
.cu[data-contrast="high"] .cu-log b, .cu[data-contrast="high"] .cu-edge.done, .cu[data-contrast="high"] .cu-side, .cu[data-contrast="high"] .cu-prog b, .cu[data-contrast="high"] .cu-stat.x, .cu[data-contrast="high"] .cu-warn, .cu[data-contrast="high"] .cu-win h2, .cu[data-contrast="high"] .cu-onb-card h3 b { color: inherit; }
.cu[data-contrast="high"] .cu-log b, .cu[data-contrast="high"] .cu-onb-card h3 b { text-decoration: underline; }
/* the tags (room code, time, banner, captions, bubbles): white on ink or ink on white, with an edge */
.cu[data-contrast="high"] .cu-room .k, .cu[data-contrast="high"] .cu-room .v, .cu[data-contrast="high"] .cu-banner, .cu[data-contrast="high"] .cu-caption b { color: inherit; }
.cu[data-contrast="high"] .cu-room, .cu[data-contrast="high"] .cu-banner { color: ${ROLE.paper}; }
.cu[data-contrast="high"][data-side="in"] .cu-room, .cu[data-contrast="high"][data-side="in"] .cu-banner { color: ${ROLE.ink}; }
.cu[data-contrast="high"] .cu-banner { text-decoration: underline; }
.cu[data-contrast="high"] .cu-caption b { text-decoration: underline; }
.cu[data-contrast="high"] .cu-view { outline: 2u solid ${ROLE.paper}; }
.cu[data-contrast="high"] .cu-caption, .cu[data-contrast="high"] .cu-bubble, .cu[data-contrast="high"] .cu-speaking, .cu[data-contrast="high"] .cu-room, .cu[data-contrast="high"] .cu-stat, .cu[data-contrast="high"] .cu-banner { outline: 1u solid ${ROLE.paper}; }
.cu[data-contrast="high"][data-side="in"] .cu-room, .cu[data-contrast="high"][data-side="in"] .cu-stat, .cu[data-contrast="high"][data-side="in"] .cu-banner, .cu[data-contrast="high"] .cu-bubble.mine, .cu[data-contrast="high"] .cu-speaking { outline-color: ${ROLE.ink}; }
.cu[data-contrast="high"] .cu-chip, .cu[data-contrast="high"] .cu-pips > i { outline-width: 2u; }
.cu[data-contrast="high"] .cu-edge { color: ${ROLE.ink}; }
.cu[data-contrast="high"][data-side="in"] .cu-edge { color: ${ROLE.paper}; }
.cu[data-contrast="high"] .cu-dot { outline-width: 2u; background: ${ROLE.paper}; }
.cu[data-contrast="high"] .cu-dot.on { background: ${ROLE.ink}; }
.cu[data-contrast="high"][data-side="in"] .cu-dot { background: ${ROLE.ink}; outline-color: ${ROLE.paper}; }
.cu[data-contrast="high"][data-side="in"] .cu-dot.on { background: ${ROLE.paper}; }
.cu[data-contrast="high"] .cu-gear { outline: 2u solid ${ROLE.ink}; background-color: ${ROLE.paper}; }
.cu[data-contrast="high"] .cu-sub, .cu[data-contrast="high"] .cu-help > .rule { border-bottom-width: 2u; }
.cu[data-contrast="high"] .cu-help > .rule { height: 2u; }
.cu[data-contrast="high"] .cu-kbd, .cu[data-contrast="high"] .cu-chipbtn, .cu[data-contrast="high"] .cu-key { outline: 2u solid ${ROLE.ink}; }
${focusRule('.cu[data-contrast="high"] ')} { outline-width: 3u; box-shadow: 0 0 0 6u ${ROLE.ink}; }

/* ---------- reduce motion (settings): nothing in the DOM animates or fades ---------- */
.cu[data-motion="reduce"], .cu[data-motion="reduce"] *, .cu[data-motion="reduce"] *::before, .cu[data-motion="reduce"] *::after { animation: none !important; transition: none !important; }

`;

/** "12u" to calc(12px * var(--u)), "12t" to calc(12px * var(--tu)). */
export const units = (raw: string): string => raw.replace(/(-?\d+(?:\.\d+)?)u\b/g, 'calc($1px * var(--u))').replace(/(-?\d+(?:\.\d+)?)t\b/g, 'calc($1px * var(--tu))');

export const CSS = units(RAW);

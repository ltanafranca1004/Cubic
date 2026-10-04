import { asset, ICONS } from '../style/assets';
import { C, FACE_HUD, ROLE, VIEW, textOn } from '../style/tokens';

// The stylesheet of the DOM UI (HUD, chat, voice, settings, win screen).
// Sizes are written in ART PIXELS with the unit "u" (4u = four art pixels) and turned into
// calc(4px * var(--u)), where --u is the whole-number UI scale (style/scale.ts: uiScale in
// the menus, hudScale in game). So the DOM is laid out on a pixel grid, and every image is
// scaled with nearest-neighbour. The game view has its own whole-number zoom, --z.

const url = (path: string) => `url("${asset(path)}")`;
/** A 9-slice from the kit as a CSS border. `corner` is the slice size in art pixels. */
const nine = (path: string, corner: number) => `border: ${corner}u solid transparent; border-image: ${url(path)} ${corner} fill / ${corner}u stretch;`;

/** --face-N is the HUD colour of face N on this side, --face-N-k the text that reads on it. */
const faceVars = (side: 'out' | 'in') =>
  Object.entries(FACE_HUD)
    .map(([face, c]) => `--face-${face}: ${c[side]}; --face-${face}-k: ${textOn(c[side])};`)
    .join(' ');

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
html, body { margin: 0; height: 100%; overflow: hidden; background: ${ROLE.surface}; }
#app { height: 100%; }

.cu {
  position: fixed; inset: 0; overflow: hidden;
  font: 16u/13u "m5x7", monospace; color: var(--ink); text-transform: uppercase;
  -webkit-font-smoothing: none; font-smooth: never; text-rendering: optimizeSpeed;
  image-rendering: pixelated; user-select: none;
  cursor: var(--cursor), auto;
}
.cu[data-side="in"] { color: var(--paper); --dim: ${ROLE.dimOnDark}; ${faceVars('in')} }
/* anything that stands for a face: data-face gives it that face's colour */
${Object.keys(FACE_HUD)
  .map((f) => `.cu [data-face="${f}"] { --c: var(--face-${f}); --k: var(--face-${f}-k); }`)
  .join('\n')}
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

/* ---------- in-game layout ---------- */
/* ONE GRID, two areas: "view" (the game, as large as it can be, with the label of the
   neighbouring face on each of its four edges) and "side" (one column with everything
   else). Every size is a variable, so another layout (a narrow landscape phone, say) only
   has to set them again and move the two areas.
     --z     the game view's whole-number zoom       (style/scale.ts viewZoom, set by cubicUI)
     --u     the scale of everything else in game    (style/scale.ts hudScale, set by cubicUI)
   The numbers are VIEW in style/tokens.ts, which viewZoom reads too. */
.cu {
  --z: 3;
  --view: calc(${VIEW.px}px * var(--z));
  --frame: ${VIEW.frame}u; --edge: ${VIEW.edge}u; --gap: ${VIEW.gap}u; --pad: 3u;
  --col-min: ${VIEW.columnMin}u; --col-max: ${VIEW.columnMax}u;
  /* the view with its frame and its four edge bands: a square */
  --mid: calc(var(--view) + 2 * var(--frame) + 2 * var(--edge) + 4u);
  --col: clamp(var(--col-min), calc(100vw - var(--mid) - 3 * var(--gap)), var(--col-max));
  --hud-w: calc(var(--mid) + var(--gap) + var(--col));
  --hud-x: max(var(--gap), calc((100vw - var(--hud-w)) / 2));
  --hud-y: max(0px, calc((100vh - var(--mid)) / 2));
  /* for what is placed on the view or on the column from outside the grid */
  --view-x: calc(var(--hud-x) + var(--mid) / 2);
  --view-top: calc(var(--hud-y) + var(--edge) + 2u + var(--frame));
  --col-x: calc(var(--hud-x) + var(--mid) + var(--gap));
}
/* whole pixels only: a canvas on a half pixel is blurred */
@supports (width: round(down, 1px, 1px)) {
  .cu { --hud-x: round(down, max(var(--gap), calc((100vw - var(--hud-w)) / 2)), 1px); --hud-y: round(down, max(0px, calc((100vh - var(--mid)) / 2)), 1px); }
}
.cu-hud { position: absolute; top: 0; bottom: 0; left: var(--hud-x); width: var(--hud-w); display: none; grid-template-columns: var(--mid) var(--col); grid-template-rows: 100%; grid-template-areas: "view side"; column-gap: var(--gap); }
.cu[data-screen="game"] .cu-hud { display: grid; animation: cu-in 0.48s steps(4) both; }
@keyframes cu-in { from { opacity: 0; } to { opacity: 1; } }
/* in game the top bar (leave, room code, gear) is the head of the column */
.cu[data-screen="game"] .cu-top { left: var(--col-x); right: auto; width: var(--col); }
.cu[data-screen="game"] .cu-top-side { width: auto; flex: 1; }
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
.cu-edge { white-space: nowrap; color: ${ROLE.ink}; display: flex; align-items: center; gap: 3u; height: var(--edge); }
.cu[data-side="in"] .cu-edge { color: ${ROLE.paper}; }
.cu-edge.t { grid-column: 2; grid-row: 1; }
.cu-edge.b { grid-column: 2; grid-row: 3; }
.cu-edge.l { grid-column: 1; grid-row: 2; writing-mode: vertical-rl; transform: rotate(180deg); width: var(--edge); height: auto; }
.cu-edge.r { grid-column: 3; grid-row: 2; writing-mode: vertical-rl; width: var(--edge); height: auto; }
.cu-edge > span { display: block; margin-top: -2u; }
.cu-edge.l > span, .cu-edge.r > span { margin-top: 0; margin-right: -2u; }
.cu-edge.l .cu-chip { transform: rotate(180deg); }
.cu-edge.done { color: ${ROLE.out.deep}; }
.cu[data-side="in"] .cu-edge.done { color: ${ROLE.out.light}; }
/* a face chip: a square in the face's colour with its number. On the view's edges, around
   the cube and before the face's name. */
.cu-chip { display: block; flex: none; width: 9u; height: 9u; background: var(--c); color: var(--k); outline: 1u solid ${ROLE.ink}; font-style: normal; font-weight: normal; text-align: center; line-height: 10u; writing-mode: horizontal-tb; text-indent: 1u; }
.cu[data-side="in"] .cu-chip { outline-color: ${ROLE.paper}; }
/* where the controls hint of the onboarding sits (ui/onboarding/anchors.ts): inside the
   view, along its bottom. Nothing is drawn here. */
.cu-keys { position: absolute; left: 0; right: 0; bottom: 6u; height: 44u; pointer-events: none; }

/* ----- the column: where you are, voice, time, chat ----- */
.cu-col { grid-area: side; display: flex; flex-direction: column; gap: var(--gap); min-width: 0; min-height: 0; margin: 28u 0 var(--gap); }
.cu-where { display: grid; grid-template-columns: 78u minmax(0, 1fr); grid-template-areas: "cube id" "obj obj"; gap: var(--pad) 4u; }
.cu-id { grid-area: id; display: flex; flex-direction: column; justify-content: space-between; min-width: 0; }
.cu-side { display: block; font: 32u/22u "m5x7", monospace; font-weight: normal; margin-top: -4u; color: ${ROLE.out.dark}; }
.cu[data-side="in"] .cu-side { color: ${ROLE.in.base}; }
.cu-face { display: flex; align-items: center; gap: 3u; height: 13u; white-space: nowrap; }
.cu-face > span, .cu-prog > span, .cu-prog > b { display: block; margin-top: -2u; }
.cu-prog { display: flex; align-items: center; gap: 3u; height: 13u; white-space: nowrap; }
.cu-prog b { font-weight: normal; color: ${ROLE.portalDark}; }
.cu[data-side="in"] .cu-prog b { color: ${ROLE.portal}; }
.cu-prog.open .cu-pips { display: none; }
.cu-carry { display: flex; align-items: center; gap: 3u; height: 16u; white-space: nowrap; overflow: hidden; }
.cu-carry > span { display: block; margin-top: -2u; }
.cu-item { width: 16u; height: 16u; background: ${url('sprites/items.png')} 0 0 / 48u 16u; flex: none; }
.cu-obj { grid-area: obj; margin: 0; text-transform: none; min-height: 26u; }
/* the cube (client/src/cube/hud.ts): a canvas in art pixels and a chip on each edge for the
   face that lies that way. The pips (one per face: solved, you, portal) are in .cu-prog. */
.cu-cube { grid-area: cube; --pc: var(--in); }
.cu-cube[data-partner="out"] { --pc: var(--out); }
.cu-cube-box { display: grid; grid-template-columns: 11u 56u 11u; grid-template-rows: 11u 56u 11u; justify-items: center; align-items: center; }
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
.cu-pips > i.portal, .cu[data-side="in"] .cu-pips > i.portal { background: ${ROLE.portal}; color: ${ROLE.ink}; animation: cu-blink 0.84s steps(2) infinite; }
@keyframes cu-blink { 50% { background: ${ROLE.portalDark}; } }
/* the cube map (Tab): over the view */
.cu-cubemap { position: absolute; top: 0; bottom: 0; left: 0; width: var(--mid); display: none; align-items: center; justify-content: center; z-index: 8; pointer-events: none; }
.cu-cubemap.on { display: flex; }
.cu-cubemap .cu-panel { display: flex; flex-direction: column; align-items: center; gap: 2u; padding: 2u 6u 3u; }
.cu-cubemap b { font-weight: normal; }
.cu-cubemap canvas { width: 132u; height: 132u; }

.cu-voice { display: flex; flex-direction: column; gap: var(--pad); }
.cu-vrow { display: flex; align-items: center; gap: 3u; height: 13u; white-space: nowrap; }
.cu-vrow > span { display: block; margin-top: -2u; }
.cu-vrow .them { margin-left: auto; }
.cu-dot { width: 5u; height: 5u; background: ${C.mauve}; outline: 1u solid ${ROLE.ink}; flex: none; margin: 0 1u; }
.cu-dot.on { background: var(--signal); }
.cu-signal { width: 16u; height: 16u; background: ${url('ui/signal.png')} 0 0 / 64u 16u; flex: none; margin: -2u 0; }
.cu-vbtns { display: flex; gap: var(--pad); flex-wrap: wrap; }
.cu-warn { color: ${ROLE.danger}; text-transform: none; }
.cu-note { text-transform: none; color: var(--dim); }
/* time, and strikes once there are any */
.cu-stats { display: flex; gap: var(--gap); }
.cu-stat { ${nine('ui/tag.png', 4)} height: 18u; padding: 0 5u 0 1u; color: ${ROLE.paper}; display: flex; align-items: center; gap: 2u; white-space: nowrap; line-height: 10u; }
.cu[data-side="in"] .cu-stat { border-image-source: ${url('ui/tag-light.png')}; color: ${ROLE.ink}; }
.cu-stat .cu-ico { margin: -4u 0; }
.cu-stat span { display: block; margin-top: -1u; }
.cu-stat.x { color: ${C.salmon}; }
.cu[data-side="in"] .cu-stat.x { color: ${ROLE.dangerDark}; }
.cu-chat { flex: 1; min-height: 60u; display: flex; flex-direction: column; gap: var(--pad); }
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
.cu-settings { width: 448u; display: flex; flex-direction: column; gap: 3u; padding: 2u 4u 4u; }
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
.cu-credit { text-align: center; text-transform: none; color: var(--dim); margin-top: 2u; }

/* the win screen: the title, the time, then leave or play again */
.cu-win { width: 216u; text-align: center; padding: 4u 4u 6u; }
.cu-win h2 { font: 32u/26u "m5x7", monospace; margin: 0 0 6u; color: ${ROLE.portalDark}; font-weight: normal; }
.cu-win p { margin: 0; }
.cu-wintime { display: block; font: 32u/26u "m5x7", monospace; font-weight: normal; margin: 0 0 4u; }
.cu-win .cu-actions { margin-top: 8u; }

/* ---------- settings: two columns of rows ---------- */
.cu-setgrid { display: grid; grid-template-columns: 228u 1fr; column-gap: 8u; align-items: start; }
.cu-setcol { display: flex; flex-direction: column; gap: 3u; min-width: 0; }
.cu-sub { color: var(--dim); border-bottom: 1u solid var(--dim); padding-bottom: 2u; margin: 2u 0 1u; }
.cu-state { width: 20u; flex: none; text-align: right; color: ${ROLE.dimOnLight}; }
.cu-seg { display: flex; flex: none; gap: 1u; outline: none; background: ${ROLE.ink}; padding: 1u; }
.cu-seg span { display: block; height: 12u; min-width: 14u; padding: 0 3u; line-height: 9u; text-align: center; white-space: nowrap; background: ${C.mist}; color: ${ROLE.dimOnLight}; }
/* the chosen one is inverted and underlined: a shape, not only a colour */
.cu-seg span.on { background: ${ROLE.ink}; color: ${ROLE.paper}; box-shadow: inset 0 -2u 0 ${ROLE.focus}; }

/* ---------- pause menu ---------- */
.cu-pause { width: 448u; padding: 2u 4u 8u; }
.cu-pausegrid { display: grid; grid-template-columns: 96u 1fr; column-gap: 10u; align-items: start; }
.cu-pausebtns { display: flex; flex-direction: column; gap: 5u; padding-top: 4u; }
.cu-pausebtns .cu-btn { width: 100%; }
.cu-pausebtns .cu-note { margin: 2u 0 0; }
.cu-help { display: flex; flex-direction: column; gap: 1u; }
.cu-helprow { display: grid; grid-template-columns: 84u 80u 1fr; column-gap: 4u; align-items: baseline; }
.cu-helprow kbd { font: inherit; }
.cu-helprow span { text-transform: none; }
.cu-helprow.head { color: var(--dim); }

/* ---------- keyboard focus: one pixel outline, the same on every control ---------- */
.cu-btn:focus-visible, .cu-gear:focus-visible, .cu-toggle:focus-visible, .cu-slider:focus-visible, .cu-seg:focus-visible {
  outline: 2u solid ${ROLE.focus}; outline-offset: 1u; box-shadow: 0 0 0 4u ${ROLE.ink};
}

/* ---------- shapes next to colours ---------- */
/* a pixel tick: solved */
.cu-tick { display: inline-block; position: relative; width: 4u; height: 3u; flex: none; }
.cu-tick::before { content: ""; position: absolute; left: 0; top: 0; width: 1u; height: 1u; box-shadow: 0 1u currentColor, 1u 2u currentColor, 2u 1u currentColor, 3u 0 currentColor; }
/* a pixel plus: you are here */
.cu-pip { position: absolute; left: 1u; bottom: 1u; width: 3u; height: 3u; }
.cu-pip::before { content: ""; position: absolute; left: 0; top: 0; width: 1u; height: 1u; box-shadow: 1u 0 currentColor, 0 1u currentColor, 1u 1u currentColor, 2u 1u currentColor, 1u 2u currentColor; }
/* a pixel ring: the portal is awake */
.cu-ring { position: absolute; right: 1u; bottom: 1u; width: 3u; height: 3u; border: 1u solid currentColor; }

/* ---------- quick-chat bubbles, over the game view ---------- */
.cu-over { position: absolute; inset: var(--frame); z-index: 2; pointer-events: none; line-height: 13u; }
.cu-bubble {
  position: absolute; transform: translate(-50%, -100%); margin-top: -3u; white-space: nowrap; text-transform: none;
  ${nine('ui/tag.png', 4)} padding: 0 3u; color: ${ROLE.paper}; z-index: 1;
}
.cu-bubble.under { transform: translate(-50%, 0); margin-top: 1u; }
.cu-bubble.mine { border-image-source: ${url('ui/tag-light.png')}; color: ${ROLE.ink}; }
/* the tail: it points at who is speaking */
.cu-bubble::after { content: ""; position: absolute; left: 50%; bottom: -6u; margin-left: -1u; width: 2u; height: 2u; background: ${ROLE.ink}; }
.cu-bubble.under::after { bottom: auto; top: -6u; }

/* ---------- captions and "Partner speaking" ---------- */
.cu-subs { position: absolute; left: 50%; bottom: max(6u, calc(var(--subs-lift, 0px) + 2u)); transform: translateX(-50%); z-index: 8; display: flex; flex-direction: column; align-items: center; gap: 2u; pointer-events: none; max-width: 90%; }
.cu-caption { ${nine('ui/tag.png', 4)} padding: 1u 5u 3u; color: ${ROLE.paper}; text-transform: none; text-align: center; max-width: 340u; }
/* in game they sit on the game view, along its bottom */
.cu[data-screen="game"] .cu-subs { left: var(--view-x); width: max-content; max-width: calc(var(--view) - 8u); bottom: max(calc(100vh - var(--view-top) - var(--view) + 4u), calc(var(--subs-lift, 0px) + 2u)); }
.cu[data-side="in"] .cu-caption { outline: 1u solid ${ROLE.dimOnDark}; }
.cu-caption b { font-weight: normal; text-transform: uppercase; color: ${ROLE.in.base}; }
.cu-speaking { ${nine('ui/tag-light.png', 4)} height: 18u; padding: 0 5u 0 1u; color: ${ROLE.ink}; display: flex; align-items: center; gap: 2u; white-space: nowrap; line-height: 10u; }
.cu-speaking .cu-ico { margin: -4u 0; }
.cu-speaking span { display: block; margin-top: -1u; }

/* ---------- text size (settings): the reading text, in whole pixel multiples ---------- */
.cu-log, .cu-obj, .cu-caption, .cu-bubble { font-size: calc(16px * var(--tu)); line-height: calc(13px * var(--tu)); }

/* ---------- high contrast (settings): no faint text, hard edges, a heavier veil ---------- */
.cu[data-contrast="high"], .cu[data-contrast="high"] .cu-panel { --dim: ${ROLE.ink}; }
.cu[data-contrast="high"][data-side="in"], .cu[data-contrast="high"][data-side="in"] .cu-hud .cu-panel { --dim: ${ROLE.paper}; }
.cu[data-contrast="high"] .cu-panel { outline: 2u solid ${ROLE.ink}; }
.cu[data-contrast="high"][data-side="in"] .cu-hud .cu-panel { outline-color: ${ROLE.paper}; }
.cu[data-contrast="high"] .cu-modal { background: rgba(46, 34, 47, 0.88); }
.cu[data-contrast="high"] .cu-set .val, .cu[data-contrast="high"] .cu-state, .cu[data-contrast="high"] .cu-set.off, .cu[data-contrast="high"] .cu-seg span { color: ${ROLE.ink}; }
.cu[data-contrast="high"] .cu-seg span.on { color: ${ROLE.paper}; }
.cu[data-contrast="high"] .cu-set.off label { text-decoration: line-through; }
.cu[data-contrast="high"] .cu-field::placeholder { color: ${ROLE.ink}; }
.cu[data-contrast="high"] .cu-log b, .cu[data-contrast="high"] .cu-edge.done, .cu[data-contrast="high"] .cu-side, .cu[data-contrast="high"] .cu-prog b, .cu[data-contrast="high"] .cu-stat.x, .cu[data-contrast="high"] .cu-warn { color: inherit; }
.cu[data-contrast="high"] .cu-log b { text-decoration: underline; }
.cu[data-contrast="high"] .cu-view { outline: 2u solid ${ROLE.paper}; }
.cu[data-contrast="high"] .cu-caption, .cu[data-contrast="high"] .cu-bubble, .cu[data-contrast="high"] .cu-speaking { outline: 1u solid ${ROLE.paper}; }
.cu[data-contrast="high"] .cu-btn:focus-visible, .cu[data-contrast="high"] .cu-gear:focus-visible, .cu[data-contrast="high"] .cu-toggle:focus-visible, .cu[data-contrast="high"] .cu-slider:focus-visible, .cu[data-contrast="high"] .cu-seg:focus-visible { outline-width: 3u; box-shadow: 0 0 0 6u ${ROLE.ink}; }

`;

/** "12u" to calc(12px * var(--u)). */
export const CSS = RAW.replace(/(-?\d+(?:\.\d+)?)u\b/g, 'calc($1px * var(--u))');

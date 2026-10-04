import { voiceMix, type GameState, type RoomInfo, type Side } from '@cubic/shared';
import { inputPaused } from '../../input/gate';
import { gameAction } from '../../input/keymap';
import { onFit, viewport, visibleSize } from '../../style/scale';
import { onSettings, settings } from '../../style/settings';
import { ANCHOR } from './anchors';
import { showCaption } from './caption';
import { ONBOARDING_CSS } from './css';
import { controlsHint, createOnboarding, EMPTY_VIEW, fadeMs, HINT_TEXT, type ContextHint, type GameSnapshot, type OnboardingView } from './rules';

// ONBOARDING: the side intro card, the controls hint, the three context hints and the
// narrator's captions. One DOM layer over the HUD that never takes a click, so the gear,
// Leave and every menu work exactly as before. The one exception is the side card while
// it is up: it has a GOT IT button, and Esc or a click anywhere else closes it too.
//
// rules.ts decides what shows (pure, tested). This file only reads the game a few times a
// second, asks the rules, and draws the answer next to the HUD elements in anchors.ts.

/** What the layer reads. The app's Net has exactly these fields; nothing is ever written. */
export interface OnboardingSource {
  state: GameState | null;
  side: Side | null;
  room: Pick<RoomInfo, 'phase' | 'seats'> | null;
}

const TICK_MS = 100;
/** Per tab, like the seat (net/client.ts): the game whose controls hint has been shown. */
const CONTROLS_KEY = 'cubic.onb.controls';
function controlsSeenFor(): number | null {
  try {
    const id = Number(sessionStorage.getItem(CONTROLS_KEY) ?? NaN);
    return Number.isFinite(id) ? id : null;
  } catch {
    return null; // storage blocked: the hint is only once per page load
  }
}
/** Close the side card if it is up (Esc does this before it would pause). True if it was. */
let dismissCard: () => boolean = () => false;
export const dismissSideCard = (): boolean => dismissCard();

type Where = { anchor: keyof typeof ANCHOR; place: 'center' | 'top' | 'bottom' | 'above' | 'over' | 'right' | 'left' };
const HINT_AT: Record<ContextHint, Where> = {
  cube: { anchor: 'cube', place: 'right' },
  edge: { anchor: 'view', place: 'center' }, // the player is at an edge, so the middle is free
  voice: { anchor: 'voice', place: 'left' },
};

const HTML = `
<div class="cu-panel cu-onb-card" role="status"><header><h3></h3><button class="cu-chipbtn" type="button"><span></span></button></header><p></p></div>
<div class="cu-panel cu-onb-keys" role="note" aria-label="Controls"></div>
<div class="cu-panel cu-onb-hint" role="status"><i class="cu-ico left"></i><span></span><i class="cu-ico right"></i></div>`;

export function mountOnboarding(root: HTMLElement, source: OnboardingSource): () => void {
  const host = root.querySelector<HTMLElement>('.cu');
  if (!host) return () => {};
  const style = document.createElement('style');
  style.textContent = ONBOARDING_CSS;
  document.head.appendChild(style);
  const layer = document.createElement('div');
  layer.className = 'cu-onb';
  layer.innerHTML = HTML;
  host.appendChild(layer);

  const card = layer.querySelector<HTMLElement>('.cu-onb-card')!;
  const keys = layer.querySelector<HTMLElement>('.cu-onb-keys')!;
  const hint = layer.querySelector<HTMLElement>('.cu-onb-hint')!;

  /** The controls hint shows the keys as they are bound now: redrawn when they change. */
  let keysSig = '';
  function renderKeys(): void {
    const rows = controlsHint();
    const sig = JSON.stringify(rows);
    if (sig === keysSig) return;
    keysSig = sig;
    keys.replaceChildren(
      ...rows.map((row) => {
        const div = document.createElement('div');
        row.keys.forEach((k, i) => {
          if (i) div.append('/');
          const kbd = document.createElement('kbd');
          kbd.className = 'cu-kbd';
          kbd.textContent = k;
          div.append(kbd);
        });
        const does = document.createElement('span');
        does.textContent = row.does;
        div.append(does);
        return div;
      }),
    );
  }
  renderKeys();
  card.querySelector('p')!.textContent = HINT_TEXT.cardLine;
  const gotIt = card.querySelector<HTMLButtonElement>('button')!;
  gotIt.firstElementChild!.textContent = HINT_TEXT.cardDismiss;

  const rules = createOnboarding({ controlsSeenFor: controlsSeenFor() });
  let view: OnboardingView = EMPTY_VIEW;
  let moved = false;
  let controlsSaved: number | null = null;
  let dismissed = false;

  /** Close the side card now. True if it was up. */
  const dismiss = (): boolean => {
    if (!view.card) return false;
    dismissed = true;
    gotIt.blur();
    tick();
    return true;
  };
  dismissCard = dismiss;
  // GOT IT: a real button, so a mouse click, a tap, and Enter or Space once it has the
  // focus all press it. It never takes the focus by itself: the movement keys stay the game's.
  gotIt.addEventListener('click', (e) => {
    e.stopPropagation();
    dismiss();
  });
  /** A press anywhere outside the card closes it too (and still does what it would have done). */
  const onPress = (e: PointerEvent) => {
    if (view.card && !card.contains(e.target as Node)) dismiss();
  };
  window.addEventListener('pointerdown', onPress, true);

  const onKey = (e: KeyboardEvent) => {
    if (gameAction(e)?.type !== 'move') return; // (the live bindings; null for a repeat)
    if (document.activeElement instanceof HTMLInputElement) return; // typing in the chat
    if (host.dataset.screen !== 'game' || inputPaused()) return; // a menu is on top: not a step
    moved = true;
    tick(); // the controls hint goes with the key, not up to a tick later
  };
  window.addEventListener('keydown', onKey, true);

  function snapshot(): GameSnapshot | null {
    const { state, side, room } = source;
    if (!state || !side || room?.phase !== 'playing' || host!.dataset.screen !== 'game') return null;
    const pose = state.players[side].pose;
    const partner = room.seats[side === 'out' ? 'in' : 'out'];
    return {
      id: state.startedAt,
      side,
      face: pose.face,
      x: pose.x,
      y: pose.y,
      gain: partner.connected && settings().voiceOn ? voiceMix(state).gain : null,
      solved: state.solved.length,
      won: state.wonAt !== null,
    };
  }

  /** Put `el` next to its anchor, on the art-pixel grid. A missing anchor falls back to the view. */
  function place(el: HTMLElement, at: Where): void {
    const target = host!.querySelector<HTMLElement>(ANCHOR[at.anchor]) ?? host!.querySelector<HTMLElement>(ANCHOR.view);
    if (!target) return;
    const u = Number(host!.style.getPropertyValue('--u')) || 2;
    const a = target.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let x = a.left + (a.width - w) / 2;
    let y = a.top + (a.height - h) / 2;
    if (at.place === 'above') y = a.top - h - 18 * u; // clear of the view and of the edge label over it
    if (at.place === 'over') y = a.top;
    if (at.place === 'top') y = a.top + 8 * u;
    if (at.place === 'bottom') y = a.bottom - h; // it grows upwards with a larger text, never out of the view
    if (at.place === 'right') x = a.right + 5 * u;
    if (at.place === 'left') x = a.left - w - 5 * u;
    x = Math.max(2 * u, Math.min(viewport().width - w - 2 * u, x));
    y = Math.max(24 * u, Math.min(viewport().height - h - 2 * u, y)); // never under the top bar
    el.style.transform = `translate(${Math.round(x / u) * u}px, ${Math.round(y / u) * u}px)`;
  }

  function layout(): void {
    if (view.card) place(card, { anchor: 'view', place: 'top' });
    if (view.controls) place(keys, { anchor: 'keys', place: 'bottom' });
    if (view.hint) place(hint, HINT_AT[view.hint]);
    // The captions (narrator, AI) sit at the bottom, where the controls hint is: while it
    // is up they stack on top of it instead of covering it.
    const lift = view.controls ? visibleSize().height - keys.getBoundingClientRect().top : 0;
    host!.style.setProperty('--subs-lift', `${Math.round(lift)}px`);
  }

  function tick(): void {
    const game = snapshot();
    const next = rules.step({ now: Date.now(), hints: settings().hints, game, moved, dismissed });
    moved = false;
    dismissed = false;
    renderKeys();
    layer.classList.toggle('still', fadeMs(settings().reduceMotion) === 0);
    // The controls hint has had its time: remember for which game, so a reload does not show it again.
    if (game && game.id !== controlsSaved && rules.seen().includes('controls')) {
      controlsSaved = game.id;
      try {
        sessionStorage.setItem(CONTROLS_KEY, String(game.id));
      } catch {
        // storage blocked: see controlsSeenFor
      }
    }

    // Content changes only when something comes on: what is leaving keeps its text while it fades.
    if (next.card && next.card !== view.card) {
      const t = HINT_TEXT.card[next.card];
      const word = document.createElement('b');
      word.textContent = t.word;
      card.dataset.side = next.card;
      card.querySelector('h3')!.replaceChildren(t.lead, word, t.tail);
    }
    if (next.hint && next.hint !== view.hint) {
      const at = HINT_AT[next.hint];
      hint.dataset.arrow = at.place === 'right' ? 'left' : at.place === 'left' ? 'right' : '';
      hint.querySelector('span')!.textContent = HINT_TEXT.context[next.hint];
    }
    if (next.caption !== view.caption) showCaption(next.caption);
    card.classList.toggle('on', !!next.card);
    keys.classList.toggle('on', next.controls);
    hint.classList.toggle('on', !!next.hint);
    // the HUD's own key line is wider than the controls hint and would stick out under it
    const line = host!.querySelector<HTMLElement>(ANCHOR.keys);
    if (line) line.style.visibility = next.controls ? 'hidden' : '';
    view = next;
    layout();
  }

  const timer = setInterval(tick, TICK_MS);
  const settingsOff = onSettings(tick); // "Hints" off takes everything away at once
  const fitOff = onFit(layout);
  // Dev only, like window.__cubic: lets the screenshot script see what has been shown.
  if (import.meta.env.DEV) Object.assign(window, { __cubicOnboarding: rules });
  tick();

  return () => {
    clearInterval(timer);
    settingsOff();
    fitOff();
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('pointerdown', onPress, true);
    dismissCard = () => false;
    showCaption(null);
    host.style.removeProperty('--subs-lift');
    layer.remove();
    style.remove();
  };
}

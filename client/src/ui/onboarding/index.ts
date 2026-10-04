import { voiceMix, type GameState, type RoomInfo, type Side } from '@cubic/shared';
import { onSettings, settings } from '../../style/settings';
import { ANCHOR } from './anchors';
import { showCaption } from './caption';
import { ONBOARDING_CSS } from './css';
import { createOnboarding, EMPTY_VIEW, HINT_TEXT, type ContextHint, type GameSnapshot, type OnboardingView } from './rules';

// ONBOARDING: the side intro card, the controls hint, the three context hints and the
// narrator's captions. One DOM layer over the HUD that never takes a click, so the gear,
// Leave and every menu work exactly as before.
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
/** Keys that count as "interacted": E, and Q (drop) once it is bound. */
const INTERACT_KEYS = new Set(['e', 'q']);

type Where = { anchor: keyof typeof ANCHOR; place: 'center' | 'above' | 'over' | 'right' | 'left' };
const HINT_AT: Record<ContextHint, Where> = {
  cube: { anchor: 'cube', place: 'right' },
  edge: { anchor: 'view', place: 'center' }, // the player is at an edge, so the middle is free
  voice: { anchor: 'voice', place: 'left' },
};

const HTML = `
<div class="cu-panel cu-onb-card" role="status"><i></i><div><h3></h3><p></p></div></div>
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

  for (const row of HINT_TEXT.controls) {
    const div = document.createElement('div');
    row.keys.forEach((k, i) => {
      if (i) div.append('/');
      const kbd = document.createElement('kbd');
      kbd.textContent = k;
      div.append(kbd);
    });
    const does = document.createElement('span');
    does.textContent = row.does;
    div.append(does);
    keys.append(div);
  }
  card.querySelector('p')!.textContent = HINT_TEXT.cardLine;

  const rules = createOnboarding();
  let view: OnboardingView = EMPTY_VIEW;
  let interacted = false;

  const onKey = (e: KeyboardEvent) => {
    if (e.repeat || !INTERACT_KEYS.has(e.key.toLowerCase())) return;
    if (document.activeElement instanceof HTMLInputElement) return; // typing in the chat
    if (host.dataset.screen === 'game') interacted = true;
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
    if (at.place === 'right') x = a.right + 5 * u;
    if (at.place === 'left') x = a.left - w - 5 * u;
    x = Math.max(2 * u, Math.min(window.innerWidth - w - 2 * u, x));
    y = Math.max(24 * u, Math.min(window.innerHeight - h - 2 * u, y)); // never under the top bar
    el.style.transform = `translate(${Math.round(x / u) * u}px, ${Math.round(y / u) * u}px)`;
  }

  function layout(): void {
    if (view.card) place(card, { anchor: 'view', place: 'center' });
    if (view.controls) place(keys, { anchor: 'keys', place: 'over' });
    if (view.hint) place(hint, HINT_AT[view.hint]);
  }

  function tick(): void {
    const next = rules.step({ now: Date.now(), hints: settings().hints, game: snapshot(), interacted });
    interacted = false;
    layer.classList.toggle('still', settings().reduceMotion);

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
  window.addEventListener('resize', layout);
  // Dev only, like window.__cubic: lets the screenshot script see what has been shown.
  if (import.meta.env.DEV) Object.assign(window, { __cubicOnboarding: rules });
  tick();

  return () => {
    clearInterval(timer);
    settingsOff();
    window.removeEventListener('resize', layout);
    window.removeEventListener('keydown', onKey, true);
    showCaption(null);
    layer.remove();
    style.remove();
  };
}

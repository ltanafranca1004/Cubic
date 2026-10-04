import { QUICK_CHATS } from '@cubic/shared';
import { isMapHeld } from '../../input/gate';
import { CODEPAD_EVENT, bindDpad, bindKey, releaseAll, sendTouch, tapKey, type TouchAction } from '../../input/touch';
import { ITEM_DEFAULT_FRAME, ITEM_FRAMES } from '../../style/assets';
import { compactLayout, isPortrait, wideLayout } from '../../style/fit';
import { device, layout, safeInsets, viewport } from '../../style/scale';
import { onSettings, settings } from '../../style/settings';
import { showCaption } from '../captions';
import type { UIActions, UIHandle, UIHost, UIState } from '../hooks';
import { MOBILE_CSS } from './css';

// TOUCH SCREENS: phones and tablets held sideways. One DOM layer over the UI, mounted only
// when the main pointer is a finger (style/scale.ts device(), or ?touch), so a desktop
// never runs any of this.
//
//   - the controls: a d-pad, and USE, DROP, TALK, CHAT, MAP and MENU. They send keys
//     (input/touch.ts), so the game reacts exactly as it does to a keyboard.
//   - the layout: "compact" on a phone (the view in the middle, a rail of controls on each
//     side, the HUD column folded into a panel behind the HUD button, and what to do next
//     always in sight top left), "wide" on a tablet (the desktop layout with the controls
//     in a strip under it). The arithmetic is in style/fit.ts, the looks in ./css.ts.
//   - the rotate card when the device is held upright, the letter keys for the room code,
//     and the page rules (no zoom, no scroll, no long-press menu).

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const btn = (id: string, label: string, cls = '') => `<div class="cu-m-btn ${cls}" data-m="${id}" role="button" aria-label="${label}"><span>${label}</span></div>`;

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const letterKeys = (from: number, to: number) => LETTERS.slice(from, to).map((l) => btn(`key-${l}`, l)).join('');

const HTML = `
<div class="cu-m">
  <div class="cu-panel cu-m-glance" data-m="glance" role="status">
    <div class="cu-face"><i class="cu-chip" data-m="faceno"></i><span data-m="face"></span><span class="cu-m-clock" data-m="clock"></span></div>
    <div class="cu-prog" data-m="prog"><span data-m="progn"></span><div class="cu-pips" data-m="pips"></div><b data-m="portal" hidden>Portal open</b></div>
    <p data-m="obj"></p>
    <div class="cu-m-carry" data-m="carry" hidden><i class="cu-item"></i><span></span></div>
  </div>
  <div class="cu-m-pad" data-m="pad" role="group" aria-label="Move"><i class="up"></i><i class="left"></i><i class="hub"></i><i class="right"></i><i class="down"></i></div>
  <div class="cu-m-acts" data-m="acts">
    ${btn('map', 'Map')}${btn('chat', 'Chat')}${btn('talk', 'Talk')}
    ${btn('pause', 'Menu')}${btn('drop', 'Drop')}${btn('interact', 'Use', 'go')}
  </div>
  ${btn('info', 'HUD', 'cu-m-info')}
  <div class="cu-panel cu-m-chat" data-m="chatbox">
    <div><input class="cu-field" data-m="field" maxlength="200" placeholder="Say something" autocomplete="off" autocapitalize="sentences" enterkeyhint="send" aria-label="Chat message" />${btn('send', 'Send', 'go cu-m-send')}${btn('x', 'Close', 'cu-m-x')}</div>
    <div>${QUICK_CHATS.map((line, i) => btn(`quick${i + 1}`, line)).join('')}</div>
  </div>
  <div class="cu-m-shade" data-m="shade"></div>
</div>
<div class="cu-m-code" data-m="code"><div>${letterKeys(0, 13)}</div><div>${letterKeys(13, 26)}${btn('key-Backspace', 'Delete', 'back')}</div></div>
<div class="cu-modal cu-m-rotate" data-m="rotate"><div class="cu-panel" role="alertdialog" aria-label="Rotate your device">
  <div class="cu-m-phone"><i></i></div>
  <b>Rotate your device</b>
  <p>Cubic is played sideways.</p>
</div></div>`;

interface Mobile {
  update(state: UIState): void;
  destroy(): void;
}

function mountMobile(cu: HTMLElement, actions: UIActions): Mobile {
  const html = document.documentElement;
  html.dataset.touch = '';
  const style = document.createElement('style');
  style.textContent = MOBILE_CSS;
  document.head.appendChild(style);
  const layer = document.createElement('div');
  layer.style.display = 'contents';
  layer.innerHTML = HTML;
  cu.appendChild(layer);
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => layer.querySelector<T>(`[data-m="${id}"]`)!;

  let state: UIState | null = null;
  const inGame = () => cu.dataset.screen === 'game';
  const offs: (() => void)[] = [];
  const on = (target: EventTarget, type: string, fn: (e: Event) => void, opts?: AddEventListenerOptions) => {
    target.addEventListener(type, fn, opts);
    offs.push(() => target.removeEventListener(type, fn, opts));
  };

  // ---------- the layout: where the view and the controls sit ----------
  let laid = '';
  const rotate = $('rotate');
  function relayout(): void {
    const { width, height } = viewport();
    const mode = layout(width, height);
    const d = device();
    cu.dataset.touch = mode;
    const set = (name: string, px: number) => cu.style.setProperty(name, `${px}px`);
    if (mode === 'compact') {
      const l = compactLayout(width, height, d);
      set('--m-vx', l.view.x);
      set('--m-vy', l.view.y);
      set('--m-rail', l.rail);
      set('--m-band', l.band);
      set('--m-pad', l.pad);
      set('--m-btn', l.button);
    } else {
      const l = wideLayout(width, height, d);
      set('--m-strip', l.strip);
      set('--m-pad', l.pad);
      set('--m-btn', l.button);
    }
    // held upright: the card covers everything and the game takes no input (it is a
    // .cu-modal, which is what input/gate.ts and input/overlay.ts look for)
    const upright = isPortrait(window.innerWidth, window.innerHeight);
    if (upright !== rotate.classList.contains('on')) {
      rotate.classList.toggle('on', upright);
      if (upright) {
        releaseAll();
        closeChat();
      }
    }
    code.classList.remove('on'); // the menu is rebuilt on a resize, and its join popup with it
    const inset = safeInsets();
    laid = [window.innerWidth, window.innerHeight, inset.top, inset.left, inset.right].join();
  }
  /**
   * The window can change with no `resize` (the URL bar slides away, the notch changes
   * side): tell everyone who lays out on `resize`. The on-screen keyboard is not a change
   * (style/scale.ts viewport()).
   */
  function nudge(): void {
    if (document.activeElement instanceof HTMLInputElement) return;
    const inset = safeInsets();
    if ([window.innerWidth, window.innerHeight, inset.top, inset.left, inset.right].join() !== laid) window.dispatchEvent(new Event('resize'));
  }
  on(window, 'resize', relayout);
  on(window, 'orientationchange', () => setTimeout(nudge, 250));
  if (window.visualViewport) on(window.visualViewport, 'resize', nudge);

  // ---------- the page: nothing but the game reacts to a finger ----------
  on(cu, 'contextmenu', (e) => e.preventDefault());
  on(document, 'gesturestart', (e) => e.preventDefault()); // iOS pinch
  on(document, 'touchmove', (e) => {
    // iOS rubber band: only the lists that scroll may move
    if (!(e.target as HTMLElement).closest?.('.cu-log, .cu-modal > .cu-panel')) e.preventDefault();
  }, { passive: false });
  // (a second tap is a second tap, never a zoom: touch-action in ./css.ts)

  // ---------- the controls ----------
  offs.push(bindDpad($('pad')));
  for (const action of ['interact', 'drop', 'pause'] as const) offs.push(bindKey($(action), action));

  // MAP is a switch: the arrows turn the map while it is up, so both thumbs stay free.
  const map = $('map');
  on(map, 'pointerdown', (e) => {
    e.preventDefault();
    sendTouch('map', isMapHeld() ? 'keyup' : 'keydown');
    map.classList.toggle('lit', isMapHeld());
  });

  // TALK: hold to talk. With the mic not on yet it asks for it (a tap is a gesture, which
  // the browser needs); with an open mic it is the mute switch.
  const talk = $('talk');
  const talkIs = (): 'ask' | 'hold' | 'mute' => (state?.voice.mic !== 'on' ? 'ask' : state.voice.mode === 'push' ? 'hold' : 'mute');
  offs.push(bindKey(talk, () => (talkIs() === 'hold' ? 'talk' : null)));
  on(talk, 'click', () => {
    const is = talkIs();
    if (is === 'ask') actions.onEnableMic();
    else if (is === 'mute') {
      sendTouch('mute', 'keydown');
      sendTouch('mute', 'keyup');
    }
  });

  // HUD: the column as a panel over the game (compact only).
  const drawer = (open: boolean) => {
    if (open) releaseAll();
    cu.dataset.drawer = open ? 'on' : 'off';
    $('info').querySelector('span')!.textContent = open ? 'Close' : 'HUD';
    if (open) $('info').classList.remove('new');
  };
  const drawerOpen = () => cu.dataset.drawer === 'on';
  on($('info'), 'click', () => drawer(!drawerOpen()));

  // CHAT: a field at the top of the screen (the keyboard takes the bottom), and the four
  // quick lines as buttons, because typing on a phone in the middle of a puzzle is slow.
  const chatbox = $('chatbox');
  const field = $<HTMLInputElement>('field');
  function openChat(): void {
    releaseAll();
    drawer(false);
    chatbox.classList.add('on');
    field.focus(); // inside the tap, or iOS keeps the keyboard down
  }
  function closeChat(): void {
    if (!chatbox.classList.contains('on')) return;
    chatbox.classList.remove('on');
    field.value = '';
    field.blur();
  }
  const send = () => {
    if (field.value.trim()) actions.onSendChat(field.value);
    closeChat();
  };
  on($('chat'), 'click', openChat);
  on($('send'), 'click', send);
  on($('x'), 'click', closeChat);
  on(field, 'keydown', (e) => {
    const key = (e as KeyboardEvent).key;
    if (key === 'Enter') send();
    else if (key === 'Escape') closeChat();
    e.stopPropagation(); // typing is never a game key
  });
  QUICK_CHATS.forEach((_, i) => {
    on($(`quick${i + 1}`), 'click', () => {
      closeChat(); // the field lets go first: a key typed into it is not a game key
      const action = `quick${i + 1}` as TouchAction;
      sendTouch(action, 'keydown');
      sendTouch(action, 'keyup');
    });
  });
  on($('shade'), 'click', () => {
    closeChat();
    drawer(false);
  });
  // the chat log in the HUD panel opens the field too
  const log = cu.querySelector<HTMLElement>('.cu-chat');
  if (log) on(log, 'click', openChat);

  // ---------- the room code: letter keys beside the join popup ----------
  const code = $('code');
  on(window, CODEPAD_EVENT, (e) => code.classList.toggle('on', (e as CustomEvent<boolean>).detail === true));
  on(code, 'pointerdown', (e) => {
    const key = (e.target as HTMLElement).closest<HTMLElement>('[data-m^="key-"]');
    if (!key) return;
    e.preventDefault();
    key.classList.add('on');
    setTimeout(() => key.classList.remove('on'), 120);
    tapKey(key.dataset.m!.slice(4));
  });

  // ---------- what the HUD says, kept in sight on a phone ----------
  const pips = $('pips');
  pips.innerHTML = [1, 2, 3, 4, 5, 6].map((f) => `<i data-face="${f}"></i>`).join('');
  /** The last chat line already seen (null until the game's first frame), so only a new one from the partner pops up. */
  let seenChat: number | null = null;

  function render(s: UIState): void {
    const hud = s.hud;
    const set = settings();
    // TALK says what it will do
    const is = talkIs();
    talk.hidden = s.mode === 'ai' || !set.voiceOn;
    talk.querySelector('span')!.textContent = s.voice.mic === 'asking' ? '...' : is === 'ask' ? 'Mic' : is === 'hold' ? 'Talk' : s.voice.muted ? 'Muted' : 'Mute';
    talk.classList.toggle('warn', s.voice.mic === 'denied' || (is === 'mute' && s.voice.muted));
    talk.classList.toggle('lit', s.voice.mic === 'on' && s.voice.talking);
    talk.setAttribute('aria-label', is === 'ask' ? 'Enable the microphone' : is === 'hold' ? 'Hold to talk' : 'Mute the microphone');
    map.classList.toggle('lit', isMapHeld());
    $('drop').classList.toggle('idle', !hud?.carrying);
    if (!hud) return;

    const faceNo = $('faceno');
    faceNo.dataset.face = faceNo.textContent = String(hud.face);
    $('face').textContent = hud.faceName;
    $('clock').textContent = clock(hud.elapsedMs);
    const done = Math.min(hud.solved.length, hud.puzzleTotal);
    $('progn').textContent = `${done}/${hud.puzzleTotal}`;
    $('prog').classList.toggle('open', hud.portalOpen);
    $('portal').hidden = !hud.portalOpen;
    pips.querySelectorAll<HTMLElement>('i').forEach((pip, i) => {
      pip.classList.toggle('ok', hud.solved.includes((i + 1) as 1));
      pip.classList.toggle('here', hud.face === i + 1);
    });
    $('obj').textContent = hud.objective;
    const carry = $('carry');
    carry.hidden = !hud.carrying;
    if (hud.carrying) {
      const frame = ITEM_FRAMES[hud.carrying.kind] ?? ITEM_DEFAULT_FRAME;
      carry.querySelector<HTMLElement>('i')!.style.backgroundPosition = `calc(${-16 * frame}px * var(--u)) 0`;
      carry.querySelector('span')!.textContent = hud.carrying.kind;
    }

    // a new line from the partner, with the chat log folded away: show it on the view
    const lastLine = s.chat[s.chat.length - 1];
    if (seenChat === null) seenChat = lastLine?.id ?? -1;
    else if (lastLine && lastLine.id !== seenChat) {
      seenChat = lastLine.id;
      const theirs = lastLine.from !== s.side && !lastLine.isAI; // (the AI's lines are captioned already)
      if (theirs && cu.dataset.touch === 'compact' && !drawerOpen()) {
        showCaption(lastLine.text, { speaker: 'Partner' });
        $('info').classList.add('new');
      }
    }
  }

  const settingsOff = onSettings(() => state && render(state));
  drawer(false);
  relayout();

  return {
    update(next) {
      state = next;
      const playing = next.screen === 'game';
      html.toggleAttribute('data-dark', playing && next.side === 'in');
      if (!playing || next.hud?.won) {
        // out of the game (or it is over): nothing stays held or open
        releaseAll();
        closeChat();
        drawer(false);
        seenChat = null;
      }
      // in a lobby or in the game the join popup is gone, whatever it managed to say
      if (next.lobby || playing) code.classList.remove('on');
      if (!inGame()) return;
      render(next);
    },
    destroy() {
      releaseAll();
      settingsOff();
      for (const off of offs) off();
      layer.remove();
      style.remove();
      delete html.dataset.touch;
      html.removeAttribute('data-dark');
      delete cu.dataset.touch;
      delete cu.dataset.drawer;
    },
  };
}

/**
 * Wrap the UI so a touch screen gets the touch layer too. On a desktop this returns the
 * UI's own handle untouched.
 */
export function withMobile(host: UIHost): UIHost {
  return {
    mount(root: HTMLElement, actions: UIActions): UIHandle {
      const handle = host.mount(root, actions);
      const cu = root.querySelector<HTMLElement>('.cu');
      if (!cu || !device().touch) return handle;
      const mobile = mountMobile(cu, actions);
      window.dispatchEvent(new Event('resize')); // the UI lays out again now that the touch layout is known
      return {
        update(state) {
          handle.update(state);
          mobile.update(state);
        },
        destroy() {
          mobile.destroy();
          handle.destroy();
        },
      };
    },
  };
}

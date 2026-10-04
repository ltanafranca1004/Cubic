import { FACE_SIZE, NO_SIGNALS, TILE_PX, type FaceId, type SignalView } from '@cubic/shared';
import { cubeMap } from '../cube/api';
import { mountGamepad } from '../input/gamepad';
import { isMapHeld, setMapHeld } from '../input/gate';
import { gameAction } from '../input/keymap';
import { createStage, type Stage } from '../scenes/stage';
import { ITEM_DEFAULT_FRAME, ITEM_FRAMES, asset } from '../style/assets';
import { uiScale } from '../style/scale';
import { bindSettings, onSettings, setSetting, settings } from '../style/settings';
import { netCellLabel, textScale } from './a11y';
import { caption, onCaption, onPartnerSpeaking, partnerSpeaking, type Caption } from './captions';
import { CSS } from './css';
import { focusFirst, modalKey, topModal } from './focus';
import type { EdgeLabel, HudState, UIActions, UIHandle, UIHost, UIState } from './hooks';
import { createPauseMenu } from './pauseMenu';
import { createSettingsPanel } from './settingsPanel';

// THE UI. A full-window Phaser stage draws the menus (scenes/); this file is the DOM on
// top of it: the top bar (room code, settings gear) that is the same on every screen, and
// the in-game HUD, chat, voice controls and win screen around the game canvas.
//
// It also owns the keys that are not movement: Esc (pause, back out of a panel), Enter
// (chat), Q, F, 1 to 4, M and Tab in game, and the focus inside every DOM panel. What a
// key means is decided in input/keymap.ts; this file only acts on the answer.

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** The cube unfolded: grid position (column, row) of each face in the HUD's little net. */
const NET_CELL: Record<FaceId, [number, number]> = { 5: [2, 1], 4: [1, 2], 1: [2, 2], 2: [3, 2], 3: [4, 2], 6: [2, 3] };

const HTML = `
<div class="cu-stage" id="cu-stage"></div>
<header class="cu-top">
  <div class="cu-top-side"><button class="cu-btn light" id="cu-leave" hidden><span>Leave</span></button></div>
  <div class="cu-room" id="cu-room" hidden><span class="k" id="cu-room-k">Room</span><span class="v" id="cu-room-v"></span></div>
  <div class="cu-top-side r"><button class="cu-gear" id="cu-gear" aria-label="Settings" title="Settings"></button></div>
</header>
<div class="cu-banner" id="cu-banner" hidden><span></span></div>
<main class="cu-hud" id="cu-hud">
  <section class="cu-col">
    <div class="cu-panel">
      <div class="cu-you"><i class="cu-hero"></i><b id="cu-side"></b></div>
      <div class="cu-rule"></div>
      <div class="cu-where"><span class="cu-dim" id="cu-faceno"></span><b id="cu-face"></b></div>
      <div class="cu-drift"><i class="cu-compass" id="cu-compass"></i><span class="cu-dim">Drift</span><span id="cu-drift"></span></div>
      <div class="cu-net" id="cu-net"></div>
    </div>
    <div class="cu-panel">
      <p class="cu-obj" id="cu-obj"></p>
      <div class="cu-carry" id="cu-carry"></div>
    </div>
  </section>
  <section class="cu-mid">
    <div class="cu-edge t" id="cu-et"></div>
    <div class="cu-edge l" id="cu-el"></div>
    <div class="cu-view" id="cu-view"><div class="cu-over" id="cu-over"></div></div>
    <div class="cu-edge r" id="cu-er"></div>
    <div class="cu-edge b" id="cu-eb"></div>
    <div class="cu-keys">E pick up &nbsp; Q drop &nbsp; F ping &nbsp; Esc menu</div>
  </section>
  <section class="cu-col">
    <div class="cu-panel cu-stats">
      <div><i class="cu-ico clock"></i><span id="cu-clock">0:00</span></div>
      <div class="x"><i class="cu-ico cross"></i><span id="cu-strikes">0</span></div>
    </div>
    <div class="cu-panel cu-voice" id="cu-voice"></div>
    <div class="cu-panel cu-chat">
      <div class="cu-log" id="cu-log" aria-live="polite"></div>
      <input class="cu-field" id="cu-chat" maxlength="200" placeholder="Enter to chat" autocomplete="off" aria-label="Chat message" />
    </div>
  </section>
</main>
<div class="cu-subs">
  <div class="cu-speaking" id="cu-speaking" role="status" hidden><i class="cu-ico speaker"></i><span></span></div>
  <div class="cu-caption" id="cu-caption" role="status" aria-live="polite" hidden><b></b><span></span></div>
</div>
<div class="cu-modal" id="cu-win"><div class="cu-panel cu-win" role="dialog" aria-label="You escaped">
  <h2>The cube opens</h2><p id="cu-wintxt"></p>
  <div class="cu-actions"><button class="cu-btn light" id="cu-winleave"><span>Leave</span></button><button class="cu-btn in" id="cu-again" data-first><span>Play again</span></button></div>
</div></div>`;

export const cubicUI: UIHost = {
  mount(root: HTMLElement, actions: UIActions): UIHandle {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const el = document.createElement('div');
    el.className = 'cu';
    el.dataset.screen = 'menu';
    el.innerHTML = HTML;
    root.appendChild(el);
    const $ = <T extends HTMLElement = HTMLElement>(id: string) => el.querySelector<T>(`#${id}`)!;

    // One pixel grid: the DOM follows the same whole-number scale as the canvases.
    const rescale = () => {
      const u = uiScale();
      const s = settings();
      el.style.setProperty('--u', String(u));
      el.style.setProperty('--cursor', `url("${asset(`ui/cursor-${Math.min(4, u)}.png`)}") 0 0`);
      // accessibility settings that are looks: reading text size, contrast, less motion
      el.style.setProperty('--tu', String(textScale(u, s.textSize)));
      el.dataset.contrast = s.highContrast ? 'high' : 'normal';
      el.dataset.motion = s.reduceMotion ? 'reduce' : 'full';
    };
    rescale();
    window.addEventListener('resize', rescale);
    const lookOff = onSettings(rescale);

    // The game canvas lives inside the HUD's frame.
    const game = root.querySelector<HTMLElement>('#game');
    if (game) $('cu-view').appendChild(game);

    let state: UIState | null = null;
    let stage: Stage | null = null;

    // Voice settings go to the existing Voice class through the actions.
    bindSettings({
      setVolume: (v) => actions.onSetPartnerVolume(v),
      setMuted: (m) => actions.onSetMuted(m),
      setMode: (mode) => actions.onSetMicMode(mode === 'ptt' ? 'push' : 'open'),
    });
    const inGame = () => el.dataset.screen === 'game';
    /** The settings were opened from the pause menu: closing them goes back to it. */
    let fromPause = false;
    // (the pause menu is made first so the settings panel, made after it, opens on top)
    const pause = createPauseMenu(el, {
      settings: () => {
        fromPause = true;
        pause.close();
        panel.toggle(true);
      },
      leave: () => actions.onLeaveRoom(),
    });
    const panel = createSettingsPanel(el);
    const settingsEl = $('cu-settings');
    $('cu-gear').addEventListener('click', () => panel.toggle());
    const gearOff = panel.onToggle((open) => {
      $('cu-gear').classList.toggle('on', open);
      if (open) focusFirst(settingsEl);
      else if (fromPause && inGame()) {
        pause.open();
        focusFirst(pause.el);
      } else (document.activeElement as HTMLElement | null)?.blur?.(); // the keys go back to the screen underneath
      if (!open) fromPause = false;
    });
    const releaseMap = () => {
      if (!isMapHeld()) return;
      setMapHeld(false);
      cubeMap.hide();
    };

    $('cu-leave').addEventListener('click', () => actions.onLeaveRoom());
    $('cu-winleave').addEventListener('click', () => actions.onLeaveRoom());
    $('cu-again').addEventListener('click', () => actions.onPlayAgain());
    $('cu-room').addEventListener('click', () => {
      if (state?.roomCode) void navigator.clipboard?.writeText(state.roomCode).catch(() => {});
    });

    const chat = $<HTMLInputElement>('cu-chat');
    chat.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (chat.value.trim()) actions.onSendChat(chat.value);
        chat.value = '';
      } else if (e.key === 'Escape') chat.blur();
      e.stopPropagation();
    });
    const isTyping = () => document.activeElement instanceof HTMLInputElement;
    /** A key used here is used up: not also Back, Play or a step on the screen underneath. */
    const eat = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    // Capture phase: panels and Esc are decided here, before any scene sees the key.
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const modal = topModal(el);
      if (modal) {
        if (e.key === 'Escape') {
          // settings: close (back to the pause menu if it came from there). pause: resume.
          // The win screen has no back: pick Leave or Play again.
          if (panel.isOpen()) panel.toggle(false);
          else if (pause.isOpen()) pause.close();
          eat(e);
        } else if (modalKey(modal, e)) eat(e);
        return;
      }
      const active = document.activeElement;
      if (active instanceof HTMLButtonElement && el.contains(active)) {
        // Tab put the focus on a button of the top bar (the gear): Enter and Space press it.
        if (e.key === 'Tab') return;
        if (e.key === 'Enter' || e.key === ' ') {
          active.click();
          eat(e);
          return;
        }
        active.blur(); // any other key goes back to the screen
        if (e.key === 'Escape') {
          eat(e);
          return;
        }
      }
      if (!inGame() || isTyping()) return; // the chat field has its own keys
      const action = gameAction(e);
      if (action?.type === 'chat') {
        e.preventDefault();
        releaseMap();
        chat.focus();
      } else if (action?.type === 'pause') {
        releaseMap();
        pause.open();
        focusFirst(pause.el);
        eat(e);
      }
    };
    /** Space clicks a button on key UP in some browsers: a panel already used that press. */
    const onKeyUpCapture = (e: KeyboardEvent) => {
      if (e.key === ' ' && topModal(el)) e.preventDefault();
    };
    // Bubble phase: the in-game keys that are not movement. The dev tools (?dev) take
    // their own keys (1 to 6, Tab in hot-seat) in the capture phase, so those never get here.
    const onGameKey = (e: KeyboardEvent) => {
      if (!inGame() || topModal(el) || isTyping()) return;
      const action = gameAction(e);
      switch (action?.type) {
        case 'map':
          e.preventDefault(); // Tab must not walk the browser's focus away
          if (!isMapHeld()) {
            setMapHeld(true);
            cubeMap.show();
          }
          break;
        case 'move':
          if (isMapHeld()) cubeMap.rotate(action.dir); // while the map is up the arrows turn it
          break;
        case 'drop':
          actions.onDrop();
          break;
        case 'ping':
          actions.onPing();
          break;
        case 'quick':
          actions.onQuickChat(action.index);
          break;
        case 'mute':
          setSetting('micMuted', !settings().micMuted);
          break;
      }
    };
    const onGameKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Tab') releaseMap();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKeyUpCapture, true);
    window.addEventListener('keydown', onGameKey);
    window.addEventListener('keyup', onGameKeyUp);
    window.addEventListener('blur', releaseMap);
    const padOff = mountGamepad({ where: () => (inGame() && !topModal(el) && !isTyping() ? 'game' : 'menu') });

    // Captions and the "Partner speaking" tag (ui/captions.ts is the store).
    const renderCaption = (c: Caption | null) => {
      const node = $('cu-caption');
      node.hidden = !c;
      node.querySelector('b')!.textContent = c?.speaker ? `${c.speaker}: ` : '';
      node.querySelector('span')!.textContent = c?.text ?? '';
    };
    const renderSpeaking = () => {
      const on = partnerSpeaking() && inGame();
      $('cu-speaking').hidden = !on;
      $('cu-speaking').querySelector('span')!.textContent = state?.mode === 'ai' ? 'AI partner speaking' : 'Partner speaking';
    };
    const captionOff = onCaption(renderCaption);
    const speakingOff = onPartnerSpeaking(renderSpeaking);
    renderCaption(caption());

    // Ping markers and quick-chat bubbles: DOM on the same pixel grid, over the game canvas.
    const over = $('cu-over');
    const marks = new Map<string, HTMLElement>();
    const px = (n: number) => `calc(${n}px * var(--u))`;
    function renderSignals(view: SignalView): void {
      const want = new Set<string>();
      const mark = (key: string, cls: string): HTMLElement => {
        want.add(key);
        let node = marks.get(key);
        if (!node) {
          node = document.createElement('div');
          marks.set(key, node);
          over.append(node);
        }
        node.className = cls;
        return node;
      };
      for (const p of view.pings) {
        const node = mark(`p${p.id}`, `cu-ping ${p.mine ? 'mine' : 'theirs'}`);
        node.style.left = px(p.sx * TILE_PX);
        node.style.top = px(p.sy * TILE_PX);
        node.style.opacity = String(Math.ceil(p.alpha * 4) / 4); // it fades in four steps
        node.title = p.mine ? 'Your ping' : "Your partner's ping";
        if (!node.firstChild) node.append(document.createElement('i'));
      }
      for (const b of view.bubbles) {
        const node = mark(`b${b.id}`, `cu-bubble ${b.mine ? 'mine' : 'theirs'}${b.sy === 0 ? ' under' : ''}`);
        // over the head; under the feet on the top row, and kept off the side edges
        node.style.left = px(Math.min(FACE_SIZE - 1.5, Math.max(1.5, b.sx + 0.5)) * TILE_PX);
        node.style.top = px((b.sy === 0 ? b.sy + 1 : b.sy) * TILE_PX);
        node.textContent = b.text;
      }
      for (const [key, node] of marks) {
        if (want.has(key)) continue;
        node.remove();
        marks.delete(key);
      }
    }

    // Voice controls: rebuilt only when what they show changes.
    const voice = $('cu-voice');
    voice.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'mic') actions.onEnableMic();
      if (act === 'mute') setSetting('micMuted', !settings().micMuted);
      if (act === 'mode') setSetting('micMode', settings().micMode === 'ptt' ? 'open' : 'ptt');
    });
    const settingsOff = onSettings(() => state && renderVoice(state));

    let voiceSig = '';
    let chatSig = '';
    let netSig = '';

    function renderVoice(s: UIState): void {
      const v = s.voice;
      const set = settings();
      const sig = [v.mic, v.mode, v.muted, s.mode, set.voiceOn, set.micMuted, set.micMode].join('|');
      if (sig !== voiceSig) {
        voiceSig = sig;
        const controls = !set.voiceOn
          ? `<div class="cu-note">Proximity chat is off. Turn it on in the settings.</div>`
          : v.mic === 'on'
            ? `<div class="cu-vbtns">
                 <button class="cu-btn ${set.micMuted ? 'danger' : 'light'}" data-act="mute"><i class="cu-ico ${set.micMuted ? 'micOff' : 'mic'}"></i><span>${set.micMuted ? 'Muted' : 'Mute'}</span></button>
                 <button class="cu-btn light" data-act="mode"><span>${v.mode === 'push' ? 'Hold V' : 'Open mic'}</span></button>
               </div>`
            : v.mic === 'denied'
              ? `<div class="cu-warn">Microphone blocked. Allow it for this site (the lock icon in the address bar), then try again. Chat still works.</div>
                 <div class="cu-vbtns"><button class="cu-btn in" data-act="mic"><i class="cu-ico mic"></i><span>Try again</span></button></div>`
              : `<div class="cu-note">Cubic is played by voice. You hear each other through the wall.</div>
                 <div class="cu-vbtns"><button class="cu-btn in" data-act="mic"><i class="cu-ico mic"></i><span>${v.mic === 'asking' ? 'Waiting...' : 'Enable mic'}</span></button></div>`;
        voice.innerHTML = `
          <div class="cu-vrow"><i class="cu-dot" id="cu-me"></i><span>You</span><span class="cu-dim" id="cu-link"></span></div>
          <div class="cu-vrow"><i class="cu-dot" id="cu-them"></i><span>${s.mode === 'ai' ? 'AI partner' : 'Partner'}</span><i class="cu-signal" id="cu-signal"></i></div>
          ${s.mode === 'ai' ? `<div class="cu-note">The AI speaks. You type to it.</div>` : controls}`;
      }
      voice.querySelector('#cu-me')?.classList.toggle('on', v.talking);
      voice.querySelector('#cu-them')?.classList.toggle('on', v.partnerLevel > 0.08);
      const bars = voice.querySelector<HTMLElement>('#cu-signal');
      if (bars) bars.style.backgroundPosition = `calc(${-16 * v.signal}px * var(--u)) 0`;
      const link = voice.querySelector('#cu-link');
      // the dot's colour is never the only sign: the words say it too
      if (link) link.textContent = v.mic !== 'on' ? '' : v.muted ? 'muted' : v.talking ? 'talking' : v.link === 'relay' ? 'relayed' : v.link === 'connecting' ? 'connecting' : v.mode === 'push' ? 'hold V' : 'open';
    }

    function renderEdge(id: string, e: EdgeLabel): void {
      const node = $(id);
      const text = `${e.face} ${e.name}`;
      if (node.dataset.t !== text + e.solved) {
        node.dataset.t = text + e.solved;
        node.className = `cu-edge ${id.slice(-1)}${e.solved ? ' done' : ''}`;
        // a solved face has a tick as well as its colour
        node.innerHTML = `<i style="--c: var(--face-${e.face})"></i><span></span>${e.solved ? '<b class="cu-tick" title="solved"></b>' : ''}`;
        node.querySelector('span')!.textContent = text;
      }
    }

    function renderHud(s: UIState, hud: HudState): void {
      $('cu-side').textContent = s.side === 'in' ? 'Inside' : 'Outside';
      $('cu-faceno').textContent = `Face ${hud.face}`;
      $('cu-face').textContent = hud.faceName;
      $('cu-drift').textContent = `${hud.drift}`;
      $('cu-compass').style.transform = `rotate(${hud.drift}deg)`;
      renderEdge('cu-et', hud.edges.up);
      renderEdge('cu-eb', hud.edges.down);
      renderEdge('cu-el', hud.edges.left);
      renderEdge('cu-er', hud.edges.right);
      $('cu-obj').textContent = hud.objective;
      const carry = $('cu-carry');
      const carrySig = hud.carrying?.kind ?? '';
      if (carry.dataset.t !== carrySig) {
        carry.dataset.t = carrySig;
        const frame = ITEM_FRAMES[carrySig] ?? ITEM_DEFAULT_FRAME;
        carry.innerHTML = hud.carrying ? `<i class="cu-item" style="background-position: calc(${-16 * frame}px * var(--u)) 0"></i><span></span><span class="cu-dim">Q to drop</span>` : `<i class="cu-ico hand"></i><span class="cu-dim">Empty hands</span>`;
        if (hud.carrying) carry.querySelector('span')!.textContent = hud.carrying.kind;
      }
      // progress: the cube unfolded. A solved face takes its biome colour.
      const sig = `${hud.solved.join('')}|${hud.face}|${hud.portalOpen}`;
      if (sig !== netSig) {
        netSig = sig;
        $('cu-net').innerHTML = ([1, 2, 3, 4, 5, 6] as FaceId[])
          .map((n) => {
            const [col, row] = NET_CELL[n];
            const cell = { solved: hud.solved.includes(n), here: n === hud.face, portal: n === 6 && hud.portalOpen };
            const cls = [cell.solved ? 'ok' : '', cell.here ? 'here' : '', cell.portal ? 'portal' : ''].join(' ');
            // every state has a shape as well as a colour: tick = solved, pip = you, ring = portal
            const shapes = `${cell.solved ? '<i class="cu-tick"></i>' : ''}${cell.here ? '<i class="cu-pip"></i>' : ''}${cell.portal ? '<i class="cu-ring"></i>' : ''}`;
            const label = netCellLabel(n, cell);
            return `<div class="${cls}" style="grid-column:${col};grid-row:${row};--c:var(--face-${n})" title="${label}" aria-label="${label}"><span>${n}</span>${shapes}</div>`;
          })
          .join('');
      }
      $('cu-clock').textContent = clock(hud.elapsedMs);
      $('cu-strikes').textContent = String(hud.strikes);
      $('cu-wintxt').textContent = `Escaped in ${clock(hud.elapsedMs)} with ${hud.strikes} strike${hud.strikes === 1 ? '' : 's'}.`;
    }

    function renderChat(s: UIState): void {
      const sig = `${s.chat.length}:${s.chat[s.chat.length - 1]?.id ?? 0}:${s.partnerTyping}`;
      if (sig === chatSig) return;
      chatSig = sig;
      const log = $('cu-log');
      log.replaceChildren(
        ...s.chat.map((m) => {
          const row = document.createElement('div');
          row.className = m.isAI ? 'ai' : m.from;
          const who = document.createElement('b');
          who.textContent = m.isAI ? 'AI ' : m.from === s.side ? 'You ' : 'Partner ';
          row.append(who, m.text);
          return row;
        }),
      );
      if (s.partnerTyping) {
        const t = document.createElement('div');
        t.className = 'typing';
        t.textContent = 'Partner is thinking...';
        log.append(t);
      }
      log.scrollTop = log.scrollHeight;
    }

    return {
      update(next: UIState) {
        state = next;
        // The stage needs a first state to pick its first screen, so it starts here.
        stage ??= createStage($('cu-stage'), actions, next);
        stage.update(next);

        const inGame = next.screen === 'game';
        el.dataset.screen = inGame ? 'game' : 'menu';
        if (!inGame) {
          // out of the game: nothing of it stays open or held
          fromPause = false;
          pause.close();
          releaseMap();
        }
        el.dataset.side = inGame ? (next.side ?? 'out') : 'out';

        // top bar: the room code from the lobby on, in the same place on every screen
        const inRoom = !!next.roomCode && (inGame || !!next.lobby);
        $('cu-room').hidden = !inRoom;
        if (inRoom) {
          $('cu-room-k').textContent = next.mode === 'ai' ? 'Solo' : 'Room';
          $('cu-room-v').textContent = next.mode === 'ai' ? 'AI' : (next.roomCode ?? '');
        }
        $('cu-leave').hidden = !inGame;

        const hud = next.hud;
        const banner = !inGame ? '' : !next.online ? 'Connection lost. Reconnecting...' : next.status === 'partner-left' ? 'Partner left. Holding their seat...' : '';
        $('cu-banner').hidden = !banner;
        $('cu-banner').firstElementChild!.textContent = banner;
        const won = inGame && !!hud?.won;
        const win = $('cu-win');
        if (won !== win.classList.contains('on')) {
          win.classList.toggle('on', won);
          if (won) {
            // the win screen takes over: close what was open and give it the focus
            fromPause = false;
            pause.close();
            panel.toggle(false);
            releaseMap();
            focusFirst(win);
          }
        }
        renderSpeaking();
        renderSignals(inGame ? (next.signals ?? NO_SIGNALS) : NO_SIGNALS);
        if (!inGame || !hud) return;
        renderHud(next, hud);
        renderChat(next);
        renderVoice(next);
      },
      destroy() {
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('keyup', onKeyUpCapture, true);
        window.removeEventListener('keydown', onGameKey);
        window.removeEventListener('keyup', onGameKeyUp);
        window.removeEventListener('blur', releaseMap);
        padOff();
        captionOff();
        speakingOff();
        lookOff();
        releaseMap();
        pause.destroy();
        window.removeEventListener('resize', rescale);
        gearOff();
        settingsOff();
        panel.destroy();
        stage?.destroy();
        el.remove();
        style.remove();
      },
    };
  },
};

import type { Side } from '@cubic/shared';
import type { UIActions, UIHandle, UIHost, UIState } from '../ui/hooks';
import { CSS } from './styles';

// Placeholder UI (core team): lobby, HUD, chat, voice controls and win screen in plain
// DOM. It is the reference implementation of UIHost; the real UI goes in /client/src/ui.

const STATUS: Record<UIState['status'], string> = {
  idle: '',
  connecting: 'Connecting...',
  waiting: 'Waiting for your partner. Share the code.',
  'partner-joined': 'Partner joined.',
  'partner-left': 'Partner left. Holding their seat...',
};

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const HTML = `
<section class="pu pu-lobby" id="pu-lobby">
  <h1 class="pu-logo"><span>CUB</span><span>IC</span></h1>
  <p>Two players, one cube. One outside, one trapped inside.</p>
  <div class="pu-card" id="pu-menu">
    <button id="pu-create">Create room</button>
    <form class="pu-row" id="pu-join"><input id="pu-codein" maxlength="4" placeholder="CODE" autocomplete="off" aria-label="Room code" /><button>Join room</button></form>
    <div class="pu-row"><button id="pu-ai-out" disabled>Play with AI: outside</button><button id="pu-ai-in" disabled>Play with AI: inside</button></div>
    <small id="pu-ai-note">Play with AI is not available on this server yet.</small>
  </div>
  <div class="pu-card" id="pu-wait">
    <div>Room code</div><div class="pu-code" id="pu-code"></div>
    <div>You are <b id="pu-you"></b>.</div>
    <button id="pu-cancel">Leave room</button>
  </div>
  <p class="pu-status" id="pu-status"></p>
  <p class="pu-err" id="pu-err"></p>
</section>
<section class="pu pu-game" id="pu-game">
  <div class="pu-banner" id="pu-banner" hidden></div>
  <header>
    <h1 class="pu-logo"><span>CUB</span><span>IC</span></h1>
    <div class="pu-prog" id="pu-prog"></div>
    <div class="pu-stats"><span id="pu-clock">0:00</span><span class="x" id="pu-strikes">Strikes 0</span><span id="pu-room"></span><button id="pu-leave">Leave</button></div>
  </header>
  <div class="pu-main">
    <div class="pu-panel" id="pu-panel">
      <div class="pu-ph"><h2 id="pu-sidename"></h2><span id="pu-where"></span><span id="pu-drift"></span></div>
      <div class="pu-stage" id="pu-stage">
        <div class="pu-edge pu-et" id="pu-et"></div><div class="pu-edge pu-el" id="pu-el"></div>
        <div class="pu-edge pu-er" id="pu-er"></div><div class="pu-edge pu-eb" id="pu-eb"></div>
      </div>
      <p class="pu-obj" id="pu-obj"></p>
      <div class="pu-carry" id="pu-carry"></div>
      <div class="pu-keys">Move: WASD or arrows &nbsp; E: pick up / drop &nbsp; Enter: chat &nbsp; V: talk</div>
    </div>
    <div class="pu-side">
      <div class="pu-box pu-voice" id="pu-voice"></div>
      <div class="pu-box"><h3>Chat</h3><div class="pu-log" id="pu-log" aria-live="polite"></div>
        <input id="pu-chat" maxlength="200" placeholder="Enter to type, Esc to close" autocomplete="off" aria-label="Chat message" /></div>
    </div>
  </div>
</section>
<div class="pu-win" id="pu-win"><div class="card"><h2>The cube opens</h2><p id="pu-wintxt"></p><button id="pu-again">Play again</button></div></div>`;

export const placeholderUI: UIHost = {
  mount(root: HTMLElement, actions: UIActions): UIHandle {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const el = document.createElement('div');
    el.innerHTML = HTML;
    root.appendChild(el);
    const $ = <T extends HTMLElement = HTMLElement>(id: string) => el.querySelector<T>(`#${id}`)!;

    // The Phaser canvas sits in the middle of the stage, between the edge labels.
    const game = root.querySelector<HTMLElement>('#game');
    if (game) $('pu-stage').appendChild(game);

    $('pu-create').addEventListener('click', () => actions.onCreateRoom());
    $('pu-join').addEventListener('submit', (e) => {
      e.preventDefault();
      actions.onJoinRoom($<HTMLInputElement>('pu-codein').value);
    });
    $('pu-ai-out').addEventListener('click', () => actions.onPlayWithAI('out'));
    $('pu-ai-in').addEventListener('click', () => actions.onPlayWithAI('in'));
    $('pu-cancel').addEventListener('click', () => actions.onLeaveRoom());
    $('pu-leave').addEventListener('click', () => actions.onLeaveRoom());
    $('pu-again').addEventListener('click', () => actions.onPlayAgain());

    const chat = $<HTMLInputElement>('pu-chat');
    chat.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (chat.value.trim()) actions.onSendChat(chat.value);
        chat.value = '';
      } else if (e.key === 'Escape') chat.blur();
      e.stopPropagation();
    });
    const onKey = (e: KeyboardEvent) => {
      const typing = document.activeElement instanceof HTMLInputElement;
      if (e.key === 'Enter' && !typing && $('pu-game').classList.contains('on')) {
        e.preventDefault();
        chat.focus();
      }
    };
    window.addEventListener('keydown', onKey);

    // Voice controls are rebuilt only when their inputs change (they hold a slider).
    const voice = $('pu-voice');
    voice.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).dataset.act;
      if (act === 'mic') actions.onEnableMic();
      if (act === 'mute') actions.onSetMuted(true);
      if (act === 'unmute') actions.onSetMuted(false);
      if (act === 'open') actions.onSetMicMode('open');
      if (act === 'push') actions.onSetMicMode('push');
    });
    voice.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.act === 'vol') actions.onSetPartnerVolume(Number(t.value) / 100);
    });

    let chatSig = '';
    let voiceSig = '';
    const sideName = (s: Side | null) => (s === 'in' ? 'Inside' : 'Outside');

    function renderVoice(state: UIState) {
      const v = state.voice;
      const sig = [v.mic, v.mode, v.muted, v.link, state.mode].join('|');
      if (sig !== voiceSig) {
        voiceSig = sig;
        const controls =
          v.mic === 'on'
            ? `<div class="pu-row" style="justify-content:flex-start">
                 <button data-act="${v.muted ? 'unmute' : 'mute'}">${v.muted ? 'Unmute' : 'Mute'}</button>
                 <button data-act="${v.mode === 'push' ? 'open' : 'push'}">${v.mode === 'push' ? 'Hold V to talk' : 'Open mic'}</button>
               </div>`
            : v.mic === 'denied'
              ? `<div class="pu-warn">Microphone blocked. Click the lock/camera icon in the address bar, allow the microphone for this site, then press Enable again. You can still use chat.</div><button data-act="mic">Enable microphone</button>`
              : `<div>Cubic is played by voice. Allow the microphone to talk to your partner through the wall.</div><button data-act="mic">${v.mic === 'asking' ? 'Waiting for permission...' : 'Enable microphone'}</button>`;
        voice.innerHTML = `<h3>Voice ${state.mode === 'ai' ? '(AI partner speaks, you type)' : ''}</h3>
          <div><span class="pu-dot" id="pu-me"></span>You <span id="pu-linktxt" style="opacity:.6"></span></div>
          <div><span class="pu-dot" id="pu-them"></span>Partner <span class="pu-bars" id="pu-bars"><i></i><i></i><i></i></span></div>
          ${controls}
          <label>Partner volume <input type="range" min="0" max="100" value="${Math.round(v.partnerVolume * 100)}" data-act="vol" /></label>`;
      }
      // cheap per-update bits
      voice.querySelector('#pu-me')?.classList.toggle('on', v.talking);
      voice.querySelector('#pu-them')?.classList.toggle('on', v.partnerLevel > 0.08);
      voice.querySelectorAll('#pu-bars i').forEach((bar, i) => bar.classList.toggle('on', i < v.signal));
      const link = voice.querySelector('#pu-linktxt');
      if (link) link.textContent = v.mic !== 'on' ? '' : v.muted ? '(muted)' : v.link === 'relay' ? '(relayed)' : v.link === 'connecting' ? '(connecting...)' : '';
    }

    return {
      update(state: UIState) {
        const inGame = state.screen === 'game';
        $('pu-lobby').classList.toggle('on', !inGame);
        $('pu-game').classList.toggle('on', inGame);

        // lobby
        const seated = !!state.roomCode && !!state.side;
        $('pu-menu').style.display = seated ? 'none' : '';
        $('pu-wait').style.display = seated ? '' : 'none';
        $('pu-code').textContent = state.roomCode ?? '';
        $('pu-you').textContent = sideName(state.side).toUpperCase();
        $('pu-status').textContent = state.online ? STATUS[state.status] : 'Cannot reach the server. Retrying...';
        $('pu-err').textContent = state.error ?? '';
        const busy = state.status === 'connecting' || !state.online;
        $<HTMLButtonElement>('pu-create').disabled = busy;
        $<HTMLButtonElement>('pu-ai-out').disabled = busy || !state.aiAvailable;
        $<HTMLButtonElement>('pu-ai-in').disabled = busy || !state.aiAvailable;
        $('pu-ai-note').style.display = state.aiAvailable ? 'none' : '';

        // game
        const hud = state.hud;
        $('pu-win').classList.toggle('on', !!hud?.won);
        if (!inGame || !hud) return;
        const banner = !state.online ? 'Connection lost. Reconnecting...' : state.status === 'partner-left' ? STATUS['partner-left'] : '';
        $('pu-banner').hidden = !banner;
        $('pu-banner').textContent = banner;
        $('pu-panel').className = `pu-panel ${state.side}`;
        $('pu-sidename').textContent = sideName(state.side);
        $('pu-where').textContent = `Face ${hud.face}: ${hud.faceName}`;
        $('pu-drift').textContent = `Compass drift ${hud.drift}°`;
        const edge = (e: UIState['hud'] & object, k: 'up' | 'down' | 'left' | 'right') => `${e.edges[k].face} ${e.edges[k].name}${e.edges[k].solved ? ' ✓' : ''}`;
        $('pu-et').textContent = `▲ ${edge(hud, 'up')}`;
        $('pu-eb').textContent = `▼ ${edge(hud, 'down')}`;
        $('pu-el').textContent = `◀ ${edge(hud, 'left')}`;
        $('pu-er').textContent = `${edge(hud, 'right')} ▶`;
        $('pu-obj').textContent = hud.objective;
        $('pu-carry').textContent = hud.carrying ? `Carrying: ${hud.carrying.kind} (E to drop)` : '';
        $('pu-prog').innerHTML = [1, 2, 3, 4, 5, 6]
          .map((n) => `<div class="${hud.solved.includes(n as 1) ? 'ok' : ''} ${n === hud.face ? 'here' : ''} ${n === 6 && hud.portalOpen ? 'portal' : ''}">${n}</div>`)
          .join('');
        $('pu-clock').textContent = clock(hud.elapsedMs);
        $('pu-strikes').textContent = `Strikes ${hud.strikes}`;
        $('pu-room').textContent = state.roomCode && state.mode === 'friend' ? `Room ${state.roomCode}` : '';
        $('pu-wintxt').textContent = `Escaped in ${clock(hud.elapsedMs)} with ${hud.strikes} strike${hud.strikes === 1 ? '' : 's'}.`;

        const sig = `${state.chat.length}:${state.chat[state.chat.length - 1]?.id ?? 0}:${state.partnerTyping}`;
        if (sig !== chatSig) {
          chatSig = sig;
          const log = $('pu-log');
          log.replaceChildren(
            ...state.chat.map((m) => {
              const row = document.createElement('div');
              row.className = m.isAI ? 'ai' : m.from;
              const who = document.createElement('b');
              who.textContent = m.isAI ? 'AI ' : m.from === state.side ? 'You ' : 'Partner ';
              row.append(who, m.text);
              return row;
            }),
          );
          if (state.partnerTyping) {
            const t = document.createElement('div');
            t.className = 'typing';
            t.textContent = 'Partner is typing...';
            log.append(t);
          }
          log.scrollTop = log.scrollHeight;
        }
        renderVoice(state);
      },
      destroy() {
        window.removeEventListener('keydown', onKey);
        el.remove();
        style.remove();
      },
    };
  },
};

import { FACE_NAMES, STEP_MS, compassDrift, devSolve, devTeleport, voiceMix, type DevCommand, type FaceId, type Side } from '@cubic/shared';
import { devHooks } from '../app';
import { HotSeat } from './hotseat';

// Developer tools, loaded only with ?dev in the URL (one dynamic import in main.ts).
//   `            show / hide the overlay
//   1 to 6       teleport the shown player to that face; with Shift, the INSIDE player
//   Solve        force the puzzle on the shown player's face to solved
//   Hot-seat     this window plays both seats of one real room: WASD + E = outside,
//                arrows + . = inside, Tab switches which side is drawn
// Teleport and solve are done by the server (DEV_COMMANDS=1), never by the client alone.

const REPEAT_MS = STEP_MS;
const PING_MS = 1000;

const MOVES: Record<string, [Side, number, number]> = {
  w: ['out', 0, -1],
  a: ['out', -1, 0],
  s: ['out', 0, 1],
  d: ['out', 1, 0],
  arrowup: ['in', 0, -1],
  arrowleft: ['in', -1, 0],
  arrowdown: ['in', 0, 1],
  arrowright: ['in', 1, 0],
};
const INTERACT: Record<string, Side> = { e: 'out', '.': 'in' };

const CSS = `
#cubic-dev { position: fixed; bottom: 8px; left: 8px; z-index: 9999; min-width: 230px; padding: 8px 10px;
  font: 11px/1.5 ui-monospace, Menlo, Consolas, monospace; color: #E8E6DF; background: rgba(5, 7, 13, 0.9);
  border: 1px solid #F2C14E; }
#cubic-dev[hidden] { display: none; }
#cubic-dev .hd { color: #F2C14E; font-weight: 700; letter-spacing: 0.08em; }
#cubic-dev .row { display: flex; gap: 8px; }
#cubic-dev .row b { width: 44px; color: #8A93A6; font-weight: 400; }
#cubic-dev .dim, #cubic-dev .keys { color: #8A93A6; }
#cubic-dev .msg { color: #FF8A7A; max-width: 260px; }
#cubic-dev .btns { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0 4px; }
#cubic-dev button { font: inherit; color: #05070D; background: #F2C14E; border: 0; padding: 2px 6px; cursor: pointer; }
#cubic-dev button:disabled { opacity: 0.4; cursor: default; }
`;

const ROWS = ['view', 'face', 'pose', 'drift', 'voice', 'held', 'fps', 'ping'] as const;

const typing = () => {
  const el = document.activeElement;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
};

export function mountDev(): void {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.id = 'cubic-dev';
  panel.innerHTML = `
    <div class="hd">DEV <span class="dim" data-k="server"></span></div>
    ${ROWS.map((k) => `<div class="row"><b>${k}</b><span data-k="${k}"></span></div>`).join('')}
    <div class="dim" data-k="other"></div>
    <div class="btns">
      <button data-a="solve">Solve puzzle</button>
      <button data-a="hot">Hot-seat</button>
      <button data-a="view">Switch view</button>
    </div>
    <div class="msg" data-k="msg"></div>
    <div class="keys">\` overlay &middot; 1-6 teleport &middot; Shift+1-6 inside</div>
    <div class="keys" data-k="keys"></div>`;
  document.body.appendChild(panel);
  const cell = (k: string) => panel.querySelector<HTMLElement>(`[data-k="${k}"]`)!;
  const button = (a: string) => panel.querySelector<HTMLButtonElement>(`[data-a="${a}"]`)!;
  const set = (k: string, text: string) => {
    const el = cell(k);
    if (el.textContent !== text) el.textContent = text;
  };

  let msg = '';
  let fps = 0;
  let ping: number | null = null;
  /** Does the server obey dev commands? null = not known yet. */
  let serverDev: boolean | null = null;
  const hot = new HotSeat(() => draw());

  const offline = () => devHooks.net?.code === 'MOCK';
  /** The side that is drawn, and that the unshifted digit keys teleport. */
  const shown = (): Side | null => (devHooks.net?.side ? (devHooks.viewSide ?? devHooks.net.side) : null);

  function draw(): void {
    const net = devHooks.net;
    const side = shown();
    const state = net?.state ?? null;
    set('server', !net ? '(no game on this page)' : offline() ? 'offline mock' : !net.online ? 'server unreachable' : serverDev === null ? '' : serverDev ? 'server dev commands ON' : 'server dev commands OFF');
    if (state && side) {
      const me = state.players[side];
      const other = state.players[side === 'out' ? 'in' : 'out'];
      const item = me.carrying ? state.items[me.carrying] : null;
      set('view', `${side === 'out' ? 'OUTSIDE' : 'INSIDE'}${hot.side ? ' (hot-seat)' : ''}`);
      set('face', `${me.pose.face} ${FACE_NAMES[side][me.pose.face]}`);
      set('pose', `x ${me.pose.x}  y ${me.pose.y}  up [${me.pose.up.join(',')}]  side ${me.pose.side}`);
      set('drift', `${compassDrift(me.pose)} deg`);
      set('voice', `gain ${voiceMix(state).gain.toFixed(2)}`);
      set('held', item ? `${item.id} (${item.kind})` : 'nothing');
      set('other', `${other.side}: face ${other.pose.face}  x ${other.pose.x}  y ${other.pose.y}  up [${other.pose.up.join(',')}]`);
    } else {
      for (const k of ['view', 'face', 'pose', 'drift', 'voice', 'held']) set(k, '-');
      set('other', 'not in a game');
    }
    set('fps', String(fps));
    set('ping', offline() ? 'offline' : ping === null ? '-' : `${ping} ms`);
    set('msg', msg);
    set('keys', hot.side ? 'WASD + E outside · arrows + . inside · Tab view' : '');
    button('solve').disabled = !state || !side;
    button('view').disabled = !hot.side;
    button('hot').textContent = hot.active ? 'Stop hot-seat' : 'Hot-seat';
    button('hot').disabled = !net || offline();
  }

  /** Ask the server to do it. In the offline mock there is no server: change the local game. */
  async function run(cmd: DevCommand): Promise<void> {
    const net = devHooks.net;
    if (!net) return;
    if (offline()) {
      if (net.state && cmd.type === 'teleport') devTeleport(net.state, cmd.side, cmd.face);
      if (net.state && cmd.type === 'solve') devSolve(net.state, cmd.face);
      devHooks.render();
    } else {
      const res = await net.dev(cmd);
      msg = res.ok ? '' : res.error;
    }
    draw();
  }

  function setView(side: Side | null): void {
    devHooks.viewSide = side;
    devHooks.render();
    draw();
  }

  async function toggleHot(): Promise<void> {
    const net = devHooks.net;
    if (!net) return;
    if (hot.active) {
      hot.stop();
      setView(null);
      return;
    }
    msg = (await hot.start(net)) ?? '';
    draw();
  }

  panel.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    b.blur(); // or the next Space / Enter would press it again
    const net = devHooks.net;
    const side = shown();
    if (b.dataset.a === 'solve' && net?.state && side) void run({ type: 'solve', face: net.state.players[side].pose.face });
    if (b.dataset.a === 'hot') void toggleHot();
    if (b.dataset.a === 'view' && side) setView(side === 'out' ? 'in' : 'out');
  });

  // ---- keys. Capture phase on window: runs before the game's own key handler, so in
  // hot-seat mode the movement keys can be taken away from it.
  const held: Record<Side, string[]> = { out: [], in: [] };
  const nextAt: Record<Side, number> = { out: 0, in: 0 };
  const eat = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const step = (side: Side, dx: number, dy: number) => (side === devHooks.net?.side ? devHooks.net.move(dx, dy) : hot.move(dx, dy));
  const release = () => {
    held.out = [];
    held.in = [];
  };

  window.addEventListener(
    'keydown',
    (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing()) return;
      if (e.code === 'Backquote') {
        panel.hidden = !panel.hidden;
        eat(e);
        return;
      }
      const net = devHooks.net;
      const side = shown();
      if (!net?.state || !side) return;
      const digit = /^Digit([1-6])$/.exec(e.code);
      if (digit) {
        if (!e.repeat) void run({ type: 'teleport', side: e.shiftKey ? 'in' : side, face: Number(digit[1]) as FaceId });
        eat(e);
        return;
      }
      if (!hot.side) return;
      const k = e.key.toLowerCase();
      const move = MOVES[k];
      if (move) {
        const [who, dx, dy] = move;
        if (!held[who].includes(k)) {
          held[who].push(k);
          nextAt[who] = performance.now() + REPEAT_MS;
          step(who, dx, dy);
        }
        eat(e);
      } else if (INTERACT[k]) {
        if (!e.repeat) {
          if (INTERACT[k] === net.side) net.interact();
          else hot.interact();
        }
        eat(e);
      } else if (k === 'tab') {
        if (!e.repeat) setView(side === 'out' ? 'in' : 'out');
        eat(e);
      }
    },
    true,
  );
  window.addEventListener(
    'keyup',
    (e) => {
      const k = e.key.toLowerCase();
      held.out = held.out.filter((h) => h !== k);
      held.in = held.in.filter((h) => h !== k);
    },
    true,
  );
  window.addEventListener('blur', release);

  // Held keys keep walking, each player on their own clock.
  setInterval(() => {
    if (!hot.side || typing()) return release();
    const now = performance.now();
    for (const who of ['out', 'in'] as const) {
      const key = held[who][held[who].length - 1];
      if (!key || now < nextAt[who]) continue;
      nextAt[who] = now + REPEAT_MS;
      step(who, MOVES[key]![1], MOVES[key]![2]);
    }
  }, 20);

  // ---- FPS: frames the browser actually painted in the last second.
  let frames = 0;
  let since = performance.now();
  const frame = (t: number) => {
    frames++;
    if (t - since >= 1000) {
      fps = Math.round((frames * 1000) / (t - since));
      frames = 0;
      since = t;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // ---- ping: round trip of a dev command. A refusal still measures it, and tells us the
  // server has dev commands off.
  let waiting = false;
  setInterval(() => {
    const net = devHooks.net;
    if (!net?.online || offline()) {
      ping = serverDev = null;
      return;
    }
    if (waiting) return;
    waiting = true;
    const t0 = performance.now();
    void net.dev({ type: 'ping' }).then((res) => {
      waiting = false;
      ping = Math.round(performance.now() - t0);
      serverDev = res.ok;
    });
  }, PING_MS);

  // ---- housekeeping: the second seat follows the app's room.
  setInterval(() => {
    const net = devHooks.net;
    if (net?.online && !offline()) {
      const saved = HotSeat.saved();
      // After a refresh the app rejoins its seat by itself; bring the second seat back too.
      if (!hot.active && saved && net.code === saved.code) void hot.connect(saved.code, saved.token).then((err) => (msg = err ?? ''));
      // The app left the room: the second seat leaves with it.
      if (hot.side && net.code !== hot.code) {
        hot.stop();
        devHooks.viewSide = null;
      }
    }
    draw();
  }, 250);

  draw();
}

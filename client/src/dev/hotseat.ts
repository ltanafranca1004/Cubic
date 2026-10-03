import { io, type Socket } from 'socket.io-client';
import type { ClientToServer, Seat, ServerToClient, Side } from '@cubic/shared';
import { SERVER_URL, type Net } from '../net/client';

// Hot-seat: a second real socket from this page takes the other seat of the room the app
// is in, so one window drives both players through the real server. It only sends input;
// what is drawn still comes from the app's own Net (the server sends both seats the same
// state).

const SEAT_KEY = 'cubic.dev.hotseat';
type Saved = { code: string; token: string };

const until = async (cond: () => boolean, ms: number): Promise<boolean> => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
  return cond();
};

export class HotSeat {
  /** The seat the second socket holds, once it is in. */
  side: Side | null = null;
  code: string | null = null;
  private token: string | null = null;
  private sock: Socket<ServerToClient, ClientToServer> | null = null;
  private seq = 0;

  constructor(private onChange: () => void) {}

  get active(): boolean {
    return !!this.sock;
  }

  /** The seat kept from before a refresh, if any. */
  static saved(): Saved | null {
    try {
      return JSON.parse(sessionStorage.getItem(SEAT_KEY) ?? 'null');
    } catch {
      return null;
    }
  }

  /** Take the free seat of the app's room (creating a room first if it has none). Returns an error or null. */
  async start(net: Net): Promise<string | null> {
    if (this.sock) return null;
    if (!net.online) return 'Cannot reach the server.';
    if (!net.code) {
      net.createRoom();
      if (!(await until(() => !!net.code || !!net.error, 5000)) || !net.code) return net.error ?? 'Could not create a room.';
    }
    const seats = net.room?.seats;
    if (seats?.out.taken && seats.in.taken) return 'This room is full: hot-seat needs its free seat.';
    return this.connect(net.code, null);
  }

  /** Open the second socket and join `code`, or rejoin it with a saved `token`. */
  connect(code: string, token: string | null): Promise<string | null> {
    this.token = token;
    const opts = { transports: ['websocket', 'polling'], forceNew: true };
    const sock = (this.sock = SERVER_URL ? io(SERVER_URL, opts) : io(opts));
    return new Promise((resolve) => {
      // Also runs after a reconnect: then the token gets the same seat back.
      sock.on('connect', () => {
        const done = (res: ({ ok: true } & Seat) | { ok: false; error: string }) => {
          if (!res.ok) {
            this.stop();
            resolve(res.error);
            return;
          }
          this.side = res.side;
          this.code = res.code;
          this.token = res.token;
          try {
            sessionStorage.setItem(SEAT_KEY, JSON.stringify({ code: res.code, token: res.token } satisfies Saved));
          } catch {
            // storage blocked: the second seat will not survive a refresh
          }
          this.onChange();
          resolve(null);
        };
        if (this.token) sock.emit('room:rejoin', { code, token: this.token }, done);
        else sock.emit('room:join', { code }, done);
      });
    });
  }

  /** Give the second seat up. */
  stop(): void {
    this.sock?.emit('room:leave');
    this.sock?.disconnect();
    this.sock = null;
    this.side = this.code = this.token = null;
    try {
      sessionStorage.removeItem(SEAT_KEY);
    } catch {
      // ignore
    }
    this.onChange();
  }

  move(dx: number, dy: number): void {
    if (this.side) this.sock?.emit('move', { dx, dy, seq: ++this.seq });
  }

  interact(): void {
    if (this.side) this.sock?.emit('interact', { seq: ++this.seq });
  }
}

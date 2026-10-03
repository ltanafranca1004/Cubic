import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { io, type Socket } from 'socket.io-client';
import { CANON_UP, type ClientToServer, type DevCommand, type GameEvent, type GameState, type Seat, type ServerToClient } from '@cubic/shared';
import { createApp, type App } from '../src/app';
import { devCommandsEnabled } from '../src/dev';

// The dev command channel over real sockets: refused unless the server was started with
// dev commands on (DEV_COMMANDS=1), refused in production whatever the flag says, and
// when on the server changes the room's state itself and broadcasts it to both players.

type Sock = Socket<ServerToClient, ClientToServer>;
type Result = { ok: true } | { ok: false; error: string };

class Client {
  sock: Sock;
  state!: GameState;
  events: GameEvent[] = [];

  constructor(url: string) {
    this.sock = io(url, { transports: ['websocket'], forceNew: true });
    this.sock.on('state', (u) => {
      this.state = u.state;
      this.events.push(...u.events);
    });
  }

  private seat = (res: ({ ok: true } & Seat) | { ok: false; error: string }): Seat => {
    if (!res.ok) throw new Error(res.error);
    this.state = res.state;
    return res;
  };
  create = () => new Promise<Seat>((ok) => this.sock.emit('room:create', (r) => ok(this.seat(r))));
  join = (code: string) => new Promise<Seat>((ok) => this.sock.emit('room:join', { code }, (r) => ok(this.seat(r))));
  dev = (cmd: DevCommand) => new Promise<Result>((ok) => this.sock.emit('dev', cmd, ok));

  async until(cond: () => boolean, what: string): Promise<void> {
    const deadline = Date.now() + 3000;
    while (!cond()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }
}

const apps: App[] = [];
const socks: Sock[] = [];

/** A server with two seated clients (a = outside, b = inside). */
async function room(devCommands: boolean | undefined) {
  const app = createApp({ allowLocalhost: true, devCommands });
  apps.push(app);
  const url = `http://localhost:${await app.listen(0)}`;
  const a = new Client(url);
  const b = new Client(url);
  socks.push(a.sock, b.sock);
  const seat = await a.create();
  await b.join(seat.code);
  return { app, url, a, b };
}

after(async () => {
  for (const s of socks) s.disconnect();
  for (const app of apps) await app.close();
});

test('DEV_COMMANDS only counts as "1", and never in production', () => {
  assert.equal(devCommandsEnabled({}), false);
  assert.equal(devCommandsEnabled({ DEV_COMMANDS: '' }), false);
  assert.equal(devCommandsEnabled({ DEV_COMMANDS: '0' }), false);
  assert.equal(devCommandsEnabled({ DEV_COMMANDS: 'true' }), false);
  assert.equal(devCommandsEnabled({ DEV_COMMANDS: '1' }), true);
  assert.equal(devCommandsEnabled({ DEV_COMMANDS: '1', NODE_ENV: 'development' }), true);
  assert.equal(devCommandsEnabled({ DEV_COMMANDS: '1', NODE_ENV: 'production' }), false);
});

test('dev commands are refused when the server has them off (the default)', async () => {
  for (const flag of [undefined, false]) {
    const { a, b } = await room(flag);
    const before = JSON.stringify(a.state);
    for (const cmd of [{ type: 'ping' }, { type: 'teleport', side: 'out', face: 3 }, { type: 'teleport', side: 'in', face: 3 }, { type: 'solve', face: 1 }] as DevCommand[]) {
      const res = await a.dev(cmd);
      assert.equal(res.ok, false, cmd.type);
      assert.match((res as { error: string }).error, /off/i);
    }
    // A real move still works and shows nothing else changed.
    a.sock.emit('move', { dx: 0, dy: -1, seq: 1 });
    await b.until(() => b.events.some((e) => e.type === 'step' && e.side === 'out'), 'the move');
    assert.equal(b.state.players.out.pose.face, 1);
    assert.equal(b.state.players.in.pose.face, 1);
    assert.deepEqual(b.state.solved, []);
    assert.deepEqual(b.events.filter((e) => e.type === 'solve'), []);
    assert.notEqual(JSON.stringify(b.state), before);
  }
});

test('dev commands are refused in production even when asked for', async () => {
  const old = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const { a } = await room(true);
    assert.equal((await a.dev({ type: 'teleport', side: 'out', face: 3 })).ok, false);
    assert.equal((await a.dev({ type: 'solve', face: 1 })).ok, false);
    assert.equal(a.state.players.out.pose.face, 1);
    assert.deepEqual(a.state.solved, []);
  } finally {
    if (old === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = old;
  }
});

test('with dev commands on: teleport and solve happen on the server and reach both players', async () => {
  const { url, a, b } = await room(true);
  assert.deepEqual(await a.dev({ type: 'ping' }), { ok: true });

  // --- teleport yourself
  assert.deepEqual(await a.dev({ type: 'teleport', side: 'out', face: 3 }), { ok: true });
  await b.until(() => b.state.players.out.pose.face === 3, 'teleport reaches the partner');
  await a.until(() => a.state.players.out.pose.face === 3, 'teleport reaches the sender');
  assert.deepEqual(a.state.players.out.pose.up, CANON_UP[3]);
  assert.equal(a.state.players.in.pose.face, 1);

  // --- teleport the other player (Shift + digit: the inside one)
  assert.deepEqual(await a.dev({ type: 'teleport', side: 'in', face: 5 }), { ok: true });
  await b.until(() => b.state.players.in.pose.face === 5, 'the inside player is moved');
  assert.deepEqual(b.state.players.in.pose.up, CANON_UP[5]);
  // The server's state is the truth: a normal move carries on from the new face.
  b.sock.emit('move', { dx: 1, dy: 0, seq: 1 });
  await a.until(() => a.events.some((e) => (e.type === 'step' || e.type === 'bump') && e.side === 'in'), 'a move after the teleport');
  assert.equal(a.state.players.in.pose.face, 5);

  // --- solve
  assert.deepEqual(await b.dev({ type: 'solve', face: 1 }), { ok: true });
  await a.until(() => a.events.some((e) => e.type === 'solve' && e.face === 1), 'solve reaches the partner');
  await b.until(() => b.events.some((e) => e.type === 'solve' && e.face === 1), 'solve reaches the sender');
  assert.deepEqual(a.state.solved, [1]);
  assert.deepEqual(await b.dev({ type: 'solve', face: 1 }), { ok: true }); // again: nothing new
  assert.equal(a.events.filter((e) => e.type === 'solve').length, 1);

  // --- garbage is refused and changes nothing
  const before = JSON.stringify(a.state);
  const bad = [{ type: 'teleport', side: 'out', face: 7 }, { type: 'teleport', side: 'up', face: 1 }, { type: 'solve' }, { type: 'nuke' }, null, 'solve'] as unknown as DevCommand[];
  for (const cmd of bad) assert.equal((await a.dev(cmd)).ok, false, JSON.stringify(cmd));
  assert.equal(JSON.stringify(a.state), before);

  // --- a socket that is in no room can ping, nothing else
  const loner = new Client(url);
  socks.push(loner.sock);
  assert.deepEqual(await loner.dev({ type: 'ping' }), { ok: true });
  assert.match(((await loner.dev({ type: 'solve', face: 1 })) as { error: string }).error, /room/i);
});

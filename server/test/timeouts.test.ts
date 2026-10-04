import assert from 'node:assert/strict';
import { test } from 'node:test';
import { io, type Socket } from 'socket.io-client';
import type { ClientToServer, Seat, ServerToClient } from '@cubic/shared';
import { SOCKET_TIMING, createApp } from '../src/app';
import { INACTIVITY, LIMITS, SEAT_HOLD_MS } from '../src/rooms';

// The connection timeouts: the socket's heartbeat (SOCKET_TIMING in src/app.ts) next to
// the room's own clocks (seat hold, lobby hold, inactivity). The heartbeat decides WHEN a
// silent connection counts as gone; the room's clocks only start after that.

test('heartbeat: a stalled page keeps its socket for 30 s, a dead one is noticed within 45 s', () => {
  const { pingInterval, pingTimeout, connectTimeout } = SOCKET_TIMING;
  assert.deepEqual([pingInterval, pingTimeout, connectTimeout], [15_000, 30_000, 45_000]);
  assert.ok(pingTimeout >= 30_000, 'a phone that stalls (network switch, a frozen tab) is not cut off after the default 20 s');
  // worst case to notice a dead peer, both ways: no slower than socket.io's defaults (25 s + 20 s)
  assert.ok(pingInterval + pingTimeout <= 25_000 + 20_000);
});

test('heartbeat: the server really runs with those numbers, and tells the client', async () => {
  const app = createApp({ allowLocalhost: true });
  const port = await app.listen(0);
  try {
    const opts = app.io.engine.opts;
    assert.deepEqual([opts.pingInterval, opts.pingTimeout], [SOCKET_TIMING.pingInterval, SOCKET_TIMING.pingTimeout]);
    // the handshake hands them to the browser: its own "the server is dead" timer is their sum
    const open = await (await fetch(`http://localhost:${port}/socket.io/?EIO=4&transport=polling`)).text();
    const hello = JSON.parse(open.slice(1)) as { pingInterval: number; pingTimeout: number };
    assert.deepEqual([hello.pingInterval, hello.pingTimeout], [SOCKET_TIMING.pingInterval, SOCKET_TIMING.pingTimeout]);
  } finally {
    await app.close();
  }
});

test('the room clocks are the designed ones, and the heartbeat comes before them, never instead', () => {
  assert.deepEqual([SEAT_HOLD_MS, LIMITS.seatHoldMs, LIMITS.lobbyHoldMs], [60_000, 60_000, 15_000]);
  assert.deepEqual([INACTIVITY.idleMs, INACTIVITY.warnMs], [240_000, 60_000]);
  // A page that went silent: noticed after at most pingInterval + pingTimeout, then held.
  const silent = SOCKET_TIMING.pingInterval + SOCKET_TIMING.pingTimeout;
  assert.equal(silent + LIMITS.seatHoldMs, 105_000, 'a locked phone in a game: up to 105 s before the seat opens');
  // It is gone as "disconnected" long before the 4 minute inactivity rule could call it idle.
  assert.ok(silent < INACTIVITY.idleMs);
});

test('a socket that closes while seated is logged with its reason; one outside a room is not', async () => {
  const lines: string[] = [];
  const app = createApp({ allowLocalhost: true, log: (line) => lines.push(line) });
  const url = `http://localhost:${await app.listen(0)}`;
  const connect = () =>
    new Promise<Socket<ServerToClient, ClientToServer>>((resolve) => {
      const s: Socket<ServerToClient, ClientToServer> = io(url, { transports: ['websocket'], forceNew: true });
      s.on('connect', () => resolve(s));
    });
  const gone = async (n: number) => {
    for (let i = 0; i < 100 && app.io.sockets.sockets.size > n; i++) await new Promise((r) => setTimeout(r, 10));
  };
  try {
    const idle = await connect();
    idle.disconnect();
    await gone(0);
    assert.deepEqual(lines, [], 'no room, no line');

    const host = await connect();
    const seat = await new Promise<{ ok: true } & Seat>((resolve) => host.emit('room:create', (res) => resolve(res as { ok: true } & Seat)));
    host.disconnect();
    await gone(0);
    assert.equal(lines.length, 1);
    assert.match(lines[0]!, new RegExp(`^\\[socket\\] room=${seat.code} member=${seat.id} side=- phase=lobby closed: client namespace disconnect$`));
    // and the lobby hold started: the place is kept, not given up
    assert.equal(app.rooms.get(seat.code)?.info().members.host?.connected, false);
  } finally {
    await app.close();
  }
});

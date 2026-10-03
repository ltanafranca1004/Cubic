import { createServer } from 'node:http';
import { Server } from 'socket.io';
import type { ClientToServer, ServerToClient } from '@cubic/shared';

// Skeleton: health check, CORS and a typed Socket.io server. Rooms land on branch "core".

try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  // no server/.env: fine, use the real environment
}

const PORT = Number(process.env.PORT) || 3001;
const isProd = process.env.NODE_ENV === 'production';
const allowed = (process.env.CLIENT_ORIGIN ?? '')
  .split(',')
  .map((o) => o.trim().replace(/\/$/, ''))
  .filter(Boolean);
const isLocal = (origin: string) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

export function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // same-origin / non-browser clients
  return allowed.includes(origin.replace(/\/$/, '')) || (!isProd && isLocal(origin));
}

const http = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const io = new Server<ClientToServer, ServerToClient>(http, {
  cors: { origin: (origin, cb) => cb(null, originAllowed(origin)) },
});

io.on('connection', (socket) => {
  socket.emit('info', { aiAvailable: false, ttsAvailable: false });
});

http.listen(PORT, () => console.log(`cubic server listening on :${PORT}`));

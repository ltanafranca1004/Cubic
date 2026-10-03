import { defineConfig } from 'vite';

// The local game server (server/.env PORT, default 3001).
const GAME_SERVER = 'http://localhost:3001';

// Requests proxied to the game server look like they come from the dev client itself, so
// the server's origin check passes whatever host the page was opened on (LAN IP, tunnel).
const asLocal = {
  target: GAME_SERVER,
  changeOrigin: true,
  configure: (proxy: { on(event: string, fn: (req: { setHeader(name: string, value: string): void }) => void): void }) => {
    const rewrite = (req: { setHeader(name: string, value: string): void }) => req.setHeader('origin', 'http://localhost:5173');
    proxy.on('proxyReq', rewrite);
    proxy.on('proxyReqWs', rewrite);
  },
};

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    // Reachable from other machines and through a tunnel (any *.trycloudflare.com host),
    // so one HTTPS URL serves the whole game: `npx cloudflared tunnel --url http://localhost:5173`.
    host: true,
    allowedHosts: true,
    proxy: {
      '/socket.io': { ...asLocal, ws: true },
      '/health': asLocal,
    },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});

# Cubic

StormHacks 2026 project: two players, one cube. One's outside, one's trapped inside.

Each player sees only their own side of the same six walls. The cube's geometry is the
game: corners are 270 degrees, walking a loop around one turns you 90 degrees, and the
inside is mirrored. You solve it by talking through the wall.

## Run

Needs Node 22.12+.

```
npm install
npm run dev        # server on :3001, client on http://localhost:5173
```

Other commands: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` (client),
`npm run maps` (bundle Tiled maps from `/maps`).

Optional env files: copy `server/.env.example` to `server/.env` and
`client/.env.example` to `client/.env.local`. Nothing is required for a local two-player
game.

## Test with two browser windows

1. `npm run dev`, then open `http://localhost:5173` in two windows side by side (two
   windows, not two tabs of one window: a hidden tab pauses its game loop).
2. Window A: **Create room**. You are the OUTSIDE player; a 4-letter code appears.
3. Window B: type the code, **Join room**. You are the INSIDE player. Both windows switch
   to the game.
4. Move with WASD or the arrow keys (hold to keep walking). Walk off any edge to cross to
   the next face; the labels around the view say which face is where, and "compass drift"
   shows how far your up has turned.
5. Example puzzle on face 1: the inside player stands on the plate (they see it top-left),
   the door on the outside opens, the outside player walks in and takes the crystal.
6. Face 6 has the portal. Once every puzzle is solved, both players step on it to win.
7. Chat: Enter to type, Esc to close. Refreshing a window puts you back in your seat.

Teammates: read [CLAUDE.md](CLAUDE.md) first, then the README in your folder:
[puzzles](shared/src/puzzles/README.md), [maps](maps/README.md),
[assets](client/public/assets/README.md), [ui](client/src/ui/README.md),
[scenes](client/src/scenes/README.md).

No server needed for UI or art work: `http://localhost:5173/?mock=game` is a playable local
game (`&side=in` for the inside view); `?mock=lobby` and `?mock=hud` show static mock states.

## Deploy

Backend on Render, frontend on Vercel. Config is in `render.yaml` and `vercel.json`.

### 1. Backend: Render

1. render.com > New > Blueprint > connect this GitHub repo. Render reads `render.yaml`
   and creates the free web service `cubic-server` (build `npm install`, start
   `npm start -w server`, health check `/health`).
2. Set the env vars it asks for (leave what you do not have yet empty):
   - `CLIENT_ORIGIN`: the Vercel URL (step 3). Comma-separate several origins.
   - `GEMINI_API_KEY`, `GEMINI_MODEL`: for "Play with AI".
   - `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`: for the AI partner's voice.
   Render sets `PORT` itself.
3. Deploy and note the URL, e.g. `https://cubic-server.onrender.com`. Check
   `https://<render-url>/health` returns `{"ok":true}`.

The free tier **sleeps after 15 minutes idle** and takes up to a minute to wake. Open the
app (or the `/health` URL) a few minutes before a demo or judging.

### 2. Frontend: Vercel

1. vercel.com > Add New > Project > import this repo. Keep the root directory at the repo
   root; `vercel.json` sets install (`npm install`), build (`npm run build -w client`),
   output (`client/dist`) and the SPA fallback.
2. Add the env var `VITE_SERVER_URL` = the Render URL (no trailing slash). It is read at
   build time, so redeploy after changing it.
3. Deploy and note the URL, e.g. `https://cubic.vercel.app`.

### 3. Connect them

On Render, set `CLIENT_ORIGIN` to the Vercel URL and redeploy the service. Without it the
browser's requests are rejected by CORS.

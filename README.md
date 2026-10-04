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
2. Window A: **Play**, then **Create Lobby**. You are the host (P1); the 4-letter room
   code is at the top of the screen.
3. Window B: **Play**, **Join Lobby**, type the code. You are the guest (P2). Each player
   picks a side (A / D or click: outside is on top of the cube, inside is in it), the
   guest presses **Ready**, the host presses **Start**. Both windows switch to the game.
4. Move with WASD or the arrow keys (hold to keep walking). Walk off any edge to cross to
   the next face; the labels around the view say which face is where, and the cube in the
   HUD turns as your up turns (the compass drift).
5. Example puzzle on face 1: the outside player reads the three digits laid out in the
   grass, the inside player walks onto the keys of the floor keypad and presses **E** on
   each, then on ENTER.
6. Six puzzles, one per face (below). The game is won the moment the last one is solved.
7. Chat: Enter to type, Esc to close. Refreshing a window puts you back in your seat.

### Controls (the mouse is never needed)

| Key | Gamepad | Does |
| --- | --- | --- |
| WASD / arrows | left stick / d-pad | move; in a menu, move the focus |
| E | A | pick up / use (in a menu: Enter or Space select) |
| Q | B | drop (in a menu: Esc is back) |
| 1 2 3 4 | | quick chat: "Here!", "Wait", "Yes", "No" (a bubble over you, and in the chat log) |
| Enter | | chat (Enter sends, Esc closes) |
| V (hold) / M | | push to talk / mute the mic |
| Tab (hold) | | the full cube map; the arrows turn it |
| Esc | Start | pause: Resume, Settings, Leave and this list |

In the menus Tab reaches the settings gear. In the join popup you type the code, Backspace
deletes, Enter joins and the arrows reach Cancel. Settings (the gear, or the pause menu):
left / right change the focused row. Accessibility settings: text size S / M / L, high
contrast, screen shake, and open mic or push-to-talk. Spoken lines are captioned.
`cd tools && npx tsx screens/a11y.ts` plays all of it with the keyboard only.

## Voice

Cubic is meant to be played by voice, no Discord. In the game press **Enable microphone**
and allow it. Hold **V** to talk (or switch to open mic), **Mute** to cut your mic, and use
the slider for your partner's volume. How well you hear each other depends on where you
both stand on the cube: same wall is clear, the next face is faint (35%), the opposite
face is silent. The bars show the signal (3, 1, 0), the dots show who is speaking.

Audio is WebRTC, signaled through our own Socket.io server. The client asks the server
for its ICE servers (`GET /ice`): public STUN, plus a TURN relay when one is configured
(see [TURN relay](#turn-relay-optional)). If a direct connection still cannot be made it
falls back to relaying audio through the game server; add `?relay` to the URL to force
that path when testing. Voice reconnects by itself after a refresh. To test alone, use two
windows and headphones.

The browser console shows how a call got through: `[voice] ice checking / connected`,
then `[voice] connected via host` (same network), `srflx` (STUN) or `relay` (TURN).

## Audio

Music changes with where you are: a menu theme, a lobby theme, a bright adventurous loop
for the outside player and a dark one for the inside player, crossfaded over 800 ms, plus
a short sting when a puzzle is solved. It starts on your first click or key press
(browsers block sound before that) and dips about 6 dB while your partner talks.

Everything goes through `client/src/audio/AudioManager.ts`:

```ts
import { audio, musicForScreen } from './audio/AudioManager';
audio.setMaster(0.8); audio.setMusic(0.5); audio.setSfx(1); // 0..1, heard at once
audio.playMusic(musicForScreen('start'));                   // 'menu' | 'lobby' | 'outside' | 'inside'
audio.playMusic('lobby', { fade: 400 });                    // fade in ms, default 800
audio.stopMusic({ fade: 800 });
audio.playSfx('solved');                                    // or any synthesized effect, e.g. 'step'
```

The tracks are CC0, from the Ninja Adventure pack (see [CREDITS.md](CREDITS.md)), and
live in `client/public/assets/audio`. Voice chat has its own volume slider and is not
affected by these three volumes.

Optional: `npm run music:gen -w server` generates alternative tracks with the ElevenLabs
Music API into `client/public/assets/audio/gen`. It prints the estimated cost and asks
before spending anything, and refuses above `MUSIC_MAX_CREDITS` (default 5000). The API
key needs the `music_generation` permission and a paid plan. Model: `ELEVENLABS_MUSIC_MODEL`
(default `music_v1`).

## Items

Press **E** to pick up the item you are standing on, and **Q** (or E again) to drop it. You carry one
at a time and it comes with you across faces. Example: the inside player carries the
battery from the safe on face 2 to the laser emitter on face 5. With empty hands and no
item on your tile, **E** uses the tile: a key, a button, a flip tile.

## The six puzzles

Each player sees only their own half, so every one is solved by talking. Chain: 2, then 5,
then 6, then 4. Faces 1 and 3 can be done at any time.

| Face | Outside | Inside | Unlocks |
| --- | --- | --- | --- |
| 1 Grass / Keypad room | reads the number in the grass (only right when their view is upright) | types the three digits, ENTER | |
| 2 Desert / Vault | counts bushes, rocks and birds | types 3 x bushes x 2 x birds x rocks, ENTER | the battery |
| 3 Snow / Tile room | describes the symbol in the snow | flips floor tiles to copy it, mirrored | |
| 4 Forest / Greenhouse | plants the flower in the pot the partner names | sees which pot holds that colour | |
| 5 Rooftop / Laser room | calls the order the symbols light up in | battery into the emitter, then the symbols in that order | the laser |
| 6 Cave / Lava room | pushes mirrors until the beam burns the crate, then calls the safe path | walks the path over the lava to the button | the flower |

The lava of face 6 is only deadly while the laser is on (face 5 solved) and its button is
not pressed yet; before and after it is cold rock.

## Play with the AI

No second player? An AI partner takes the other side. It sees only its own side of the
cube, like a human would, and you play by chatting with it.

1. `npm run dev`, open the app, press **Play**, then **Play with AI** and pick your side.
   No key is needed: without one the scripted partner plays alone.
2. Optional: a key from https://aistudio.google.com/apikey in `server/.env` as
   `GEMINI_API_KEY=...` (optional `GEMINI_MODEL`, default `gemini-3.5-flash`) gives it
   natural lines and lets it read free-form chat.
3. Type to it (Enter). Short words work best: `go`, `wait`, `yes`, `no`, `face 3`, and
   whatever its own lines ask for. Quick chat (keys 1 to 4) counts. It walks at human
   speed. Its lines are 80 characters at most and show as captions.

How it is built:

- **The script drives.** A rule-based partner (`shared/src/bot/partner.ts`) decides every
  step from what its side can see and what you typed. It finds you by voice, stays on your
  wall, keeps off tiles that are not safe, and walks into the portal at the end. Each
  puzzle it can play is one small file in `shared/src/bot/scripts` (see the README
  there); on a puzzle it has no script for it says so and keeps its hands off.
- **Gemini advises.** It rewords small talk, answers free-form chat, turns it into the
  words the script understands, and may suggest a move, which is only walked if the script
  calls it safe. One call per 6 seconds per room, no backlog. A call that takes more than
  3 seconds, fails or hits the rate limit is dropped and the script's own line is said:
  the partner never waits for the API.
- **Personality:** `AI_PERSONA=default` or `AI_PERSONA=tsundere` (annoyed on the surface,
  secretly helpful). Tone only.
- `AI_FAKE=1` switches Gemini off even if there is a key.

Keys stay on the server and are never sent to the browser.

### The AI's voice

`TTS_MODE=browser` (default outside production) speaks the AI's lines with the browser's
free `speechSynthesis`. `TTS_MODE=elevenlabs` (default in production) uses ElevenLabs
(`ELEVENLABS_API_KEY`, optional `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL` default
`eleven_flash_v2_5`). The game never waits for a clip.

To keep ElevenLabs cheap:
- **The voice bank is in the repo** (`server/tts/bank`, one MP3 per line, `index.json`
  says which is which). It holds the script's puzzle-independent lines for both personas
  and the generic lines in `server/tts/bank-lines.txt`. A line that matches a banked one,
  ignoring case and punctuation, plays that clip in either mode, with no key and after
  any redeploy. `npm run tts:bank -w server` adds what is missing and nothing else
  (lines already banked are skipped; a clip in the local cache is copied, not bought).
- The script's own lines are never bought at runtime: banked, or read by the browser.
- Gemini's lines are generated on demand and cached in `server/.tts-cache` (not in git).
  At most `TTS_SESSION_LINES` (default 15) per room; after that, and on any miss or
  failure, the browser voice takes over.
- Characters sent to ElevenLabs are logged per room and in total (`[tts ROOM] ...`), and
  Gemini calls and tokens per room (`[ai ROOM] ...`).

## Test on two laptops

The microphone needs HTTPS, so share one HTTPS URL through a tunnel. Only laptop A runs
anything.

```
# laptop A, terminal 1
npm install
npm run dev

# laptop A, terminal 2
npx cloudflared tunnel --url http://localhost:5173
```

cloudflared prints a URL like `https://random-words.trycloudflare.com`. Open it on both
laptops: one creates a room, the other joins with the code. The dev client talks to its
own origin and Vite proxies `/socket.io` (WebSocket included) to the local game server,
so that single URL serves the whole game. Leave `VITE_SERVER_URL` unset for this.

Voice between two networks is peer-to-peer when it can be, goes through the TURN relay if
one is set (see [TURN relay](#turn-relay-optional)), and falls back to relaying through
the game server when neither works. Use headphones.

Teammates: read [CLAUDE.md](CLAUDE.md) first, then the README in your folder:
[puzzles](shared/src/puzzles/README.md), [maps](maps/README.md),
[assets](client/public/assets/README.md), [ui](client/src/ui/README.md),
[scenes](client/src/scenes/README.md).

No server needed for UI or art work: `http://localhost:5173/?mock=game` is a playable local
game (`&side=in` for the inside view); `?mock=menu`, `?mock=lobby` and `?mock=hud` show
static mock states. The look is specified in [docs/style.md](docs/style.md) and
[docs/menu-design.md](docs/menu-design.md); art credits are in [CREDITS.md](CREDITS.md).

## Dev tools

Add `?dev` to the URL (`http://localhost:5173/?dev`). Without it none of this is loaded.

- **`` ` ``** shows or hides an overlay: face, pose (x, y, up vector, side), compass drift,
  voice gain (`voiceMix`), held item, FPS and ping (round trip to the server).
- **1 to 6** teleport your player to that face. **Shift + 1 to 6** teleport the INSIDE
  player instead.
- **Solve puzzle** marks the puzzle on your current face as solved.
- **Hot-seat** lets one window play both players: a second socket from the same page takes
  the other seat of a real room, so every move still goes through the server. WASD + E =
  outside, arrow keys + `.` = inside. The overlay says which side is drawn; **Tab** or
  **Switch view** shows the other one. A refresh keeps both seats.

Teleport and solve are done by the server, and only when it runs with `DEV_COMMANDS=1` in
`server/.env`. It is off by default and ignored when `NODE_ENV=production`, so it cannot be
switched on for the deployed game. Hot-seat and the overlay need no flag. Solve only latches
the face as solved: the puzzle's own state (an open door, say) is left as it was. With
`?mock=game&dev` the same keys change the local mock game.

## Deploy

Backend on Render, frontend on Vercel. Config is in `render.yaml` and `vercel.json`.

### 1. Backend: Render

1. render.com > New > Blueprint > connect this GitHub repo. Render reads `render.yaml`
   and creates the free web service `cubic-server` (build `npm install`, start
   `npm start -w server`, health check `/health`).
2. Set the env vars it asks for (leave what you do not have yet empty):
   - `CLIENT_ORIGIN`: the Vercel URL (step 3). A comma-separated list; `*` matches
     inside a host name, e.g.
     `https://cubic.vercel.app,https://cubic-*.vercel.app,https://cubic.tech`.
   - `GEMINI_API_KEY`: for "Play with AI".
   - `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`: for the AI partner's voice.
   - `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL`: optional voice relay, see
     [TURN relay](#turn-relay-optional).
   The rest have defaults in `render.yaml`: `GEMINI_MODEL`, `AI_FAKE`, `AI_PERSONA`,
   `TTS_MODE`, `ELEVENLABS_MODEL`, `ELEVENLABS_BANK_MODEL`. Render sets `PORT` itself. Every variable is
   described in `server/.env.example`.
3. Deploy and note the URL, e.g. `https://cubic-server.onrender.com`. Check
   `https://<render-url>/health` returns `{"ok":true}`.

The free tier **sleeps after 15 minutes idle** and a cold start takes about 50 seconds.
The lobby pings `/health` the moment it loads to start waking the server, and shows
"Waking the server..." until it answers. Open the app a few minutes before a demo or
judging.

Render's disk is not kept between deploys, so the voice cache starts empty there: clips
are generated on first use and reused until the next restart.

### TURN relay (optional)

STUN alone fails on strict networks (symmetric NAT, campus and venue Wi-Fi, some mobile
carriers). Without TURN those calls drop to the slower chunk relay through the game
server. With TURN they stay real WebRTC, relayed by the TURN server.

Set all three on the server (Render dashboard, or `server/.env` locally). If any is
missing the server hands out STUN only:

| Variable | Value |
| --- | --- |
| `TURN_URLS` | The `turn:` / `turns:` URLs, comma-separated |
| `TURN_USERNAME` | The credential's username |
| `TURN_CREDENTIAL` | The credential's password |

One free provider that fits this static username + password model is **Metered**
(checked against its docs on 2026-10-03):

1. Sign up at [metered.ca](https://www.metered.ca/tools/openrelay/) (no credit card).
2. Dashboard > **TURN Server > Credentials > Create Credential**. Label, region and
   project are optional.
3. Open the credential, **Get credential > Show ICE Servers Array**. Copy the `username`
   and `credential` into `TURN_USERNAME` and `TURN_CREDENTIAL`, and the `turn:` / `turns:`
   URLs into `TURN_URLS`. Use the hosts your dashboard shows; the docs' example is:

   ```
   TURN_URLS=turn:global.relay.metered.ca:80,turn:global.relay.metered.ca:80?transport=tcp,turn:global.relay.metered.ca:443,turns:global.relay.metered.ca:443?transport=tcp
   ```

   Leave the `stun:` entry out: the server always adds public STUN itself.
4. A new credential can take up to 2 minutes to work. Redeploy or restart the server, then
   check `https://<render-url>/ice` lists the TURN entry.

Things to know:

- **Free quota.** Metered's Open Relay page says 20 GB of TURN usage per month; its
  pricing page lists the free plan as a "Free Trial" with 500 MB per month. Assume the
  lower number. Voice is small (our estimate: 30 to 60 MB per hour of relayed call,
  counting both directions), so either is enough for a demo, and only calls that cannot
  connect directly use it.
- **Credential lifetime.** A credential created in the dashboard is a plain username and
  password with no expiry set, which is what the three env vars need. Metered can also
  create expiring credentials, but only through its REST API (`expiryInSeconds`); Cubic
  does not call that API. The docs do not state in so many words that dashboard
  credentials never expire, so if TURN stops working, check the credential first.
- **The credential is not secret from players.** `/ice` sends it to every browser on an
  allowed origin, as any WebRTC app must. It only allows relaying through that TURN
  account, so the risk is someone using up the quota. Rotate it in the dashboard if so.
- Providers with short-lived, API-generated credentials only (for example Cloudflare
  Realtime TURN) do not fit these env vars: `/ice` would have to call their API per
  request.

Docs: [Open Relay](https://www.metered.ca/tools/openrelay/),
[creating TURN credentials](https://www.metered.ca/docs/turn-server-service/creating-turn-credentials/),
[expiring credentials](https://www.metered.ca/docs/turnserver-guides/expiring-turn-credentials/),
[pricing](https://www.metered.ca/stun-turn).

### 2. Frontend: Vercel

1. vercel.com > Add New > Project > import this repo. Keep the root directory at the repo
   root; `vercel.json` sets install (`npm install`), build (`npm run build -w client`),
   output (`client/dist`) and the SPA fallback.
2. Add the env var `VITE_SERVER_URL` = the Render URL (no trailing slash). It is read at
   build time, so redeploy after changing it. A Vercel build without it fails on purpose
   (`client/vite.config.ts`).
3. Settings > Build and Deployment > Node.js Version: 22.x, the same major as Render.
4. Deploy and note the URL, e.g. `https://cubic.vercel.app`.

### 3. Connect them

On Render, set `CLIENT_ORIGIN` to the Vercel URL and redeploy the service. Without it the
browser's requests are rejected by CORS.

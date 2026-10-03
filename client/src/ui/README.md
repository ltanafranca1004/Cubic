# /client/src/ui (owner: friend 2)

Everything the player sees outside the Phaser canvas: lobby, HUD, chat, voice controls,
win screen. Plain DOM/CSS (or any small library you like). No game logic, no sockets.

## The contract: `hooks.ts`

```ts
const handle = ui.mount(root, actions); // once
handle.update(state);                   // on every change
```

- `UIState` is everything you may show. You get a fresh object each update; never mutate it.
- `UIActions` is everything the player can do: `onCreateRoom()`, `onJoinRoom(code)`,
  `onPlayWithAI(side)`, `onLeaveRoom()`, `onSendChat(text)`, `onEnableMic()`,
  `onSetMuted(muted)`, `onSetMicMode(mode)`, `onSetPartnerVolume(v)`, `onPlayAgain()`.
- The game canvas is `#game` inside `root`. Lay your UI out around it; do not remove it.
- Need something that is not in `UIState` or `UIActions`? Ask Luis to add it to `hooks.ts`.
  Do not reach into `/client/src/game` or `/client/src/net`.

## What to build

| Screen | Driven by |
| --- | --- |
| Lobby: create room (show code), join by code, Play with AI (pick outside/inside) | `screen === 'lobby'`, `status`, `roomCode`, `error`, `aiAvailable`, `online` |
| HUD: face name, compass drift, 4 edge labels, objective, progress 1-6, strikes, clock, carried item | `hud` |
| Chat: Enter opens, Esc closes, AI lines labelled, typing indicator | `chat`, `partnerTyping` |
| Voice: mic permission screen, hold V to talk / open mic, mute, partner volume slider, 3 signal bars, speaking indicators | `voice` |
| Win screen | `hud.won`, `hud.elapsedMs`, `hud.strikes` |

Movement keys (WASD / arrows), E (pick up / drop) and V (push to talk) are handled by the
game, not the UI. While a text input is focused the game ignores them.

## Working without the server

Open `http://localhost:5173/?mock=lobby` or `?mock=game`. The UI is mounted with the states
in `mock.ts` and actions that only log to the console. Edit `mock.ts` to try other states.

## Shipping it

1. Write your `UIHost` in this folder (e.g. `ui/app.ts`).
2. In `ui/index.ts` change `export const ui = placeholderUI` to yours.

The placeholder in `/client/src/lobby` is the reference implementation. Do not edit it.

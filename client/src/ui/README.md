# /client/src/ui (owner: friend 2)

Everything the player sees that is not the game view. No game logic, no sockets.
The look is specified in [docs/style.md](../../../docs/style.md) and
[docs/menu-design.md](../../../docs/menu-design.md).

## The contract: `hooks.ts`

```ts
const handle = ui.mount(root, actions); // once
handle.update(state);                   // on every change
```

- `UIState` is everything you may show. You get a fresh object each update; never mutate it.
- `UIActions` is everything the player can do: `onCreateRoom()`, `onJoinRoom(code)`,
  `onPlayWithAI(side)`, `onPickSide(side | null)`, `onSetReady(ready)`, `onStartGame()`,
  `onLeaveRoom()`, `onSendChat(text)`, `onEnableMic()`, `onSetMuted(muted)`,
  `onSetMicMode(mode)`, `onSetPartnerVolume(v)`, `onPlayAgain()`.
- `UIState.lobby` is the side select: who is host and guest, what each picked, whether the
  guest is ready and why the host cannot start yet. It is the server's state. Show it;
  never predict it.
- The game canvas is `#game` inside `root`. Lay the UI out around it; do not remove it.
- Need something that is not in `UIState` or `UIActions`? Ask Luis to add it to `hooks.ts`.
  Do not reach into `/client/src/game` or `/client/src/net`.

## What is here

| File | What |
| --- | --- |
| `cubicUI.ts` | The active `UIHost`. Starts the menu stage (`../scenes`), and is the DOM on top of it: top bar (leave, room code, gear), HUD, chat, voice, win screen. |
| `settingsPanel.ts` | The panel behind the gear: master / music / SFX volume, proximity chat on/off and volume, mic mute. Same panel on every screen. |
| `css.ts` | The stylesheet. Sizes are in art pixels (`4u`), on the same pixel grid as the canvases. |
| `hooks.ts` | The contract above. |
| `mock.ts` | Static states for building UI without a server. |

| Screen | Where | Driven by |
| --- | --- | --- |
| Title, mode select, join popup | `../scenes` (Phaser) | `screen`, `status`, `error`, `aiAvailable`, `online` |
| Side select | `../scenes/SideSelectScene.ts` | `lobby`, `roomCode`, `error` |
| HUD: face, compass drift, 4 edge labels, objective, progress 1-6 (the cube net), strikes, clock, carried item | `cubicUI.ts` | `hud` |
| Chat: Enter opens, Esc closes, AI lines labelled, typing indicator | `cubicUI.ts` | `chat`, `partnerTyping` |
| Voice: mic permission, hold V / open mic, mute, signal bars, speaking dots | `cubicUI.ts` | `voice`, the settings |
| Room code (top middle, from the side select on) and settings gear (top right, always) | `cubicUI.ts` | `roomCode`, `mode` |
| Win screen | `cubicUI.ts` | `hud.won`, `hud.elapsedMs`, `hud.strikes` |

Movement keys (WASD / arrows), E (pick up / drop) and V (push to talk) are handled by the
game, not the UI. While a text input is focused the game ignores them.

Sound: the UI never plays audio itself. The settings sliders set volumes through
`../style/audioApi.ts`, which `main.ts` connects to the AudioManager with `setAudioApi()`.

## Working without the server

- `http://localhost:5173/?mock=menu`: the title, then the mode screen (buttons only log).
- `?mock=lobby`: the side select with the state in `mock.ts`. `?mock=hud`: the HUD with a
  static state (no game view). Edit `mock.ts` to try other states.
- `?mock=game` (add `&side=in` for the inside player): a real playable game running
  locally with no server, so you can see the HUD change as you walk.

The first placeholder UI is still in `/client/src/lobby` as a reference for the contract.
It predates the lobby (it has no side select), so it can no longer start a friend game.

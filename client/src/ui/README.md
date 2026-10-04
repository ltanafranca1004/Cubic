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
| `cubicUI.ts` | The active `UIHost`. Starts the menu stage (`../scenes`), and is the DOM on top of it: top bar (leave, room code, gear), HUD, chat, voice, the ending's title card. |
| `settingsPanel.ts` | The panel behind the gear, three tabs in one box: SOUND (volumes, voice chat, mic mode), ACCESS (text size, high contrast, reduce motion, screen shake, hints), CONTROLS (one row per action: click its key, press a new one; a key in use swaps; RESET TO DEFAULTS). Same panel on every screen. Settings and bindings are saved in `localStorage` (`style/settings.ts`). |
| `copy.ts` | `copyText()`: the clipboard, with a fallback. The lobby's COPY button and the C key use it. |
| `onboarding/` | The hint layer over the HUD: side intro card, controls hint, the three context hints, the narrator's caption. `rules.ts` decides what shows (pure, tested in `test/onboarding.test.ts`), `index.ts` draws it, `anchors.ts` holds the HUD selectors the hints point at, `caption.ts` is the one `showCaption(text)` function. Narrator lines: `../content/narrator.ts`. Mounted once in `app.ts`. |
| `css.ts` | The stylesheet. Sizes are in art pixels (`4u`), on the same pixel grid as the canvases. |
| `hooks.ts` | The contract above. |
| `mock.ts` | Static states for building UI without a server. |

| Screen | Where | Driven by |
| --- | --- | --- |
| Title, mode select, join popup | `../scenes` (Phaser) | `screen`, `status`, `error`, `aiAvailable`, `online` |
| Side select | `../scenes/SideSelectScene.ts` | `lobby`, `roomCode`, `error` |
| HUD: the game view on the left with a label on each edge; one column on the right: side, the cube (it turns with the compass drift), face, puzzle progress (`solved` of `puzzleTotal`, then PORTAL OPEN), carried item, objective, voice, clock (strikes only once there are any), chat | `cubicUI.ts` | `hud` |
| Chat: Enter opens, Esc closes, AI lines labelled, typing indicator | `cubicUI.ts` | `chat`, `partnerTyping` |
| Voice: mic permission, hold V / open mic, mute, signal bars, speaking dots | `cubicUI.ts` | `voice`, the settings |
| Room code (top middle, from the side select on) and settings gear (top right, always). In game the top bar is the head of the column | `cubicUI.ts` | `roomCode`, `mode` |
| The ending's title card: "Passed cube 1!", time, strikes, Main menu / Play again (shown when the sequence in `scenes/ending` gets to it) | `cubicUI.ts` | `hud.won`, `hud.elapsedMs`, `hud.strikes`, `scenes/ending/run.ts` |

| Pause menu (Esc): Resume, Settings, Leave, the controls reference | `pauseMenu.ts` | |
| Quick-chat bubbles over the game view | `cubicUI.ts` | `signals` |
| Captions and the "Partner speaking" tag | `captions.ts` (store), `cubicUI.ts` | |

Which key does what is the player's choice (`../input/bindings.ts`, changed in the settings'
CONTROLS tab): every key path asks `gameAction(e)` and every place that shows a key reads
the live binding (`keyLabel(action)`). Esc, Enter and the arrow keys are fixed. Gamepad and
touch are not rebindable: they send synthetic key events, which are always read with the
default keys (or use `sendAction(action, 'keydown' | 'keyup')`).

Text: `css.ts` has two units. `4u` is art pixels at the UI scale (art, gaps), `4t` is art
pixels at the text scale (all text, and every box that holds text), which the Text size
setting moves one whole step down (S) or up (L). The Phaser menus (title, mode, join popup,
side select) are bitmap text placed by hand on a 480x270 screen and do not scale.

Movement keys (WASD / arrows by default), pick up, drop and push to talk are handled by the
game (`../game/keys.ts`, buffered during a face transition), not the UI. While a text input is focused, a panel is open or Tab holds the cube map
(`../input/gate.ts`) the game ignores them. Every other key is the UI's: what a key means
is in `../input/keymap.ts` (pure, tested), `cubicUI.ts` acts on it (quick chat, mute, the cube map, Esc pause: Esc first closes the
side card if it is up), and `focus.ts` keeps the keyboard focus
inside the open panel. The gamepad (`../input/gamepad.ts`) sends the same keys.

Captions: `showCaption(text, { speaker?, ms? })` and `clearCaption()` from `captions.ts`
show one line at the bottom of the screen; call them from anywhere (the narrator does).

Settings rows are data: add a line to `ROWS` in `settingsPanel.ts`.

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

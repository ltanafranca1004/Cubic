# Cubic menu design

The screens before the game, the HUD during it, and how one becomes the next.
Colours, type and the UI kit are in [style.md](style.md). Screenshots of everything are in
[screens/](screens/).

## 1. What we took from other games

Notes from looking at how well-loved pixel games handle their front ends. Sources that were
actually read for this are linked; the rest is from knowing the games, and says so.

- **One resolution, whole-number scaling.** Pixel UI is designed on a small base canvas
  (320x180 or 640x360 are the usual ones) and scaled by integers so 720p, 1080p and 4K all
  stay crisp. We use a 480x270 minimum and let the logical screen grow up to the next
  integer step. (Read: a summary of pixel art UI base resolutions found through search;
  the 480x270 choice is ours, it is the base that still fits the 192px game view (12 tiles) with a
  panel on each side.)
- **No mixels.** Mixing pixel sizes on one screen is the fastest way to look unfinished.
  The one place we show art larger than 1:1 is the side select diorama, and there the
  whole diorama (cube and character together) is one zoomed block at a whole multiple, the
  way a game shows its own world closer up. (From general pixel art practice.)
- **A limited palette is the art direction.** Celeste, Shovel Knight and Stardew Valley
  all read as one world because every screen uses the same few ramps. Resurrect 64 gives
  us that for free, and the generator enforces it. (From knowing the games.)
- **Title screens that move.** A static logo on a flat colour reads as a placeholder.
  Layered clouds at different speeds (parallax) make a sky feel deep with four sprites.
  The far layer is small and slow, the near layer large and fast. (From knowing the genre:
  Celeste's and A Short Hike's title screens both sit on a living scene.)
- **A transition is a place, not a fade.** The best menu transitions tell you where you
  went. Ours says: you were above the clouds, you dove, and the world is below you. That
  is also the game's premise: the cube seen from outside.
- **Side by side character select (NBA 2K Blacktop).** In 2K's Blacktop and Play Now
  screens both players' controller icons start in the middle and are moved left or right
  onto a team; two icons on one screen, one shared truth, no menu to read. We copied the
  mechanics exactly: markers start in the middle, A/D moves one step at a time through the
  middle, and a marker cannot land on a taken side. (From memory of the game; a search for
  a written reference found nothing usable, so treat the comparison as ours.)
- **Press feedback.** Every button has a pressed frame that is held for a beat before the
  action fires, so a click is seen as well as heard.

## 2. Screen flow

```
            Play (the dive)            Create / Join                host presses Start
  START  ------------------->  MODE  ----------------->  SIDE SELECT  ------------------>  GAME
                                 |                         ^   |                            |
                                 |  Join opens a popup     |   | Leave                      | Leave
                                 |  (stays on MODE)        +---+----> MODE                  v
                                 |                                                         MODE
                                 +--- Play Outside / Inside with AI ------------------->  GAME
```

- The state decides the screen (`scenes/flow.ts`): in a game means the game; in a lobby
  means side select; otherwise the mode screen, or the title if Play was never pressed.
  So a refresh in a lobby or a game lands on the right screen with no extra code.
- **AI modes go straight to the game.** The button already says which side you play, there
  is nobody to wait for and nothing to ready, so a side select with both sides locked
  would be a screen with one button. The server puts AI rooms straight into `playing`.
- The settings gear is top right on every screen. The room code is top middle from the
  side select onward, also in the game (AI games show `SOLO AI` there).

Scenes live in one full-window Phaser canvas (`scenes/stage.ts`). The gear, the room code
and the whole HUD are DOM on top of it, built from the same PNGs at the same scale.

## 3. Screens

All sketches are the 480x270 logical screen. Larger windows keep the same anchors
(centre, corners) and get more sky.

### START

```
+----------------------------------------------------------[gear]+
|   .--.            .---.                    .--.                |   far clouds, slow
|              .-----.          .--.                             |
|                  +---------------------------+                 |
|      .----.      |   C U B I C   (logo)      |      .---.      |   logo floats 2px
|                  +---------------------------+                 |
|                    TWO PLAYERS. ONE CUBE.                      |
|   .-------.              [   PLAY   ]              .------.    |   Enter or Space
|                                                                |
|        .----------.                      .---------.           |   near clouds, fast
+----------------------------------------------------------------+
```

- Sky: `skyTop` down to a pale horizon, dithered steps. 4 cloud layers drifting right at
  3, 6, 10 and 16 px/s. Clouds are placed by a seeded generator, so the screen is the same
  for everyone.
- One button. Nothing else to read.

### The dive (START to MODE), 1200 ms

```
 0 ms     Play is pressed (pressed frame for 90 ms). A second press does nothing.
 0-300    Logo, tagline and button lift 20% of the screen and fade.
 0-1200   Every cloud scales up (near ones more) and slides away from the centre line:
          left of centre goes left, right goes right. Cubic ease in: slow, then rushing.
 120-480  A cloud bank appears straight ahead and splits down the middle the same way.
 480-     MODE is already running underneath. The cube net grows from 30% to full size,
 1200     ease out, as if it were coming up at you.
 540-1080 The sky fades out; the white you fall into is the mode screen's own background.
 660-1140 Clouds fade as they leave.
 960-     The four buttons land, 50 ms apart, 10px up, 200 ms each.
 1200     START is stopped.
```

Pixel-crisp: sprites are scaled with nearest-neighbour and drawn on whole pixels; nothing
is blurred. Double clicks: the scene sets a `leaving` flag before anything else.

### MODE

```
+----------------------------------------------------------[gear]+
|                                                                |
|                          +----+                                |
|                          | 5  |              the cube net:     |
|                     +----+----+----+----+    the six real      |
|                     | 4  | 1  | 2  | 3  |    faces, 4px per    |
|                     +----+----+----+----+    map tile, 50%     |
|                          | 6  |              opacity, bobbing  |
|                          +----+              2px every 2.2 s   |
|                                                                |
|            [  CREATE LOBBY  ]   [   JOIN LOBBY   ]             |
|            [ PLAY OUTSIDE WITH AI ] [ PLAY INSIDE WITH AI ]    |
|                     status / error line                        |
+----------------------------------------------------------------+
```

- White background: after the dive you have landed somewhere new and calm.
- The net is drawn at runtime from `defaultEnv.world` and the real tilesets
  (`ModeScene.buildNet`), so when a map or a tile changes, this picture changes with it.
  Faces 4 1 2 3 are the cube's waist, 5 and 6 hang off face 1, each the right way up.
- Top row is "with a friend" (dark buttons). Bottom row is "alone", coloured by the side
  you would play: green outside, amber inside.
- Keyboard: arrows walk the 2x2 grid, Enter presses.

### JOIN popup

```
                 +------------------------------+
                 |          JOIN LOBBY          |
                 |  TYPE THE 4-LETTER ROOM CODE |
                 |    [Q] [Z] [K] [_]           |   28px boxes, x2 letters
                 |   ROOM NOT FOUND. CHECK ...  |   red, only after an error
                 |  [ CANCEL ]        [ JOIN ]  |
                 +------------------------------+
```

- A 35% ink veil, not a new screen: the cube net stays visible behind it.
- Letters only (anything else is dropped), upper-cased as typed, at most four. Enter
  joins, Esc cancels, Backspace deletes.
- A bad code (too short, not found, room full): the boxes turn red and shake three times
  (280 ms), and the reason is written under them. Typing again clears the error.
- Drops in from 8px above with a small overshoot, 200 ms.

### SIDE SELECT

```
+------------------------[ ROOM QZKP ]---------------------[gear]+
|        OUTSIDE              |               INSIDE             |
|     ON TOP OF THE CUBE      |          INSIDE THE CUBE         |
|       HOST (YOU)        +---------+           GUEST            |
|         [P1]            | < PICK >|            [P2]            |
|          v              | A SIDE  |             v              |
|      (explorer)         |         |       +-----------+        |
|    +-----------+        | A / D   |       |  grass    |        |
|    |  grass    |        | OR CLICK|       | +-------+ |        |
|    |  stone    |        +---------+       | |lantern| |        |
|    +-----------+                          +-----------+        |
|      sky, clouds                              [ READY ]        |
| [LEAVE]                          status text      [ START ]    |
+----------------------------------------------------------------+
```

- The screen is the pitch of the game: left half sky, right half dark. The same cube twice,
  whole on the left (stand on top), cut open on the right (stand inside). Both characters
  breathe.
- Markers (`P1` blue, `P2` pink) start in the middle panel and slide (140 ms) over the
  character their player picked. Above each: `HOST` / `GUEST`, with `(YOU)` on your own.
- A picked cube gets a frame in its player's colour, and its character hops.
- Pick with A/D or the arrow keys (one step at a time, through the middle), or click a
  cube, an arrow or the middle panel.
- A taken side: your marker shakes and the status line says who has it.
- Guest: `READY` (needs a side) toggles to `NOT READY`. The badge under P2's cube shows it
  to both players. Host: `START` stays disabled, with the reason in the status line
  (waiting for a second player / both need a side / P2 not ready), until the server would
  accept it. Only the host has Start.
- Everything on this screen is the server's lobby state (`UIState.lobby`). The client
  never guesses: a pick is shown when the server broadcasts it, so both screens match.

### GAME (HUD)

```
+-[LEAVE]----------------[ ROOM QZKP ]---------------------[gear]+
| +-----------+          [] 5 ROOFTOP           +-------------+  |
| | OUTSIDE   |      +------------------+       | clock  x 0  |  |
| | FACE 1    |  []  |                  |  []   +-------------+  |
| | GRASS     |  4   |   192x192 game   |  2    | YOU      ... |  |
| | DRIFT 90  |  F   |   view, same     |  D    | PARTNER |||  |  |
| |   [5]     |  O   |   pixel scale    |  E    | [MUTE][HOLD V]| |
| |[4][1][2][3]| R   |                  |  S    +-------------+  |
| |   [6]     |  E   +------------------+  E    | chat log    |  |
| +-----------+  S       [] 6 CAVE         R    |             |  |
| | objective |  T   WASD MOVE  E PICK UP  T    | [Enter to   |  |
| | carrying  |                                 |  chat     ] |  |
| +-----------+                                 +-------------+  |
+----------------------------------------------------------------+
```

(The sketch above is the first layout. Since the HUD rework the game view is on the left
at its own whole-number zoom and everything else is one column on the right; pictures in
`docs/screens/hud/`.)

- Left: the game view, as large as the window allows, with a label on each of its four
  edges: the chip (colour and number) and the name of the face across that edge.
- Right, one column, top to bottom: leave / room code / gear; who and where you are (side,
  the cube turning with the compass drift, face chip and name, puzzles solved of the total
  with a pip per face, what you carry, the objective); voice (speaking dots, signal bars,
  mic controls); the clock (strikes only once there are any); chat.
- Outside player: light panels on the sky. Inside player: dark panels in the dark.
- Banner under the room code for "connection lost" and "partner left".
- Win: a panel over the game: THE CUBE OPENS, the time, Leave / Play again.

### SETTINGS (every screen)

```
                 +--------------------------------+
                 |            SETTINGS            |
                 | (spk) MASTER VOLUME  ====o 100 |
                 | (mus) MUSIC          =o---  60 |
                 | (sfx) SOUND EFFECTS  ====o 100 |
                 | ------------------------------ |
                 | (cht) PROXIMITY CHAT      [on] |
                 | (spk) CHAT VOLUME    ====o 100 |
                 | (mic) MUTE MY MIC        [off] |
                 |            [ DONE ]            |
                 +--------------------------------+
```

- The gear is in the same corner on every screen and lights up while the panel is open.
  Esc, Done or a click outside closes it.
- Every control applies at once (`style/settings.ts`) and lasts for the session. Volumes
  go to the AudioManager through `style/audioApi.ts`; proximity chat, its volume and the
  mic mute go to the existing `Voice` class through `onSetPartnerVolume` and `onSetMuted`.
  Proximity chat off means volume 0 and mic muted; on restores both.
- The in-game Mute button and the panel's "Mute my mic" are the same setting.

## 4. Timings

All in `tokens.ts` `TIME`. Short, because menus are in the way of the game.

| Token | ms | What |
| --- | --- | --- |
| `press` | 90 | pressed frame before a button's action fires |
| `quick` | 140 | marker slide, hop, popup closing |
| `panel` | 200 | popup and panel opening, buttons landing |
| `shake` | 280 | error shake, 3 swings of 4px |
| `scene` | 360 | menu to menu: fade out through white, fade in |
| `enterGame` | 480 | into the game: through white for the outside, through ink for the inside |
| `dive` | 1200 | START to MODE |
| `idleFrame` | 420 | character breathing |
| `cloudSpeed` | 3 / 6 / 10 / 16 px/s | cloud layers, far to near |

Easing: things arriving use cubic ease out, things leaving and the dive use cubic ease in,
popups use back ease out (a small overshoot). Idle motion is a slow sine landing on whole
pixels.

## 5. Why it is built this way

- **Phaser for the menus, DOM for the HUD.** The menus need tweened sprites (clouds, the
  dive, markers). The HUD needs wrapping text, a scrolling chat and a text input, which
  the DOM does well. Both use the same PNG kit at the same scale, so you cannot see the
  seam.
- **The game view was not rebuilt.** It plugs in a new `ArtProvider` (`style/art.ts`) that
  reads `assets/manifest.json`, and falls back to the old code-drawn art for anything
  missing.
- **The lobby is the server's.** Host, guest, picks, ready and start are rules in
  `server/src/rooms.ts` with tests. The scenes only draw `UIState.lobby`.
- **Audio is an interface.** The UI sets volumes through `style/audioApi.ts`; `main.ts`
  plugs the real AudioManager into it with `setAudioApi()`. Which track plays on which
  screen is decided in `app.ts` (menu, lobby once you are in a room, then your side).

## Update: mode menu, AI deferred, renderer-proof kit

- **Mode screen** is now a small `SELECT MODE` title over one vertical menu, with the
  cube net large and faded (22%) behind it. Buttons are solid yellow panels with ink
  text, an ink outline and a drop shadow. No white text on light backgrounds.
- **AI buttons are hidden** behind `ENABLE_AI` in `client/src/config.ts` (false). The AI
  code, tests and server logic are untouched; set it to true to bring the two buttons back.
- **The kit no longer depends on WebGL.** A browser without WebGL makes Phaser use its
  Canvas renderer, which cannot tint bitmap text, draw text shadows or draw NineSlice
  objects: panels vanished and all text went white. Text colour and outline are now baked
  into per-colour copies of the font, and 9-slice boxes are composited into plain
  textures (`client/src/scenes/kit.ts`). `?renderer=canvas` forces the fallback.
- **Text over sky or art has a 1px ink outline** (tagline, side titles, status lines).
- **Play** is larger (136x34, double-size label) with a slow glow behind it.
- `tools/screens/check.ts` clicks through the menus with a mouse in both renderers.
  Screenshots 10 and up in `docs/screens` predate this update.

## Update: the cube behind the menus and in the HUD

- **One cube, always turning.** `CubeBackdropScene` sits under the title, the mode screen,
  the join popup and the side select and is never stopped between them. Menu to menu, only
  the menu fades (camera alpha); the cube glides to its place for the next screen. Into and
  out of the game the whole stage still goes through white or ink.
- **Drawn by `client/src/cube`**: a small software rasterizer (backface culling, painter's
  order, nearest-neighbour, one flat shade per face, a 1px ink outline) over six textures
  baked from the real maps, tiles, objects and the turtle. It writes plain pixels, so WebGL
  and Canvas show the same cube. The faces are baked once and the cube is redrawn live 15 times a second (one turn in 48 s).
  A turntable alone never shows the cave underneath, so the cube also rolls half over twice
  per turn: all six biomes come past.
- **Title**: sky and far clouds behind the cube, near clouds in front of it, logo and Play
  on top of everything. **Dive**: the far clouds part too, the cube comes up at the camera
  and settles to the right of the mode screen. **Mode**: white, `SELECT MODE` and the
  buttons on a panel left of centre. **Side select**: the cube stays in the middle at 40%.
- **HUD**: the flat net is now a cube that shows your face flat on, your up at the top,
  with the faces above and to the right in view. Chips on the four edges name the face in
  each direction; the chip on the way to your partner blinks in their colour, and their
  face has a pulsing marker when it is in view. Solved faces get a green frame, the open
  portal a violet one, and six pips under the cube keep the whole progress in sight.
  Crossing an edge turns the cube a quarter the way you walked (400 ms, eased; a snap with
  reduce motion). The cube map (`cube/api.ts`) is the same cube, larger, turned by hand.
- Check and film it: `tools/screens/cube.ts` (screenshots and GIFs in `docs/screens/cube`).

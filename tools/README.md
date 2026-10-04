# /tools

Dev-only tools for the visual design. Not a workspace and not needed to run the game:

```
cd tools
npm install
```

## `npm run art`: the art generator

Writes every PNG in `client/public/assets` (`tiles/`, `sprites/`, `ui/`, `fonts/m5x7.png`)
and `manifest.json` from code. Colours come from `client/src/style/tokens.ts`, so changing
a token and running this recolours the art. The run fails if any PNG has a colour that is
not in the Resurrect 64 palette.

| File | Makes |
| --- | --- |
| `art/build.ts` | runs everything, writes the manifest, checks the palette |
| `art/img.ts` | the tiny pixel canvas the rest draws on |
| `art/font.ts` | m5x7.ttf to a bitmap font (PNG + XML) |
| `art/tiles.ts` | the twelve face tilesets (outside: Ninja Adventure tiles recoloured; inside: ours) |
| `art/sprites.ts` | the two characters, puzzle objects, items |
| `art/ui.ts` | panels, buttons, fields, sliders, icons, cursor, markers, badges |
| `art/scenery.ts` | sky, clouds, logo, the two side select cubes |
| `art/vendor/ninja-adventure/` | the CC0 source sheets the tiles are cut from |

Helpers for looking at art: `art/preview.ts` (all twelve faces from the real maps),
`art/sheet.ts` (any PNGs on one sheet, scaled up), `art/peek.ts` (a tileset with a
labelled grid).

## `npm run screens`: screenshots and the end-to-end check

Needs a running server and client (see the top of `screens/shoot.ts`) and
`npx playwright install chromium` once. It drives two real browser clients through
create, wrong code, join, pick, side taken, ready, leave, rejoin, refresh and start, both
AI modes, every face on both sides and the win screen, asserting each step, and writes the
pictures and the cloud dive GIF to `docs/screens`. `npm run screens -- flow` (or `faces`,
`ai`, `gif`) runs one part.

## `npx tsx screens/transitions.ts`: the face transitions, in both renderers

Two real clients in one room, once in WebGL and once in Canvas: both players cross all
four edges with the keyboard. It asserts that the transition plays, that keys pressed
during it are applied afterwards (none dropped), that partner updates keep arriving, that
client and server agree, and the sound rules (partner footsteps only on the same face
number, never their face-change ding). Then it records the roll (outside), the hop
(inside) and the reduce-motion fade as GIFs into `docs/screens/transitions/`.
`npx tsx screens/transitions.ts live` (or `gifs`) runs one part. Needs a running server
and client (see the top of the file) and ffmpeg for the GIFs.

## `npx tsx screens/check.ts`: the mouse check, in both renderers

Clicks through Play, the mode menu, the join popup (wrong code, then a real one from a
second client), side select, ready, start and settings with a real mouse, at 1920x1080 and
1280x720, once in WebGL and once in Phaser's Canvas fallback (`?renderer=canvas`, what a
browser without WebGL gets). It fails on any console error, any button that is missing,
see-through, without a panel or dead, and any step that does not arrive. Pictures go to
`docs/screens/check/`. Needs `npm run dev` running.

## `npx tsx screens/hud.ts`: the in-game HUD, in both renderers

Checks the in-game layout and takes its pictures: the game view at its own whole-number
zoom (x5 at 1920x1080, x3 at 1280x720) left of ONE column, both sides, WebGL and Canvas,
from the offline game and from a real two-client game, plus 844x390. It fails if anything
overlaps, is cut off or leaves the window, if the canvas is not on whole pixels, if a face
chip has the wrong colour, or if progress, PORTAL OPEN or the win screen are wrong.
Pictures go to `docs/screens/hud/`. Needs a server with `DEV_COMMANDS=1` and a client (ports
at the top of the file); `npx tsx screens/hud.ts mock` (or `real`) runs one part.

## `npx tsx screens/a11y.ts`: the keyboard-only check

Plays the whole game without a mouse: title, settings by keyboard, mode menu and Back, the
join popup, side select, then two clients in a real game (chat, quick chat, Tab,
pause, accessibility settings, captions, Leave), E / Q on an item, and a faked gamepad.
Menus run in WebGL and in Canvas. Pictures go to `docs/screens/a11y/`. Needs a server and
a client (ports at the top of the file); `npx tsx screens/a11y.ts game` runs one part
(`menus`, `game`, `items`, `gamepad`).

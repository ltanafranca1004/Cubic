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

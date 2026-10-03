// THE ART GENERATOR. Writes every PNG in client/public/assets (and manifest.json) from
// code, so the art is reviewable, diffable and always on-palette.
//
//   cd tools && npm install && npm run art
//
// Sources: our own pixel art in this folder, the m5x7 font and a few Ninja Adventure
// tiles (both CC0, see CREDITS.md). Colours come from client/src/style/tokens.ts.
import { readdirSync, writeFileSync } from 'node:fs';
import { R64 } from '../../client/src/style/tokens';
import { buildFont } from './font';
import { Img } from './img';
import { buildScenery } from './scenery';
import { buildSprites } from './sprites';
import { buildTiles } from './tiles';
import { buildUi } from './ui';

const ASSETS = new URL('../../client/public/assets', import.meta.url).pathname;
/** Folders the generator owns: every PNG in them is ours to write and to check. */
const FOLDERS = ['tiles', 'sprites', 'ui', 'fonts'];

buildFont(`${ASSETS}/fonts/m5x7.ttf`, ASSETS); // first: the badges are drawn with it
const ui = buildUi(ASSETS);
buildScenery(ASSETS);
const sprites = buildSprites(ASSETS);

const manifest = {
  tileSize: 16,
  tilesets: buildTiles(ASSETS),
  ...sprites,
  ui: { icons: ui.icons },
  audio: {},
};
writeFileSync(`${ASSETS}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');

// Every pixel we ship is a Resurrect 64 colour. Fail loudly if one is not.
const palette = new Set<string>(R64);
let files = 0;
for (const folder of FOLDERS)
  for (const file of readdirSync(`${ASSETS}/${folder}`).filter((f) => f.endsWith('.png') && f !== 'template.png')) {
    // (tiles/template.png is the map editor's placeholder tileset from /maps, not game art)
    files++;
    const off = [...Img.load(`${ASSETS}/${folder}/${file}`).colours()].filter((c) => !palette.has(c));
    if (off.length) throw new Error(`${folder}/${file} has off-palette colours: ${off.join(' ')}`);
  }
console.log(`art written to ${ASSETS}: ${files} PNGs, all on palette`);

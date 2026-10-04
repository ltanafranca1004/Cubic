import type Phaser from 'phaser';
import { TILE_PX, defaultEnv, type FaceId, type Side, type TileKind, type Vec } from '@cubic/shared';
import type { ArtProvider } from '../game/art';
import { WALK_HOLD_MS, hasFacing, playerFrames, type Facing, type PlayerFrames } from '../game/turtle';
import { dressed } from '../world/biomes/decor';
import { dressFace, type PropPass } from '../world/biomes/dress';
import { asset } from './assets';
import { settings } from './settings';
import { TIME } from './tokens';

// REAL ART for the game view. Reads assets/manifest.json and cuts the sheets it lists into
// 16x16 textures. Anything the manifest does not cover, and everything until the sheets
// have loaded, comes from the fallback provider (the code-drawn placeholders), so a
// missing file never breaks the game.

type Frames = number | number[];

interface Manifest {
  tilesets?: Record<string, { image: string; tiles: Partial<Record<TileKind, number[]>> }>;
  objects?: Record<string, { image: string; frames: Record<string, Frames>; sides?: Partial<Record<Side, Record<string, Frames>>> }>;
  items?: Record<string, { image: string; frame: number }>;
  /** The characters: frames by direction when the sheet has them (game/turtle.ts PlayerFrames). */
  players?: Partial<Record<Side, PlayerFrames>>;
  /** The biome layer of the outside faces: see world/biomes. */
  biomes?: { props: { image: string }; water: { image: string } };
}

const T = TILE_PX;
const hash = (f: number, x: number, y: number) => ((f * 73856093) ^ (x * 19349663) ^ (y * 83492791)) >>> 0;

export class SheetArt implements ArtProvider {
  private manifest: Manifest | null = null;
  private sheets = new Map<string, HTMLImageElement>();
  private lastStep: Record<Side, { step: number; at: number }> = { out: { step: -1, at: 0 }, in: { step: -1, at: 0 } };

  constructor(
    private textures: Phaser.Textures.TextureManager,
    private fallback: ArtProvider,
  ) {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const manifest = (await (await fetch(asset('manifest.json'))).json()) as Manifest;
      const paths = new Set<string>();
      for (const t of Object.values(manifest.tilesets ?? {})) paths.add(t.image);
      for (const o of Object.values(manifest.objects ?? {})) paths.add(o.image);
      for (const i of Object.values(manifest.items ?? {})) paths.add(i.image);
      for (const p of Object.values(manifest.players ?? {})) if (p) paths.add(p.image);
      if (manifest.biomes) paths.add(manifest.biomes.props.image).add(manifest.biomes.water.image);
      await Promise.all(
        [...paths].map(
          (path) =>
            new Promise<void>((done) => {
              const img = new Image();
              img.onload = () => {
                this.sheets.set(path, img);
                done();
              };
              img.onerror = () => done(); // that sheet stays on the fallback art
              img.src = asset(path);
            }),
        ),
      );
      this.manifest = manifest;
    } catch (e) {
      console.warn('[art] no manifest, using placeholder art', e);
    }
  }

  /** One frame of a sheet as its own texture (the scene draws whole textures by key). */
  private frame(path: string, index: number): string | null {
    const img = this.sheets.get(path);
    if (!img) return null;
    const key = `art:${path}:${index}`;
    if (!this.textures.exists(key)) {
      const cols = Math.floor(img.width / T);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = T;
      canvas.getContext('2d')!.drawImage(img, (index % cols) * T, Math.floor(index / cols) * T, T, T, 0, 0, T, T);
      this.textures.addCanvas(key, canvas);
    }
    return key;
  }

  private static pick(frames: Frames | undefined, tick: number): number | null {
    if (frames === undefined) return null;
    return typeof frames === 'number' ? frames : (frames[tick % frames.length] ?? null);
  }

  /** The two biome sheets, once both have loaded. */
  private biomeSheets(): { props: HTMLImageElement; water: HTMLImageElement } | null {
    const b = this.manifest?.biomes;
    const props = b && this.sheets.get(b.props.image);
    const water = b && this.sheets.get(b.water.image);
    return props && water ? { props, water } : null;
  }

  tile(side: Side, face: FaceId, kind: TileKind, x: number, y: number, frame: number): string {
    // Outside, water and anything with a biome skin (a tree, a landmark) is plain ground
    // here: dress() draws the real thing on top of it.
    if (side === 'out' && kind !== 'floor' && this.biomeSheets() && dressed(defaultEnv.world.out[face].tiles, face, x, y)) kind = 'floor';
    const set = this.manifest?.tilesets?.[`${side}-${face}`];
    const list = set?.tiles[kind];
    if (set && list?.length) {
      // water animates through its frames; everything else varies by position
      const index = kind === 'water' ? list[frame % list.length]! : list[hash(face, x, y) % list.length]!;
      const key = this.frame(set.image, index);
      if (key) return key;
    }
    return this.fallback.tile(side, face, kind, x, y, frame);
  }

  object(side: Side, type: string, state: string | undefined, frame: number): string {
    const entry = this.manifest?.objects?.[type] ?? this.manifest?.objects?.unknown;
    if (entry) {
      const frames = entry.sides?.[side] ?? entry.frames;
      const index = SheetArt.pick(frames[state ?? 'default'] ?? frames.default, frame);
      const key = index === null ? null : this.frame(entry.image, index);
      if (key) return key;
    }
    return this.fallback.object(side, type, state, frame);
  }

  item(kind: string): string {
    const entry = this.manifest?.items?.[kind] ?? this.manifest?.items?.default;
    const key = entry ? this.frame(entry.image, entry.frame) : null;
    return key ?? this.fallback.item(kind);
  }

  player(side: Side, step: number, facing: Facing = 'down'): string {
    const entry = this.manifest?.players?.[side];
    if (entry) {
      // The scene only tells us the step count: walk while it changes, breathe when it rests.
      const last = this.lastStep[side];
      const now = performance.now();
      if (last.step !== step) this.lastStep[side] = { step, at: now };
      const walking = now - this.lastStep[side].at < WALK_HOLD_MS && last.step !== -1;
      const list = playerFrames(entry, facing, walking);
      const index = list[(walking ? step : Math.floor(now / TIME.idleFrame)) % list.length];
      const key = index === undefined ? null : this.frame(entry.image, index);
      if (key) return key;
    }
    return this.fallback.player(side, step, facing);
  }

  dress(g: CanvasRenderingContext2D, side: Side, face: FaceId, up: Vec, frame: number, pass?: PropPass): void {
    const sheets = side === 'out' ? this.biomeSheets() : null;
    if (sheets) dressFace(g, sheets, face, up, frame, settings().reduceMotion, pass);
  }

  playerWalk(side: Side, facing: Facing, tick: number): string | null {
    const entry = this.manifest?.players?.[side];
    if (!entry || !hasFacing(entry)) return null;
    const list = playerFrames(entry, facing, true);
    const index = list[tick % list.length];
    return index === undefined ? null : this.frame(entry.image, index);
  }

  playerFacing(side: Side): boolean {
    const entry = this.manifest?.players?.[side];
    // (no sheet, no directions: the fallback art is drawn instead)
    return !!entry && hasFacing(entry) && this.sheets.has(entry.image);
  }
}

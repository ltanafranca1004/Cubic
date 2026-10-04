import type Phaser from 'phaser';
import { TILE_PX, type FaceId, type Side, type TileKind } from '@cubic/shared';
import type { ArtProvider } from '../game/art';
import { asset } from './assets';
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
  players?: Partial<Record<Side, { image: string; idle?: number[]; walk: number[] }>>;
}

const T = TILE_PX;
const hash = (f: number, x: number, y: number) => ((f * 73856093) ^ (x * 19349663) ^ (y * 83492791)) >>> 0;

/** How long after the last step the player still shows the walk frame. */
const WALK_HOLD_MS = 260;

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

  tile(side: Side, face: FaceId, kind: TileKind, x: number, y: number, frame: number): string {
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

  player(side: Side, step: number): string {
    const entry = this.manifest?.players?.[side];
    if (entry) {
      // The scene only tells us the step count: walk while it changes, breathe when it rests.
      const last = this.lastStep[side];
      const now = performance.now();
      if (last.step !== step) this.lastStep[side] = { step, at: now };
      const walking = now - this.lastStep[side].at < WALK_HOLD_MS && last.step !== -1;
      const list = walking || !entry.idle?.length ? entry.walk : entry.idle;
      const index = walking ? list[step % list.length]! : list[Math.floor(now / TIME.idleFrame) % list.length]!;
      const key = this.frame(entry.image, index);
      if (key) return key;
    }
    return this.fallback.player(side, step);
  }

  playerFrame(side: Side, index: number): string | null {
    const entry = this.manifest?.players?.[side];
    return entry ? this.frame(entry.image, index) : null;
  }
}

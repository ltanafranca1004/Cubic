import type Phaser from 'phaser';

/**
 * Give a Phaser canvas its size: `width` x `height` art pixels, shown at `zoom`.
 *
 * Both canvases run Scale.NONE, where Phaser only writes the CSS size in some cases (not
 * at zoom 1, and from the OLD size when the zoom changes first), which left a canvas with
 * a new backing store shown in its old box: stretched, and covering part of the window.
 * So the CSS size is written here, every time, from the same two numbers as the backing
 * store: the box always has the picture's own aspect.
 */
export function sizeCanvas(game: Phaser.Game, width: number, height: number, zoom: number): void {
  if (!game.isBooted || !game.canvas) return;
  if (game.scale.width !== width || game.scale.height !== height) game.scale.resize(width, height);
  if (game.scale.zoom !== zoom) game.scale.setZoom(zoom);
  game.canvas.style.width = `${width * zoom}px`;
  game.canvas.style.height = `${height * zoom}px`;
}

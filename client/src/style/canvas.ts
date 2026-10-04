import type Phaser from 'phaser';

/**
 * Give a Phaser canvas its size: `width` x `height` art pixels, shown at `zoom`.
 *
 * Both canvases run Scale.NONE, where Phaser only writes the CSS size in some cases (not
 * at zoom 1, and from the OLD size when the zoom changes first), which left a canvas with
 * a new backing store shown in its old box: stretched, and covering part of the window.
 * So the CSS size is written here, every time, from the same two numbers as the backing
 * store: the box always has the picture's own aspect.
 *
 * Phaser also MEASURES that box (inside resize and setZoom) to turn a tap into art pixels,
 * so it measured the old one, and at zoom 1 nothing ever made it look again: after a phone
 * was turned, or its toolbar slid away, every tap landed somewhere else and PLAY was dead
 * until the page was loaded again. So the box is measured here once more, after it is
 * written (syncBounds), and again at every press (watchBounds).
 */
export function sizeCanvas(game: Phaser.Game, width: number, height: number, zoom: number): void {
  if (!game.isBooted || !game.canvas) return;
  if (game.scale.width !== width || game.scale.height !== height) game.scale.resize(width, height);
  if (game.scale.zoom !== zoom) game.scale.setZoom(zoom);
  game.canvas.style.width = `${width * zoom}px`;
  game.canvas.style.height = `${height * zoom}px`;
  syncBounds(game);
  watchBounds(game);
}

/**
 * Tell Phaser where its canvas is on the page right now. What ScaleManager.refresh does to
 * its bounds, without the RESIZE event (which rebuilds the scene on screen).
 */
export function syncBounds(game: Phaser.Game): void {
  const scale = game.scale;
  if (!game.canvas || !scale) return;
  scale.updateBounds();
  const box = scale.canvasBounds;
  // (a canvas that is not laid out has no box: keep what was there)
  if (box.width > 0 && box.height > 0) scale.displayScale.set(scale.baseSize.width / box.width, scale.baseSize.height / box.height);
}

const watched = new WeakSet<Phaser.Game>();

/**
 * Measure the canvas again at every press, before Phaser reads it (the window hears a
 * press first). The canvas can move with nothing resized: the safe area arriving late, a
 * layout shift, a page that scrolled or was zoomed. One read of a box per press.
 */
function watchBounds(game: Phaser.Game): void {
  if (watched.has(game)) return;
  watched.add(game);
  const sync = () => syncBounds(game);
  const types = ['touchstart', 'pointerdown', 'mousedown'];
  for (const type of types) window.addEventListener(type, sync, { capture: true, passive: true });
  game.events.once('destroy', () => {
    for (const type of types) window.removeEventListener(type, sync, { capture: true });
  });
}

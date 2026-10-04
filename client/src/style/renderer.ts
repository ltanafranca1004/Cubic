import Phaser from 'phaser';

/**
 * Which Phaser renderer to use. AUTO picks WebGL and falls back to Canvas when the browser
 * has none (hardware acceleration off). `?renderer=canvas` forces the fallback, to check
 * that every screen still looks right without WebGL.
 */
export function rendererType(): number {
  return new URLSearchParams(location.search).get('renderer') === 'canvas' ? Phaser.CANVAS : Phaser.AUTO;
}

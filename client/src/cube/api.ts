// The big cube map (hold Tab). The cube renderer registers the real one; the key binding
// only ever calls this, so either side can land first.

export type CubeMapDir = 'left' | 'right' | 'up' | 'down';

export interface CubeMap {
  show(): void;
  hide(): void;
  rotate(dir: CubeMapDir): void;
}

let impl: CubeMap | null = null;

export function registerCubeMap(map: CubeMap): void {
  impl = map;
}

export const cubeMap: CubeMap = {
  show: () => impl?.show(),
  hide: () => impl?.hide(),
  rotate: (dir) => impl?.rotate(dir),
};

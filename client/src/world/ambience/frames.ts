// Frames of client/public/assets/sprites/fx/fx.png (16x16 cells, 8 columns), in the order
// tools/ambience/make_fx.py draws them. The script prints this table: keep them in step.

export const FX_SHEET = 'sprites/fx/fx.png';
export const FX_CLOUD = 'sprites/fx/cloud-shadow.png';
export const FX_CELL = 16;

export const FX = {
  tuft: [0, 1, 2],
  flowerPink: [3, 4],
  flowerWhite: [5, 6],
  butterflyViolet: [7, 8],
  butterflyAmber: [9, 10],
  leaf: [11, 12, 13],
  leafGreen: [14, 15, 16],
  birdHop: [17, 18],
  birdFly: [19, 20],
  gull: [21, 22],
  shadow: [23],
  tumbleweed: [24, 25, 26, 27],
  flag: [28, 29, 30],
  splash: [31, 32, 33],
  puff: [34, 35, 36],
  sparkle: [37, 38, 39],
  shard: [40, 41, 42],
  sconce1: [43, 44, 45],
  sconce2: [46, 47, 48],
  sconce3: [49, 50, 51],
  sconce4: [52, 53, 54],
  sconce5: [55, 56, 57],
  sconce6: [58, 59, 60],
} as const satisfies Record<string, readonly number[]>;

export const FX_FRAME_COUNT = 61;

// Where the art lives and what is in it. The generator in /tools/art writes the files;
// this file names them for the scenes and the DOM UI.

/** URL of a file in client/public/assets. */
export const asset = (path: string): string => `${import.meta.env.BASE_URL}assets/${path}`;

/** Frames of ui/icons.png, in order (16x16 each). The generator draws them in this order. */
export const ICONS = ['mic', 'micOff', 'speaker', 'music', 'sfx', 'check', 'cross', 'clock', 'crown', 'lock', 'chat', 'ai', 'left', 'hand', 'right'] as const;
export type IconName = (typeof ICONS)[number];
export const iconIndex = (name: IconName): number => ICONS.indexOf(name);

export const BUTTON_VARIANTS = ['dark', 'light', 'out', 'in', 'danger'] as const;
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number];

/** Frames of sprites/player-*.png. */
export const PLAYER_FRAMES = { idle: [0, 1], walk: [2, 3] } as const;
/** Frames of sprites/items.png by item kind; anything else is the bundle. */
export const ITEM_FRAMES: Record<string, number> = { rose: 0, key: 1, battery: 3, 'flower-red': 4, 'flower-blue': 5, 'flower-yellow': 6, 'flower-pink': 7, 'flower-white': 8 };
export const ITEM_DEFAULT_FRAME = 2;

/** Every image the menu scenes load, by texture key. */
export const UI_IMAGES = {
  logo: 'ui/logo.png',
  sky: 'ui/sky.png',
  'cloud-1': 'ui/cloud-1.png',
  'cloud-2': 'ui/cloud-2.png',
  'cloud-3': 'ui/cloud-3.png',
  'cloud-4': 'ui/cloud-4.png',
  'cube-out': 'ui/cube-out.png',
  'cube-in': 'ui/cube-in.png',
  panel: 'ui/panel.png',
  'panel-dark': 'ui/panel-dark.png',
  field: 'ui/field.png',
  'field-active': 'ui/field-active.png',
  'field-error': 'ui/field-error.png',
  tag: 'ui/tag.png',
  'tag-light': 'ui/tag-light.png',
  'marker-p1': 'ui/marker-p1.png',
  'marker-p2': 'ui/marker-p2.png',
  ready: 'ui/ready.png',
  'not-ready': 'ui/not-ready.png',
  'btn-disabled': 'ui/btn-disabled.png',
} as const;

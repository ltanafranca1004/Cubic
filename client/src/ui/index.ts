import { cubicUI } from './cubicUI';
import type { UIHost } from './hooks';

export * from './hooks';

// The active UI. (The first placeholder UI is still in ../lobby as a reference.)
export const ui: UIHost = cubicUI;

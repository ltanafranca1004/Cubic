import { cubicUI } from './cubicUI';
import type { UIHost } from './hooks';
import { withMobile } from './mobile';

export * from './hooks';

// The active UI. (The first placeholder UI is still in ../lobby as a reference.)
// On a touch screen it also gets the touch layer (./mobile); on a desktop nothing changes.
export const ui: UIHost = withMobile(cubicUI);

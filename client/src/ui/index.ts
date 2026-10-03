import { placeholderUI } from '../lobby';
import type { UIHost } from './hooks';

export * from './hooks';

// The active UI. Swap `placeholderUI` for your own UIHost to replace the whole UI.
export const ui: UIHost = placeholderUI;

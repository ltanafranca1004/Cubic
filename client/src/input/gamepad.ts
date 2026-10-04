import { padEdges, padInputs, padKey, type PadInput } from './keymap';

// Gamepad: the standard Gamepad API, polled once a frame. The pad does not get its own
// code paths: every input is sent as the key it stands for (keymap.ts padKey), so the
// menus, the panels and the game react exactly as they do to the keyboard.

export interface PadOptions {
  /** 'game' while playing with nothing open on top; 'menu' everywhere else. */
  where(): 'game' | 'menu';
}

export function mountGamepad(opts: PadOptions): () => void {
  let held: PadInput[] = [];
  /** The key each held input was sent as, so its release matches its press. */
  const sent = new Map<PadInput, string>();
  let frame = 0;

  const send = (type: 'keydown' | 'keyup', key: string) => {
    if (!key) return;
    const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
    target.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true }));
  };

  const poll = () => {
    frame = requestAnimationFrame(poll);
    const pad = [...(navigator.getGamepads?.() ?? [])].find((p) => p?.connected);
    const now = pad ? padInputs(pad) : [];
    const { down, up } = padEdges(held, now);
    held = now;
    for (const input of up) {
      send('keyup', sent.get(input) ?? '');
      sent.delete(input);
    }
    for (const input of down) {
      const key = padKey(input, opts.where());
      sent.set(input, key);
      send('keydown', key);
    }
  };
  frame = requestAnimationFrame(poll);
  return () => cancelAnimationFrame(frame);
}

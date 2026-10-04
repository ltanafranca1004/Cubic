import type { ChatMessage } from '@cubic/shared';

/**
 * A system line as THIS player reads it. The server names the player it is about by a
 * label (P1 / P2 in the lobby, OUTSIDE / INSIDE in a game), and the lobby's labels shift
 * when the host is removed: the one who stays, P2 until then, is P1 after it, so "P1 left"
 * would read as if they had left themselves. A line about the OTHER player (`system.id` is
 * not `me`) therefore says "Your partner"; a line about yourself keeps the server's words.
 * Pure: no clock, no socket.
 */
export function viewerNote(msg: ChatMessage, me: number | null): ChatMessage {
  const s = msg.system;
  if (!s || me === null || s.id === me) return msg;
  const who = 'Your partner';
  const text =
    s.kind === 'idle'
      ? `${who} is inactive, removed in ${msg.text.match(/\d+:\d\d$/)?.[0] ?? '0:00'}`
      : s.kind === 'back'
        ? `${who} is back`
        : s.kind === 'removed'
          ? `${who} left due to inactivity`
          : `${who} ${msg.text.endsWith(' left') ? 'left' : 'disconnected'}`;
  return { ...msg, text, system: { ...s, who } };
}

/**
 * The words of a line right now. A countdown (`idle`) is one line whose clock runs down
 * from `system.until` (this clock); every other line is its text.
 */
export function noteText(m: ChatMessage, now: number): string {
  const s = m.system;
  if (s?.kind !== 'idle' || s.until === undefined) return m.text;
  const secs = Math.max(0, Math.ceil((s.until - now) / 1000));
  return m.text.replace(/\d+:\d\d$/, `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`);
}

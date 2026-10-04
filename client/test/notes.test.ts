import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChatMessage, SystemNote } from '@cubic/shared';
import { noteText as chatText, viewerNote } from '../src/net/notes';

// Inactivity lines, as each player reads them. The server names a player by a label
// (P1 / P2 in the lobby, OUTSIDE / INSIDE in a game); the one who stays must never read a
// label, because P2 becomes P1 the moment the host is removed.

const NOW = 1_000_000;
/** A system line as the server sends it, about member `id`. */
const note = (kind: SystemNote['kind'], who: string, id: number, text: string): ChatMessage => ({
  id: 7,
  from: 'out',
  isAI: false,
  text,
  at: NOW,
  system: kind === 'idle' ? { kind, who, id, until: NOW + 60_000, now: NOW } : { kind, who, id, now: NOW },
});
const HOST = 1;
const GUEST = 2;

test('notes: the player who stays reads "Your partner ...", never a label', () => {
  for (const who of ['P1', 'P2', 'OUTSIDE', 'INSIDE']) {
    assert.equal(viewerNote(note('idle', who, HOST, `${who} inactive, removed in 1:00`), GUEST).text, 'Your partner is inactive, removed in 1:00');
    assert.equal(viewerNote(note('back', who, HOST, `${who} is back`), GUEST).text, 'Your partner is back');
    assert.equal(viewerNote(note('removed', who, HOST, `${who} left due to inactivity`), GUEST).text, 'Your partner left due to inactivity');
    assert.equal(viewerNote(note('gone', who, HOST, `${who} disconnected`), GUEST).text, 'Your partner disconnected');
    assert.equal(viewerNote(note('gone', who, HOST, `${who} left`), GUEST).text, 'Your partner left');
  }
  const seen = viewerNote(note('removed', 'P1', HOST, 'P1 left due to inactivity'), GUEST);
  assert.deepEqual([seen.id, seen.system!.who, seen.system!.id, seen.system!.kind], [7, 'Your partner', HOST, 'removed']); // same line, same member
  assert.ok(!/\bP[12]\b|OUTSIDE|INSIDE/.test(seen.text));
});

test('notes: a line about yourself keeps the server\'s words (also the human in a solo room), and so does a chat line', () => {
  const own = note('idle', 'OUTSIDE', HOST, 'OUTSIDE inactive, removed in 1:00');
  assert.equal(viewerNote(own, HOST), own);
  const back = note('back', 'P2', GUEST, 'P2 is back');
  assert.equal(viewerNote(back, GUEST), back);
  const said: ChatMessage = { id: 1, from: 'in', isAI: false, text: 'P1 left due to inactivity', at: NOW };
  assert.equal(viewerNote(said, GUEST), said); // somebody typed it: not a system line
  assert.equal(viewerNote(own, null), own); // no seat yet: nothing to compare with
});

test('notes: the countdown runs down in place, in the words the viewer got', () => {
  const theirs = viewerNote(note('idle', 'P1', HOST, 'P1 inactive, removed in 1:00'), GUEST);
  assert.equal(chatText(theirs, NOW), 'Your partner is inactive, removed in 1:00');
  assert.equal(chatText(theirs, NOW + 55_500), 'Your partner is inactive, removed in 0:05');
  assert.equal(chatText(theirs, NOW + 90_000), 'Your partner is inactive, removed in 0:00');
  const own = note('idle', 'OUTSIDE', HOST, 'OUTSIDE inactive, removed in 1:00');
  assert.equal(chatText(viewerNote(own, HOST), NOW + 30_000), 'OUTSIDE inactive, removed in 0:30');
  assert.equal(chatText(viewerNote(note('removed', 'P1', HOST, 'P1 left due to inactivity'), GUEST), NOW + 5000), 'Your partner left due to inactivity');
});

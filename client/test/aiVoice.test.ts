import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { AI_VOICES, DEFAULT_AI_VOICE } from '@cubic/shared';

// The "Partner voice" setting: default Jessica, saved with the other settings (the same
// localStorage key), and anything that is not one of the known voices is the default.
// The store reads the browser's storage when it is imported, so the fake one comes first.

const saved = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => void saved.set(k, v) };
const { DEFAULT_SETTINGS, STORAGE_KEY, cleanSettings, onSettings, setSetting, settings } = await import('../src/style/settings');
const src = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('the default partner voice is Jessica', () => {
  assert.equal(DEFAULT_AI_VOICE, 'jessica');
  assert.equal(DEFAULT_SETTINGS.aiVoice, 'jessica');
  assert.equal(settings().aiVoice, 'jessica');
  assert.equal(cleanSettings(null).aiVoice, 'jessica');
  assert.equal(cleanSettings({ music: 0.2 }).aiVoice, 'jessica', 'settings saved before the picker existed');
});

test('a saved voice is kept only if it is one of the known voices', () => {
  assert.equal(cleanSettings({ aiVoice: 'wizard' }).aiVoice, 'wizard');
  for (const bad of ['JoYo65swyP8hH6fVMeTO', 'Wizard', 'someone', '', 3, null, true, ['wizard']]) assert.equal(cleanSettings({ aiVoice: bad }).aiVoice, 'jessica', JSON.stringify(bad));
});

test('the choice is saved with the other settings, told to listeners, and read back', () => {
  const heard: string[] = [];
  const off = onSettings((s) => void heard.push(s.aiVoice));
  setSetting('music', 0.1);
  setSetting('aiVoice', 'wizard');
  off();
  assert.deepEqual(heard, ['jessica', 'wizard']);
  const stored = JSON.parse(saved.get(STORAGE_KEY)!) as Record<string, unknown>;
  assert.equal(stored.aiVoice, 'wizard');
  assert.equal(stored.music, 0.1, 'in the same record as the rest');
  // what the next page load reads
  assert.deepEqual(cleanSettings(stored), { ...DEFAULT_SETTINGS, music: 0.1, aiVoice: 'wizard' });
  setSetting('aiVoice', 'jessica');
  assert.equal((JSON.parse(saved.get(STORAGE_KEY)!) as Record<string, unknown>).aiVoice, 'jessica');
});

test('the settings panel has a Partner voice row on the SOUND tab with every voice and a Play button', () => {
  const panel = src('ui/settingsPanel.ts');
  assert.match(panel, /section: 'sound', kind: 'choice', key: 'aiVoice', label: 'Partner voice'.*preview: true.*AI_VOICES\.map/);
  assert.match(panel, /data-preview/);
  assert.deepEqual(AI_VOICES.map((v) => v.label), ['Jessica', 'Wizard']);
  // the client names a voice by its key: no ElevenLabs id is ever sent
  assert.match(src('net/client.ts'), /emit\('ai:voice', \{ voice \}\)/);
});

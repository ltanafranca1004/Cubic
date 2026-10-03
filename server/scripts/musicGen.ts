import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

// Optional: generates alternative music with the ElevenLabs Music API into
// client/public/assets/audio/gen. The game ships with the CC0 Ninja Adventure tracks and
// does not need this. It prints the estimated cost first and only spends credits after a
// "y" (or --yes), and never above MUSIC_MAX_CREDITS.
//   npm run music:gen -w server            ask before generating
//   npm run music:gen -w server -- --yes   no question (still aborts above the limit)
//   npm run music:gen -w server -- --force regenerate files that already exist
//
// API (checked 2026-10-03): POST https://api.elevenlabs.io/v1/music?output_format=...
//   body { prompt, music_length_ms (3000..600000), model_id (music_v1 | music_v2 |
//   music_v2_5), force_instrumental }, answers with the audio file.
//   https://elevenlabs.io/docs/api-reference/music/compose
// "The Music API is available for paid subscribers."
//   https://elevenlabs.io/docs/eleven-creative/products/music
// Price: $0.15 per minute (https://elevenlabs.io/pricing/api). The docs give no credits
// per minute figure, so the estimate uses the most expensive ratio on that page.

export const MUSIC_URL = 'https://api.elevenlabs.io/v1/music';
export const DEFAULT_MUSIC_MODEL = 'music_v1';
const OUTPUT_FORMAT = 'mp3_44100_128';
const USD_PER_MINUTE = 0.15;
/**
 * Worst case from the pricing page: the free tier's 10,000 credits cover 3 minutes.
 * Paid plans come out at about 700 to 900 credits per minute.
 */
export const CREDITS_PER_MINUTE = 3400;
export const DEFAULT_MAX_CREDITS = 5000;
const TIMEOUT_MS = 180_000;
const OUT_DIR = fileURLToPath(new URL('../../client/public/assets/audio/gen', import.meta.url));

interface Job {
  file: string;
  seconds: number;
  prompt: string;
}

const JOBS: Job[] = [
  {
    file: 'menu.mp3',
    seconds: 30,
    prompt:
      'Seamless looping title theme for a retro pixel art puzzle game about a mysterious cube. 16-bit chiptune with soft square leads, warm triangle bass and light percussion. Curious, inviting, slightly mysterious. Moderate tempo, no intro, no outro, ends as it starts so it loops.',
  },
  {
    file: 'inside.mp3',
    seconds: 30,
    prompt:
      'Seamless looping dark ambient background for a retro pixel art game, trapped inside a dark stone cube. Sparse and slow: a low drone, distant soft chiptune bells, long reverb, lots of silence, no drums, no melody hook. Lonely but calm. No intro, no outro, loops.',
  },
];

export const estimateCredits = (seconds: number) => Math.ceil((seconds / 60) * CREDITS_PER_MINUTE);

async function main(): Promise<number> {
  try {
    process.loadEnvFile(new URL('../.env', import.meta.url));
  } catch {
    // no server/.env: use the real environment
  }
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error('ELEVENLABS_API_KEY is not set (put it in server/.env).');
    return 1;
  }
  const args = new Set(process.argv.slice(2));
  const model = process.env.ELEVENLABS_MUSIC_MODEL || DEFAULT_MUSIC_MODEL;
  const limit = Number(process.env.MUSIC_MAX_CREDITS) || DEFAULT_MAX_CREDITS;
  const headers = { 'xi-api-key': apiKey };

  const jobs = JOBS.filter((j) => args.has('--force') || !existsSync(join(OUT_DIR, j.file)));
  for (const j of JOBS) if (!jobs.includes(j)) console.log(`  exists  ${j.file} (use --force to regenerate)`);
  if (jobs.length === 0) {
    console.log('nothing to generate.');
    return 0;
  }

  const seconds = jobs.reduce((sum, j) => sum + j.seconds, 0);
  const estimate = estimateCredits(seconds);
  console.log(`music: ${jobs.length} track(s), ${seconds} s in total, model ${model}`);
  for (const j of jobs) console.log(`  ${j.file}: ${j.seconds} s, up to ${estimateCredits(j.seconds)} credits`);
  console.log(`estimated cost: up to ${estimate} credits (${CREDITS_PER_MINUTE} credits/min worst case), $${((seconds / 60) * USD_PER_MINUTE).toFixed(2)} at $${USD_PER_MINUTE}/min. Limit: ${limit} credits.`);
  if (estimate > limit) {
    console.error(`aborted: the estimate is over the limit (MUSIC_MAX_CREDITS=${limit}). Nothing was generated.`);
    return 1;
  }

  /** Credits used so far this period, or null if the key may not read the subscription. */
  const used = async (): Promise<{ count: number; limit: number; tier: string } | null> => {
    try {
      const res = await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return null;
      const sub = (await res.json()) as { character_count?: number; character_limit?: number; tier?: string };
      return typeof sub.character_count === 'number' ? { count: sub.character_count, limit: sub.character_limit ?? 0, tier: sub.tier ?? '?' } : null;
    } catch {
      return null;
    }
  };
  const before = await used();
  if (before) {
    const left = before.limit - before.count;
    console.log(`account: plan ${before.tier}, ${left} credits left this period.`);
    if (left < estimate) {
      console.error('aborted: not enough credits left for the estimate. Nothing was generated.');
      return 1;
    }
  } else {
    console.log('account: this key cannot read the subscription, so the real cost will not be shown.');
  }

  if (!args.has('--yes')) {
    if (!process.stdin.isTTY) {
      console.error('aborted: not a terminal. Run again with -- --yes to confirm.');
      return 1;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question('Generate? [y/N] ');
    rl.close();
    if (answer.trim().toLowerCase() !== 'y') {
      console.log('aborted. Nothing was generated.');
      return 1;
    }
  }

  let made = 0;
  let failed = 0;
  for (const j of jobs) {
    try {
      const res = await fetch(`${MUSIC_URL}?output_format=${OUTPUT_FORMAT}`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: j.prompt, music_length_ms: j.seconds * 1000, model_id: model, force_instrumental: true }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        const why = res.status === 401 || res.status === 403 ? ' (the key lacks permission for music, or the plan does not include the Music API)' : '';
        console.error(`  FAILED  ${j.file}: ElevenLabs answered ${res.status}${why}: ${detail}`);
        failed++;
        if (why) break; // the next one would fail the same way
        continue;
      }
      const audio = Buffer.from(await res.arrayBuffer());
      mkdirSync(OUT_DIR, { recursive: true });
      writeFileSync(join(OUT_DIR, j.file), audio);
      made++;
      console.log(`  new     ${j.file} (${Math.round(audio.length / 1024)} KB)`);
    } catch (e) {
      console.error(`  FAILED  ${j.file}: ${e instanceof Error ? e.message : String(e)}`);
      failed++;
    }
  }

  const after = await used();
  if (before && after) console.log(`real cost: ${after.count - before.count} credits.`);
  console.log(`done: ${made} generated, ${failed} failed. Folder: ${OUT_DIR}`);
  console.log('To use a generated track, point its entry in client/src/audio/tracks.ts at gen/<file> and credit it in CREDITS.md.');
  return failed ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(await main());

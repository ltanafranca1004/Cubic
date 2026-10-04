import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Tts } from './tts';

// The voice bank script (server/scripts/ttsBank.ts), as a function so a test can run it
// against a fake ElevenLabs. It spends real money, so:
//  - the DEFAULT is a dry run: it lists every clip that is missing and the exact number of
//    characters they would cost, calls nothing, writes nothing and exits 0;
//  - only `--buy` buys, and it refuses (exit 1, nothing bought) when the missing clips
//    come to more than BUY_LIMIT_CHARS characters;
//  - a clip that is in the bank is never bought again, and one in the local cache is copied.

/** `--buy` refuses to spend more than this in one run. */
export const BUY_LIMIT_CHARS = 4000;

export interface BankPlan {
  /** Lines with a clip in the bank. */
  banked: string[];
  /** Lines with a clip in the local cache: copied into the bank for free. */
  cached: string[];
  /** Lines that would be bought. */
  missing: string[];
  /** What buying `missing` costs: ElevenLabs bills per character of text. */
  chars: number;
}

export function planBank(lines: readonly string[], tts: Pick<Tts, 'where'>): BankPlan {
  const plan: BankPlan = { banked: [], cached: [], missing: [], chars: 0 };
  for (const line of lines) {
    const at = tts.where(line);
    (at === null ? plan.missing : at.source === 'bank' ? plan.banked : plan.cached).push(line);
  }
  plan.chars = plan.missing.reduce((n, l) => n + l.length, 0);
  return plan;
}

interface IndexLine {
  file: string;
  chars: number;
  text: string;
  voiceId?: string;
  modelId?: string;
}

/** The readable index next to the clips: which file is which line. Lines are only ever added to it. */
function writeIndex(bankDir: string, lines: readonly string[], tts: Pick<Tts, 'where'>, voiceId: string, modelId: string): void {
  const file = join(bankDir, 'index.json');
  let index: { voiceId: string; modelId: string; lines: IndexLine[] } = { voiceId, modelId, lines: [] };
  try {
    if (existsSync(file)) index = JSON.parse(readFileSync(file, 'utf8')) as typeof index;
  } catch {
    // unreadable: write a new one
  }
  const known = new Set(index.lines.map((l) => l.file));
  for (const text of lines) {
    const at = tts.where(text);
    if (at?.source !== 'bank' || known.has(at.file)) continue;
    known.add(at.file);
    index.lines.push({ file: at.file, chars: text.length, text, voiceId, modelId });
  }
  writeFileSync(file, `${JSON.stringify(index, null, 1)}\n`);
}

export interface BankRun {
  /** Command line arguments: `--buy` or nothing. */
  argv: readonly string[];
  /** Every line and vocabulary piece the bank should hold (bankLines()). */
  lines: readonly string[];
  /** Dry run: one with no key. `--buy`: one with the key. */
  tts: Tts;
  hasKey: boolean;
  bankDir: string;
  voiceId: string;
  modelId: string;
  out: (line: string) => void;
}

/** Runs the script. Returns the exit code. */
export async function runBank(run: BankRun): Promise<number> {
  const { lines, tts, out } = run;
  const buy = run.argv.includes('--buy');
  const plan = planBank(lines, tts);
  out(`voice bank: ${lines.length} clips wanted, voice ${run.voiceId}, model ${run.modelId}: ${plan.banked.length} banked, ${plan.cached.length} in the local cache (free), ${plan.missing.length} missing`);
  for (const line of plan.missing) out(`  missing ${String(line.length).padStart(3)} chars  ${line}`);
  out(`total to buy: ${plan.chars} characters in ${plan.missing.length} clips (limit per run: ${BUY_LIMIT_CHARS})`);
  if (!buy) {
    out('dry run: nothing was bought and nothing was written. To buy the missing clips: npm run tts:bank -w server -- --buy');
    return 0;
  }
  if (plan.chars > BUY_LIMIT_CHARS) {
    out(`REFUSED: ${plan.chars} characters is over the limit of ${BUY_LIMIT_CHARS}. Nothing was bought.`);
    return 1;
  }
  if (plan.missing.length && !run.hasKey) {
    out('REFUSED: ELEVENLABS_API_KEY is not set. Nothing was bought.');
    return 1;
  }
  const count = { banked: 0, copied: 0, new: 0, failed: 0 };
  let bought = 0;
  for (const line of [...plan.cached, ...plan.missing]) {
    const res = await tts.bank(line);
    count[res ?? 'failed']++;
    if (res === 'new') bought += line.length;
    out(`  ${(res ?? 'FAILED').padEnd(7)} ${line}`);
  }
  writeIndex(run.bankDir, lines, tts, run.voiceId, run.modelId);
  const clips = readdirSync(run.bankDir).filter((f) => f.endsWith('.mp3'));
  const bytes = clips.reduce((n, f) => n + statSync(join(run.bankDir, f)).size, 0);
  out(`done: ${count.new} bought (${bought} characters sent to ElevenLabs), ${count.copied} copied from the cache, ${count.failed} failed. Bank: ${clips.length} clips, ${(bytes / 1024).toFixed(0)} KB. ${run.bankDir}`);
  return count.failed ? 1 : 0;
}

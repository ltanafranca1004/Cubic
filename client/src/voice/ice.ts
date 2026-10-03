import { SERVER_URL } from '../net/client';

// ICE servers for the voice call. The game server hands them out at GET /ice: public STUN,
// plus a TURN relay when the server has TURN_* set. Fetched once and cached, so starting a
// call never waits on it twice.

/** Used when /ice cannot be reached. Same list the server sends. */
export const STUN_ONLY: RTCConfiguration = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };
const ICE_TIMEOUT_MS = 2500;

let cached: Promise<RTCConfiguration> | null = null;

async function load(): Promise<RTCConfiguration> {
  const res = await fetch(`${SERVER_URL}/ice`, { cache: 'no-store', signal: AbortSignal.timeout(ICE_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { iceServers?: RTCIceServer[] };
  if (!Array.isArray(body.iceServers) || body.iceServers.length === 0) throw new Error('no iceServers');
  return { iceServers: body.iceServers };
}

/** Never rejects: STUN only if the server does not answer in time (and the next call retries). */
export function iceConfig(): Promise<RTCConfiguration> {
  cached ??= load().catch((e) => {
    console.warn('[voice] /ice failed, STUN only', e);
    cached = null;
    return STUN_ONLY;
  });
  return cached;
}

/** For the log: does this configuration include a TURN relay? */
export const hasTurn = (config: RTCConfiguration) => (config.iceServers ?? []).some((s) => [s.urls].flat().some((u) => /^turns?:/.test(u)));

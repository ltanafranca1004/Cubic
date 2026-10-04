import { VOICE_RAMP_MS, type TtsChain, type TtsClip, type VoiceChunk, type VoicePreview } from '@cubic/shared';
import { audioContext } from '../game/sfx';
import type { VoiceState } from '../ui/hooks';
import { STUN_ONLY, hasTurn, iceConfig } from './ice';

// Proximity voice. WebRTC audio between the two players, signaled through our own
// Socket.io server. ICE servers come from the server's GET /ice (public STUN, plus a TURN
// relay when one is configured; see ice.ts). Every remote sound goes through one Web Audio graph:
//
//   remote stream / relay / AI speech  ->  bus  ->  gain (voiceMix x volume)  ->  speakers
//
// If the direct connection cannot be made, both sides fall back to relaying short Opus
// (webm) chunks through the server.

const TICK_MS = 50;
/** Give the direct connection this long before falling back to the relay. */
const DIRECT_TIMEOUT_MS = 10_000;
const RELAY_MIME = 'audio/webm;codecs=opus';
const RELAY_SLICE_MS = 200;
const RELAY_MAX_LAG_S = 1;
const TALK_LEVEL = 0.04;
/** Candidates kept while there is no connection to give them to (a real call has a few dozen). */
const PENDING_ICE_MAX = 64;

type Signal = { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit; relay?: boolean };

export interface VoiceDeps {
  signal(data: unknown): void;
  sendChunk(chunk: VoiceChunk): void;
  /** Proximity gain 0..1 from voiceMix for the current game state. */
  proximity(): number;
  /** The outside player places the call; null while we have no seat yet. */
  isCaller(): boolean | null;
  onChange(): void;
}

export class Voice {
  private mic: VoiceState['mic'] = 'off';
  private mode: VoiceState['mode'] = 'push';
  private muted = false;
  private link: VoiceState['link'] = 'none';
  private keyDown = false;
  private volume = 1;
  private partnerLevel = 0;
  private myLevel = 0;
  /** Gain the output is ramping to (proximity x volume). */
  private target = -1;

  private micStream: MediaStream | null = null;
  /** The microphone was on when the last call ended for good: the next call turns it back on. */
  private micWanted = false;
  private pc: RTCPeerConnection | null = null;
  private pendingIce: RTCIceCandidateInit[] = [];
  private directTimer: number | null = null;
  /** Bumped whenever the call is dropped, so a step that was waiting on /ice gives up. */
  private epoch = 0;

  private bus: GainNode | null = null;
  private out: GainNode | null = null;
  private meter: AnalyserNode | null = null;
  private micMeter: AnalyserNode | null = null;
  private remoteSrc: MediaStreamAudioSourceNode | null = null;
  private remoteEl: HTMLAudioElement | null = null;

  private recorder: MediaRecorder | null = null;
  private relaySeq = 0;
  private relayIn: { el: HTMLAudioElement; sb: SourceBuffer | null; queue: ArrayBuffer[]; node: MediaElementAudioSourceNode } | null = null;
  /** The one <audio> the relayed stream plays through, and its node (an element gets only one). */
  private relayEl: HTMLAudioElement | null = null;
  private relayNode: MediaElementAudioSourceNode | null = null;
  private primed = false;

  private timer: number;
  private lastSnapshot = '';

  constructor(
    private deps: VoiceDeps,
    /** Skip WebRTC and always relay through the server (?relay, for testing the fallback). */
    private forceRelay = false,
  ) {
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  snapshot(signal: VoiceState['signal']): VoiceState {
    return {
      mic: this.mic,
      mode: this.mode,
      muted: this.muted,
      link: this.link,
      talking: this.transmitting() && (this.mode === 'push' || this.myLevel > TALK_LEVEL),
      partnerLevel: this.partnerLevel,
      signal,
      partnerVolume: this.volume,
    };
  }

  /**
   * We are speaking into a live mic right now: the level of the microphone itself, so it
   * is the same whether the audio then travels directly or through the relay.
   */
  get talkingNow(): boolean {
    return this.transmitting() && this.myLevel > TALK_LEVEL;
  }

  /** How loud the partner is right now (0..1), for ducking the music. */
  get partnerLevelNow(): number {
    return this.partnerLevel;
  }

  // ---------- audio graph ----------

  private graph(): { bus: GainNode; out: GainNode } {
    if (!this.bus || !this.out) {
      const ac = audioContext();
      this.bus = ac.createGain();
      this.out = ac.createGain();
      this.out.gain.value = 0;
      this.meter = ac.createAnalyser();
      this.meter.fftSize = 512;
      this.bus.connect(this.meter);
      this.bus.connect(this.out).connect(ac.destination);
    }
    return { bus: this.bus, out: this.out };
  }

  private static level(a: AnalyserNode | null): number {
    if (!a) return 0;
    const buf = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    return Math.min(1, Math.sqrt(sum / buf.length) * 6);
  }

  private tick(): void {
    const gain = this.deps.proximity();
    const target = gain * this.volume;
    if (this.out && target !== this.target) {
      // Short linear ramp so crossing an edge (or moving the slider) does not pop.
      this.target = target;
      const now = audioContext().currentTime;
      const param = this.out.gain;
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      param.linearRampToValueAtTime(target, now + VOICE_RAMP_MS / 1000);
    }
    // What you would actually hear: their level scaled by distance.
    this.partnerLevel = Math.round(Voice.level(this.meter) * Math.min(1, gain * 2) * 20) / 20;
    this.myLevel = Voice.level(this.micMeter);
    this.trimRelayLag();
    const snap = JSON.stringify(this.snapshot(0));
    if (snap !== this.lastSnapshot) {
      this.lastSnapshot = snap;
      this.deps.onChange();
    }
  }

  // ---------- microphone ----------

  async enableMic(): Promise<void> {
    if (this.mic === 'on' || this.mic === 'asking') return;
    this.mic = 'asking';
    this.deps.onChange();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      this.useMic(stream);
    } catch {
      this.mic = 'denied';
      this.deps.onChange();
    }
  }

  /** After a refresh: if the mic was already allowed, turn it back on without asking. */
  async resumeMic(): Promise<void> {
    try {
      const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      if (status.state === 'granted') await this.enableMic();
    } catch {
      // Permissions API not available: the player presses the button again
    }
  }

  /** Dev/test: transmit a steady tone instead of the microphone. */
  useTestTone(): void {
    const ac = audioContext();
    const osc = ac.createOscillator();
    const dest = ac.createMediaStreamDestination();
    osc.frequency.value = 440;
    osc.connect(dest);
    osc.start();
    this.useMic(dest.stream);
  }

  private useMic(stream: MediaStream): void {
    this.micStream = stream;
    this.mic = 'on';
    const ac = audioContext();
    this.micMeter = ac.createAnalyser();
    this.micMeter.fftSize = 512;
    ac.createMediaStreamSource(stream).connect(this.micMeter);
    this.applyTransmit();
    const track = stream.getAudioTracks()[0] ?? null;
    void this.pc?.getTransceivers()[0]?.sender.replaceTrack(track);
    if (this.link === 'relay') this.startRecorder();
    this.deps.onChange();
  }

  /**
   * Let go of the microphone (the browser's recording light goes out). Nobody is there to
   * hear it; the next call takes it again without asking, the permission is still there.
   */
  private releaseMic(): void {
    if (!this.micStream) return;
    for (const t of this.micStream.getTracks()) t.stop();
    this.micStream = null;
    this.micMeter = null;
    this.myLevel = 0;
    this.micWanted = this.mic === 'on';
    this.mic = 'off';
  }

  private transmitting(): boolean {
    return this.mic === 'on' && !this.muted && (this.mode === 'open' || this.keyDown);
  }

  private applyTransmit(): void {
    const on = this.transmitting();
    for (const t of this.micStream?.getAudioTracks() ?? []) t.enabled = on;
    this.deps.onChange();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyTransmit();
  }

  setMode(mode: VoiceState['mode']): void {
    this.mode = mode;
    this.applyTransmit();
  }

  /** Push-to-talk key. */
  setTalkKey(down: boolean): void {
    if (this.keyDown === down) return;
    this.keyDown = down;
    this.applyTransmit();
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    this.deps.onChange();
  }

  // ---------- direct connection (WebRTC) ----------

  /** Both players are in the room (first join, refresh or reconnect): (re)start the call. */
  onReady(): void {
    const caller = this.deps.isCaller();
    if (caller === null) {
      // our seat is not confirmed yet: look again, unless we hang up meanwhile (we left)
      const epoch = this.epoch;
      window.setTimeout(() => epoch === this.epoch && this.onReady(), 200);
      return;
    }
    this.closeCall();
    this.setLink('connecting');
    if (this.micWanted && this.mic === 'off') void this.enableMic(); // let go when the last call ended
    this.micWanted = false;
    if (this.forceRelay) {
      this.startRelay(true);
      return;
    }
    void iceConfig(); // both sides start the (cached) fetch now, before the offer exists
    this.directTimer = window.setTimeout(() => {
      if (this.pc?.connectionState !== 'connected') this.startRelay(true);
    }, DIRECT_TIMEOUT_MS);
    if (caller) void this.call();
  }

  private newPc(config: RTCConfiguration): RTCPeerConnection {
    let pc: RTCPeerConnection;
    try {
      pc = new RTCPeerConnection(config);
    } catch (e) {
      // A malformed TURN URL from the server must not cost us the direct call.
      console.warn('[voice] bad ICE servers, STUN only', e);
      pc = new RTCPeerConnection((config = STUN_ONLY));
    }
    console.info(`[voice] ice servers: ${hasTurn(config) ? 'stun + turn' : 'stun only'}`);
    this.pc = pc;
    pc.onicecandidate = (e) => e.candidate && this.deps.signal({ candidate: e.candidate.toJSON() } satisfies Signal);
    pc.ontrack = (e) => this.attachRemote(e.streams[0] ?? new MediaStream([e.track]));
    pc.oniceconnectionstatechange = () => console.info(`[voice] ice ${pc.iceConnectionState}`);
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      if (pc.connectionState === 'connected') {
        if (this.directTimer) clearTimeout(this.directTimer);
        this.stopRelay();
        this.setLink('direct');
        void Voice.logRoute(pc);
      } else if (pc.connectionState === 'failed') this.startRelay(true);
    };
    return pc;
  }

  /** Log how the call got through: host (same network), srflx (STUN) or relay (TURN). */
  private static async logRoute(pc: RTCPeerConnection): Promise<void> {
    try {
      const stats = await pc.getStats();
      type Report = Record<string, unknown> & { id: string; type: string };
      const reports = new Map<string, Report>();
      stats.forEach((r: Report) => reports.set(r.id, r));
      const all = [...reports.values()];
      const transport = all.find((r) => r.type === 'transport' && r.selectedCandidatePairId);
      // Firefox has no transport report: its chosen pair is flagged `selected`.
      const pair = (transport && reports.get(transport.selectedCandidatePairId as string)) ?? all.find((r) => r.type === 'candidate-pair' && (r.selected || (r.nominated && r.state === 'succeeded')));
      const local = pair && reports.get(pair.localCandidateId as string);
      const remote = pair && reports.get(pair.remoteCandidateId as string);
      if (!local || !remote) return;
      const via = local.candidateType === 'relay' || remote.candidateType === 'relay' ? 'relay' : local.candidateType;
      console.info(`[voice] connected via ${via} (local ${local.candidateType}, remote ${remote.candidateType}, ${local.relayProtocol ?? local.protocol})`);
    } catch {
      // stats are only for the log
    }
  }

  private async call(): Promise<void> {
    const epoch = this.epoch;
    const config = await iceConfig();
    if (epoch !== this.epoch) return; // hung up or restarted while waiting
    const pc = this.newPc(config);
    try {
      const tx = pc.addTransceiver('audio', { direction: 'sendrecv' });
      await tx.sender.replaceTrack(this.micStream?.getAudioTracks()[0] ?? null);
      await pc.setLocalDescription(await pc.createOffer());
      this.deps.signal({ sdp: pc.localDescription!.toJSON() } satisfies Signal);
    } catch (e) {
      if (this.pc !== pc) return; // hung up or restarted meanwhile: not a failure
      console.warn('[voice] could not place the call, using the relay', e);
      this.startRelay(true);
    }
  }

  async onSignal(data: unknown): Promise<void> {
    const msg = (data ?? {}) as Signal;
    try {
      if (msg.relay) {
        this.startRelay(false);
      } else if (msg.sdp?.type === 'offer') {
        if (this.forceRelay) return;
        // Drop the old connection first: candidates that arrive while /ice is being
        // fetched then wait in pendingIce for the new one.
        this.pc?.close();
        this.pc = null;
        this.pendingIce = [];
        const epoch = ++this.epoch;
        const config = await iceConfig();
        if (epoch !== this.epoch) return; // a newer offer or a hang-up took over
        const pc = this.newPc(config);
        await pc.setRemoteDescription(msg.sdp);
        const tx = pc.getTransceivers()[0];
        if (tx) {
          tx.direction = 'sendrecv';
          await tx.sender.replaceTrack(this.micStream?.getAudioTracks()[0] ?? null);
        }
        await pc.setLocalDescription(await pc.createAnswer());
        this.deps.signal({ sdp: pc.localDescription!.toJSON() } satisfies Signal);
        await this.flushIce();
      } else if (msg.sdp?.type === 'answer' && this.pc) {
        await this.pc.setRemoteDescription(msg.sdp);
        await this.flushIce();
      } else if (msg.candidate) {
        if (this.pc?.remoteDescription) await this.pc.addIceCandidate(msg.candidate);
        else if (this.pendingIce.length < PENDING_ICE_MAX) this.pendingIce.push(msg.candidate);
      }
    } catch (e) {
      console.warn('[voice] signaling failed, using the relay', e);
      this.startRelay(true);
    }
  }

  private async flushIce(): Promise<void> {
    for (const c of this.pendingIce.splice(0)) await this.pc?.addIceCandidate(c);
  }

  private attachRemote(stream: MediaStream): void {
    const { bus } = this.graph();
    this.remoteSrc?.disconnect();
    // Chrome only pulls a remote WebRTC stream into Web Audio if an element also plays it.
    this.remoteEl ??= new Audio();
    this.remoteEl.muted = true;
    this.remoteEl.srcObject = stream;
    void this.remoteEl.play().catch(() => {});
    this.remoteSrc = audioContext().createMediaStreamSource(stream);
    this.remoteSrc.connect(bus);
  }

  private setLink(link: VoiceState['link']): void {
    this.link = link;
    this.deps.onChange();
  }

  private closeCall(): void {
    if (this.directTimer) clearTimeout(this.directTimer);
    this.directTimer = null;
    this.epoch++;
    this.pc?.close();
    this.pc = null;
    this.pendingIce = [];
    this.remoteSrc?.disconnect();
    this.remoteSrc = null;
    this.stopRelay();
  }

  /**
   * Drop the call. `forGood`: nobody is coming back to it (we left the room, or the partner
   * gave their seat up), so the microphone is let go as well. Without it the partner only
   * lost their connection and their seat is held: the microphone stays for the call that
   * starts when they are back.
   */
  hangUp(forGood = false): void {
    this.closeCall();
    if (this.remoteEl) this.remoteEl.srcObject = null;
    if (forGood) this.releaseMic();
    this.setLink('none');
  }

  // ---------- fallback: relay through the server ----------

  private startRelay(tellPartner: boolean): void {
    if (this.link === 'relay') return;
    if (this.directTimer) clearTimeout(this.directTimer);
    this.epoch++;
    this.pc?.close();
    this.pc = null;
    if (tellPartner) this.deps.signal({ relay: true } satisfies Signal);
    this.setLink('relay');
    this.startRecorder();
  }

  private startRecorder(): void {
    this.stopRecorder();
    if (!this.micStream || typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported(RELAY_MIME)) return;
    const rec = new MediaRecorder(this.micStream, { mimeType: RELAY_MIME, audioBitsPerSecond: 24_000 });
    this.recorder = rec;
    this.relaySeq = 0; // seq 0 carries the webm header: the listener starts a new stream on it
    rec.ondataavailable = async (e) => {
      if (this.recorder !== rec || e.data.size === 0) return;
      const data = await e.data.arrayBuffer();
      this.deps.sendChunk({ seq: this.relaySeq++, mime: RELAY_MIME, data });
    };
    rec.start(RELAY_SLICE_MS);
  }

  private stopRecorder(): void {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.recorder = null;
  }

  private stopRelay(): void {
    this.stopRecorder();
    if (this.relayIn) {
      this.relayIn.node.disconnect();
      this.relayIn.el.pause();
      this.relayIn = null;
    }
  }

  onChunk(chunk: VoiceChunk): void {
    if (this.link !== 'relay') this.startRelay(false);
    if (chunk.seq === 0 || !this.relayIn) {
      if (chunk.seq !== 0) return; // joined mid-stream: wait for the next header
      this.openRelayStream(chunk.mime);
    }
    const r = this.relayIn;
    if (!r) return; // this browser cannot play the relay (iPhone Safari has no MediaSource)
    r.queue.push(chunk.data);
    this.pumpRelay();
  }

  private openRelayStream(mime: string): void {
    if (this.relayIn) {
      this.relayIn.node.disconnect();
      this.relayIn.el.pause();
    }
    this.relayIn = null;
    if (typeof MediaSource === 'undefined') return;
    const { bus } = this.graph();
    // Always the same element: the one a tap has started once (prime()), so that this
    // play(), which no tap starts, is allowed on iOS.
    const el = (this.relayEl ??= new Audio());
    const ms = new MediaSource();
    el.src = URL.createObjectURL(ms);
    const node = (this.relayNode ??= audioContext().createMediaElementSource(el));
    node.connect(bus);
    const stream = { el, sb: null as SourceBuffer | null, queue: [] as ArrayBuffer[], node };
    this.relayIn = stream;
    ms.addEventListener('sourceopen', () => {
      stream.sb = ms.addSourceBuffer(mime);
      stream.sb.mode = 'sequence';
      stream.sb.addEventListener('updateend', () => this.pumpRelay());
      this.pumpRelay();
    });
    void el.play().catch(() => {});
  }

  private pumpRelay(): void {
    const r = this.relayIn;
    if (!r?.sb || r.sb.updating || r.queue.length === 0) return;
    try {
      r.sb.appendBuffer(r.queue.shift()!);
    } catch {
      this.relayIn = null; // broken stream: the next header chunk starts a fresh one
    }
  }

  /** Keep the relayed audio close to live. */
  private trimRelayLag(): void {
    const el = this.relayIn?.el;
    if (!el || el.buffered.length === 0) return;
    const end = el.buffered.end(el.buffered.length - 1);
    if (end - el.currentTime > RELAY_MAX_LAG_S) el.currentTime = end - 0.15;
    if (el.paused) void el.play().catch(() => {});
  }

  // ---------- playing from a tap ----------

  /**
   * Call from inside a tap (touchend, click). A phone, iOS above all, lets a page start
   * sound only from a user gesture, and the partner's voice arrives whenever it arrives.
   * So the first tap starts everything once, silently: the AudioContext (the WebRTC stream
   * and the AI's clips play through it), the element the relayed stream plays through, and
   * speechSynthesis (the AI's browser voice). After that they may play by themselves.
   */
  prime(): void {
    if (this.primed) return;
    this.primed = true;
    try {
      audioContext(); // resumes it, inside the gesture
      const el = (this.relayEl ??= new Audio());
      if (!this.relayIn) {
        el.src = silence();
        el.play().catch(() => {
          this.primed = false; // not a gesture after all: the next tap tries again
        });
      }
      if (typeof speechSynthesis !== 'undefined') {
        const hush = new SpeechSynthesisUtterance(' ');
        hush.volume = 0;
        speechSynthesis.speak(hush);
      }
    } catch {
      this.primed = false;
    }
  }

  // ---------- AI partner speech ----------

  /** Play a spoken AI line through the same proximity gain. */
  async playClip(clip: TtsClip): Promise<void> {
    try {
      const { bus } = this.graph();
      const ac = audioContext();
      const buffer = await ac.decodeAudioData(clip.data.slice(0));
      const src = ac.createBufferSource();
      src.buffer = buffer;
      src.connect(bus);
      src.start();
    } catch (e) {
      console.warn('[voice] could not play the AI line', e);
    }
  }

  /**
   * Play a relay line: one clip per vocabulary piece, in order, `gapMs` apart, through the
   * same proximity gain as every other AI line. They are scheduled on the audio clock, so
   * the gaps are exact. If a clip cannot be decoded, nothing of the chain is played and
   * `fallback` says the whole line instead.
   */
  async playChain(chain: TtsChain, fallback?: () => void): Promise<void> {
    try {
      const { bus } = this.graph();
      const ac = audioContext();
      const buffers = await Promise.all(chain.clips.map((data) => ac.decodeAudioData(data.slice(0))));
      const at = ac.currentTime + 0.02;
      for (const [i, start] of chainStarts(buffers.map((b) => b.duration), chain.gapMs).entries()) {
        const src = ac.createBufferSource();
        src.buffer = buffers[i]!;
        src.connect(bus);
        src.start(at + start);
      }
    } catch (e) {
      console.warn('[voice] could not play the AI relay line', e);
      fallback?.();
    }
  }

  private previewSrc: AudioBufferSourceNode | null = null;
  /**
   * The settings panel's preview of an AI voice: one greeting, at full volume and not
   * through the proximity gain (there is no partner on a menu). Call it from the click, so
   * the audio may start. A new preview stops the one that is playing. No clip for that voice
   * (its bank is not there): the browser voice reads the line.
   */
  async playPreview(pending: Promise<VoicePreview | null>): Promise<void> {
    try {
      const ac = audioContext(); // resumes it, inside the gesture
      const preview = await pending;
      if (!preview) return;
      this.previewSrc?.stop();
      this.previewSrc = null;
      if (!preview.data) {
        if (typeof speechSynthesis === 'undefined') return;
        speechSynthesis.cancel();
        speechSynthesis.speak(new SpeechSynthesisUtterance(preview.text));
        return;
      }
      const src = ac.createBufferSource();
      src.buffer = await ac.decodeAudioData(preview.data.slice(0));
      src.connect(ac.destination);
      src.start();
      this.previewSrc = src;
    } catch (e) {
      console.warn('[voice] could not play the voice preview', e);
    }
  }

  /**
   * Say an AI line with the browser's free speechSynthesis (TTS_MODE=browser, or the
   * ElevenLabs call failed). It cannot be routed through Web Audio, so the proximity gain
   * is applied as the utterance volume when the line starts.
   */
  speakText(text: string): void {
    if (typeof speechSynthesis === 'undefined') return;
    const volume = Math.min(1, Math.max(0, this.deps.proximity() * this.volume));
    if (volume <= 0) return; // out of earshot
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.volume = volume;
    utterance.rate = 1.05;
    speechSynthesis.speak(utterance);
  }

  destroy(): void {
    clearInterval(this.timer);
    this.closeCall();
    for (const t of this.micStream?.getTracks() ?? []) t.stop();
  }
}

/** When each clip of a chain starts, in seconds from the first: one after the other, `gapMs` apart. */
export function chainStarts(durations: readonly number[], gapMs: number): number[] {
  const starts: number[] = [];
  let at = 0;
  for (const d of durations) {
    starts.push(at);
    at += d + Math.max(0, gapMs) / 1000;
  }
  return starts;
}

let silentUrl: string | null = null;
/** A twentieth of a second of silence as a WAV file, to start an <audio> element with. */
function silence(): string {
  if (silentUrl) return silentUrl;
  const samples = 400;
  const wav = new DataView(new ArrayBuffer(44 + samples));
  const text = (at: number, value: string) => [...value].forEach((c, i) => wav.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  wav.setUint32(4, 36 + samples, true);
  text(8, 'WAVEfmt ');
  wav.setUint32(16, 16, true);
  wav.setUint16(20, 1, true); // PCM
  wav.setUint16(22, 1, true); // mono
  wav.setUint32(24, 8000, true);
  wav.setUint32(28, 8000, true);
  wav.setUint16(32, 1, true);
  wav.setUint16(34, 8, true); // 8 bit: 128 is silence
  text(36, 'data');
  wav.setUint32(40, samples, true);
  for (let i = 0; i < samples; i++) wav.setUint8(44 + i, 128);
  silentUrl = URL.createObjectURL(new Blob([wav.buffer], { type: 'audio/wav' }));
  return silentUrl;
}

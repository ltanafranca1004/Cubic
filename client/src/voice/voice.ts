import { VOICE_RAMP_MS, type TtsClip, type VoiceChunk } from '@cubic/shared';
import { audioContext } from '../game/sfx';
import type { VoiceState } from '../ui/hooks';

// Proximity voice. WebRTC audio between the two players, signaled through our own
// Socket.io server (public STUN only). Every remote sound goes through one Web Audio graph:
//
//   remote stream / relay / AI speech  ->  bus  ->  gain (voiceMix x volume)  ->  speakers
//
// If the direct connection cannot be made, both sides fall back to relaying short Opus
// (webm) chunks through the server.

const ICE: RTCConfiguration = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };
const TICK_MS = 50;
/** Give the direct connection this long before falling back to the relay. */
const DIRECT_TIMEOUT_MS = 10_000;
const RELAY_MIME = 'audio/webm;codecs=opus';
const RELAY_SLICE_MS = 200;
const RELAY_MAX_LAG_S = 1;
const TALK_LEVEL = 0.04;

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
  private pc: RTCPeerConnection | null = null;
  private pendingIce: RTCIceCandidateInit[] = [];
  private directTimer: number | null = null;

  private bus: GainNode | null = null;
  private out: GainNode | null = null;
  private meter: AnalyserNode | null = null;
  private micMeter: AnalyserNode | null = null;
  private remoteSrc: MediaStreamAudioSourceNode | null = null;
  private remoteEl: HTMLAudioElement | null = null;

  private recorder: MediaRecorder | null = null;
  private relaySeq = 0;
  private relayIn: { el: HTMLAudioElement; sb: SourceBuffer | null; queue: ArrayBuffer[]; node: MediaElementAudioSourceNode } | null = null;

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
      window.setTimeout(() => this.onReady(), 200); // our seat is not confirmed yet
      return;
    }
    this.closeCall();
    this.setLink('connecting');
    if (this.forceRelay) {
      this.startRelay(true);
      return;
    }
    this.directTimer = window.setTimeout(() => {
      if (this.pc?.connectionState !== 'connected') this.startRelay(true);
    }, DIRECT_TIMEOUT_MS);
    if (caller) void this.call();
  }

  private newPc(): RTCPeerConnection {
    const pc = new RTCPeerConnection(ICE);
    this.pc = pc;
    this.pendingIce = [];
    pc.onicecandidate = (e) => e.candidate && this.deps.signal({ candidate: e.candidate.toJSON() } satisfies Signal);
    pc.ontrack = (e) => this.attachRemote(e.streams[0] ?? new MediaStream([e.track]));
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      if (pc.connectionState === 'connected') {
        if (this.directTimer) clearTimeout(this.directTimer);
        this.stopRelay();
        this.setLink('direct');
      } else if (pc.connectionState === 'failed') this.startRelay(true);
    };
    return pc;
  }

  private async call(): Promise<void> {
    const pc = this.newPc();
    const tx = pc.addTransceiver('audio', { direction: 'sendrecv' });
    await tx.sender.replaceTrack(this.micStream?.getAudioTracks()[0] ?? null);
    await pc.setLocalDescription(await pc.createOffer());
    this.deps.signal({ sdp: pc.localDescription!.toJSON() } satisfies Signal);
  }

  async onSignal(data: unknown): Promise<void> {
    const msg = (data ?? {}) as Signal;
    try {
      if (msg.relay) {
        this.startRelay(false);
      } else if (msg.sdp?.type === 'offer') {
        if (this.forceRelay) return;
        this.pc?.close();
        const pc = this.newPc();
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
        else this.pendingIce.push(msg.candidate);
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
    this.pc?.close();
    this.pc = null;
    this.remoteSrc?.disconnect();
    this.remoteSrc = null;
    this.stopRelay();
  }

  /** The partner left: drop the call. */
  hangUp(): void {
    this.closeCall();
    this.setLink('none');
  }

  // ---------- fallback: relay through the server ----------

  private startRelay(tellPartner: boolean): void {
    if (this.link === 'relay') return;
    if (this.directTimer) clearTimeout(this.directTimer);
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
    const r = this.relayIn!;
    r.queue.push(chunk.data);
    this.pumpRelay();
  }

  private openRelayStream(mime: string): void {
    if (this.relayIn) {
      this.relayIn.node.disconnect();
      this.relayIn.el.pause();
    }
    const { bus } = this.graph();
    const el = new Audio();
    const ms = new MediaSource();
    el.src = URL.createObjectURL(ms);
    const node = audioContext().createMediaElementSource(el);
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

  destroy(): void {
    clearInterval(this.timer);
    this.closeCall();
    for (const t of this.micStream?.getTracks() ?? []) t.stop();
  }
}

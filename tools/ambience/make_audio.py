#!/usr/bin/env python3
"""Synthesizes the per-face ambience loops (client/src/world/ambience/loops.ts).

    python3 tools/ambience/make_audio.py        (needs numpy and ffmpeg)

Writes client/public/assets/audio/ambience/<name>.ogg (Ogg Opus) and <name>.mp3, mono.
Nothing is sampled or downloaded: every loop is filtered noise and sine tones made here
from a fixed seed, so the files are our own work.

Each sound is exactly periodic over LOOP_S seconds (noise is shaped in the frequency
domain, every slow envelope has a whole number of cycles, events wrap around the end).
The file holds the period plus PAD_S of the next one on both ends, and the game loops the
middle (loopStart = PAD_S, loopEnd = PAD_S + LOOP_S), so encoder padding never clicks.
"""
import os
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "client/public/assets/audio/ambience"
FFMPEG = os.environ.get("FFMPEG", "ffmpeg")
SR = 24000
LOOP_S = 8.0
PAD_S = 0.25
N = int(SR * LOOP_S)
T = np.arange(N) / SR
# every loop is levelled to this RMS (dBFS): quiet, well under the music
TARGET_DB = -30.0


def noise(rng, lo, hi, slope=0.0):
    """Periodic noise between lo and hi Hz with soft edges; slope tilts it (dB per octave)."""
    spec = np.fft.rfft(rng.standard_normal(N))
    f = np.fft.rfftfreq(N, 1 / SR)
    f[0] = 1e-6
    gain = 1 / (1 + (lo / f) ** 4) / (1 + (f / hi) ** 4)
    gain *= (f / 1000) ** (slope / 6.02)
    return np.fft.irfft(spec * gain, N)


def lfo(rng, cycles, depth=1.0):
    """A slow 0..1 envelope: a few sines with whole cycles per loop, so it wraps."""
    out = np.zeros(N)
    for c in cycles:
        out += np.sin(2 * np.pi * (c * T / LOOP_S + rng.random()))
    out = 0.5 + 0.5 * out / len(cycles)
    return 1 - depth + depth * out


def place(dst, sound, at_s, gain=1.0):
    """Mix a short sound in at a time, wrapping around the end of the loop."""
    idx = (int(at_s * SR) + np.arange(len(sound))) % N
    np.add.at(dst, idx, sound * gain)


def blip(freq0, freq1, dur, decay):
    t = np.arange(int(dur * SR)) / SR
    f = freq0 + (freq1 - freq0) * t / dur
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * decay) * np.minimum(1, t * 400)


def norm(x):
    return x / (np.sqrt(np.mean(x**2)) + 1e-12)


def grass(rng):
    wind = norm(noise(rng, 250, 1400, -3)) * lfo(rng, [1, 2, 3], 0.6)
    rustle = norm(noise(rng, 2500, 6000)) * lfo(rng, [2, 5], 0.9) ** 2 * 0.25
    birds = np.zeros(N)
    for at in (0.9, 1.05, 1.2, 4.6, 4.8, 6.9):
        place(birds, blip(3400 + rng.random() * 600, 4300 + rng.random() * 500, 0.09, 18), at, 0.9)
    return wind + rustle + birds * 0.5


def desert(rng):
    low = norm(noise(rng, 90, 500, -4)) * lfo(rng, [1, 2], 0.5)
    whistle = np.zeros(N)
    for centre, cyc in ((620, [1, 3]), (910, [2, 3])):
        whistle += norm(noise(rng, centre * 0.94, centre * 1.06)) * lfo(rng, cyc, 1.0) ** 3
    sand = norm(noise(rng, 3000, 9000)) * lfo(rng, [3, 4, 7], 1.0) ** 2 * 0.2
    return low + whistle * 0.45 + sand


def snow(rng):
    hiss = norm(noise(rng, 900, 7000, -2)) * lfo(rng, [1, 2, 3], 0.7)
    howl = norm(noise(rng, 380, 470)) * lfo(rng, [1, 2], 1.0) ** 3 * 0.5
    return hiss + howl


def forest(rng):
    rustle = norm(noise(rng, 500, 3500, -3)) * lfo(rng, [1, 2, 4], 0.6) * 0.8
    crickets = np.zeros(N)
    for freq, rate, cyc in ((4300, 31, [1, 2]), (4750, 27, [2, 3])):
        chirp = np.sin(2 * np.pi * freq * T) * (0.5 + 0.5 * np.sin(2 * np.pi * round(rate * LOOP_S) / LOOP_S * T)) ** 4
        crickets += chirp * (lfo(rng, cyc, 1.0) > 0.55)
    owl = np.zeros(N)
    for at in (2.2, 2.75):
        place(owl, blip(410, 380, 0.4, 5), at, 1.0)
    return rustle + norm(crickets) * 0.45 + owl * 0.25


def rooftop(rng):
    open_air = norm(noise(rng, 120, 2600, -3)) * lfo(rng, [1, 3], 0.45)
    gust = norm(noise(rng, 600, 4000, -1)) * lfo(rng, [2, 3, 5], 1.0) ** 3 * 0.6
    flap = np.zeros(N)
    cloth = noise(rng, 150, 900)[: int(0.07 * SR)] * np.exp(-np.arange(int(0.07 * SR)) / SR * 45)
    for at in (0.6, 0.85, 1.05, 3.3, 3.5, 5.9, 6.1, 6.35):
        place(flap, norm(cloth), at, 0.5 + rng.random() * 0.4)
    return open_air + gust + flap * 0.35


def cave(rng):
    rumble = norm(noise(rng, 40, 180, -3)) * lfo(rng, [1, 2], 0.4)
    air = norm(noise(rng, 300, 900, -6)) * lfo(rng, [1, 3], 0.6) * 0.3
    drips = np.zeros(N)
    for at in (0.7, 2.9, 3.6, 5.8, 7.1):
        f = 1300 + rng.random() * 900
        drop = blip(f, f * 1.5, 0.12, 30)
        for echo in range(5):  # the cave answers, quieter and duller each time
            place(drips, drop, at + echo * 0.19, 0.55**echo)
    return rumble + air + drips * 0.9


def hum(rng):
    tone = np.zeros(N)
    for freq, gain in ((55, 1.0), (110, 0.6), (165, 0.3), (220.5, 0.12), (110.25, 0.4)):
        cycles = round(freq * LOOP_S)  # snap to a whole number of cycles per loop
        tone += gain * np.sin(2 * np.pi * cycles / LOOP_S * T + rng.random() * 6.28)
    tone *= lfo(rng, [1, 2], 0.25)
    air = norm(noise(rng, 200, 1200, -6)) * 0.12
    return norm(tone) + air


LOOPS = {"grass": grass, "desert": desert, "snow": snow, "forest": forest, "rooftop": rooftop, "cave": cave, "hum": hum}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    pad = int(PAD_S * SR)
    for i, (name, make) in enumerate(LOOPS.items()):
        x = make(np.random.default_rng(6400 + i))
        x = norm(x) * 10 ** (TARGET_DB / 20)
        x = np.clip(np.concatenate([x[-pad:], x, x[:pad]]), -1, 1)
        with tempfile.TemporaryDirectory() as tmp:
            wav = os.path.join(tmp, "loop.wav")
            with wave.open(wav, "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(SR)
                w.writeframes((x * 32767).astype("<i2").tobytes())
            base = ["-y", "-loglevel", "error", "-i", wav, "-ac", "1", "-map_metadata", "-1"]
            subprocess.run([FFMPEG, *base, "-c:a", "libopus", "-b:a", "24k", "-f", "ogg", str(OUT / f"{name}.ogg")], check=True)
            subprocess.run([FFMPEG, *base, "-c:a", "libmp3lame", "-b:a", "32k", "-ar", "24000", str(OUT / f"{name}.mp3")], check=True)
        print(name, (OUT / f"{name}.ogg").stat().st_size, (OUT / f"{name}.mp3").stat().st_size)


main()

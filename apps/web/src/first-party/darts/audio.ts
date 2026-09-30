/**
 * Darts sounds, synthesized with WebAudio (no assets): the whoosh of a
 * throw, a thunk into sisal scaled by the dart's speed, a wire clink, bright
 * chimes for trebles and the bull, a pub crowd for tons and a full roar with
 * a fanfare for 180. Follows the platform's sound toggle (`@/lib/sfx`).
 */

import { isSoundEnabled } from "@/lib/sfx";

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;

function audio(): { ctx: AudioContext; out: GainNode; noise: AudioBuffer } | null {
  if (typeof window === "undefined" || !isSoundEnabled()) return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
    out = ctx.createGain();
    out.gain.value = 0.32;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 5;
    out.connect(comp).connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  return out && noiseBuf ? { ctx, out, noise: noiseBuf } : null;
}

type A = NonNullable<ReturnType<typeof audio>>;

function tone(
  a: A,
  o: { freq: number; to?: number; type?: OscillatorType; start?: number; duration: number; gain?: number; attack?: number },
) {
  const t0 = a.ctx.currentTime + (o.start ?? 0);
  const osc = a.ctx.createOscillator();
  const env = a.ctx.createGain();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(o.freq, t0);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + o.duration);
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(o.gain ?? 0.5, t0 + (o.attack ?? 0.006));
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + o.duration);
  osc.connect(env).connect(a.out);
  osc.start(t0);
  osc.stop(t0 + o.duration + 0.03);
}

function hiss(
  a: A,
  o: {
    duration: number;
    from: number;
    to: number;
    gain?: number;
    start?: number;
    q?: number;
    type?: BiquadFilterType;
    attack?: number;
  },
) {
  const t0 = a.ctx.currentTime + (o.start ?? 0);
  const src = a.ctx.createBufferSource();
  src.buffer = a.noise;
  src.loop = true;
  const filter = a.ctx.createBiquadFilter();
  filter.type = o.type ?? "bandpass";
  filter.Q.value = o.q ?? 1;
  filter.frequency.setValueAtTime(o.from, t0);
  filter.frequency.exponentialRampToValueAtTime(o.to, t0 + o.duration);
  const env = a.ctx.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(o.gain ?? 0.4, t0 + (o.attack ?? 0.02));
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + o.duration);
  src.connect(filter).connect(env).connect(a.out);
  src.start(t0, Math.random());
  src.stop(t0 + o.duration + 0.05);
}

/** Lifting the dart. */
export function playRaise(): void {
  const a = audio();
  if (!a) return;
  hiss(a, { duration: 0.12, from: 1800, to: 3200, gain: 0.05, q: 2 });
}

/** Taking a breath and holding it. */
export function playBreath(): void {
  const a = audio();
  if (!a) return;
  hiss(a, { duration: 0.45, from: 500, to: 900, gain: 0.12, q: 0.8, attack: 0.12, type: "lowpass" });
  tone(a, { freq: 220, to: 180, duration: 0.3, gain: 0.05, type: "sine" });
}

/** The throw: `speed` is the normalized flick speed. */
export function playWhoosh(speed: number): void {
  const a = audio();
  if (!a) return;
  const k = Math.max(0.4, Math.min(1.6, speed / 2));
  hiss(a, { duration: 0.2 + 0.1 / k, from: 700 * k, to: 3600 * k, gain: 0.12 + 0.08 * k, q: 1.6 });
}

/** A dart landing. `speed` scales the thunk; `surface` is what it hit. */
export function playThunk(speed: number, surface: "sisal" | "wire" | "ring" | "wall"): void {
  const a = audio();
  if (!a) return;
  const k = Math.max(0.5, Math.min(1.6, speed / 2));
  if (surface === "wall") {
    tone(a, { freq: 180, to: 90, duration: 0.14, gain: 0.3 * k, type: "triangle" });
    hiss(a, { duration: 0.08, from: 2500, to: 800, gain: 0.2, q: 2 });
    return;
  }
  tone(a, { freq: 150 + 30 * k, to: 55, duration: 0.16, gain: 0.55 * k, attack: 0.002 });
  hiss(a, { duration: 0.06, from: 4000, to: 1200, gain: 0.25 * k, q: 0.9, attack: 0.002 });
  if (surface === "wire") tone(a, { freq: 2600, to: 2400, duration: 0.18, gain: 0.08, type: "triangle", start: 0.005 });
  if (surface === "ring") tone(a, { freq: 320, to: 200, duration: 0.1, gain: 0.12, type: "square" });
}

/** Score chimes, by what the dart hit. */
export function playChime(kind: "treble" | "double" | "outer-bull" | "bull"): void {
  const a = audio();
  if (!a) return;
  switch (kind) {
    case "double":
      tone(a, { freq: 880, duration: 0.25, gain: 0.16, type: "triangle", start: 0.05 });
      break;
    case "treble":
      tone(a, { freq: 1046.5, duration: 0.2, gain: 0.18, type: "triangle", start: 0.04 });
      tone(a, { freq: 1568, duration: 0.35, gain: 0.14, type: "sine", start: 0.11 });
      break;
    case "outer-bull":
      tone(a, { freq: 784, duration: 0.3, gain: 0.18, type: "triangle", start: 0.04 });
      tone(a, { freq: 1175, duration: 0.4, gain: 0.12, start: 0.12 });
      break;
    case "bull":
      // A bell: a bright partial stack with a slow decay, then a sparkle.
      [523.25, 1046.5, 1318.5, 1568, 2093].forEach((f, i) =>
        tone(a, { freq: f, duration: 1.3 - i * 0.15, gain: 0.16 - i * 0.02, type: i % 2 ? "sine" : "triangle", start: 0.04 }),
      );
      [2637, 3136, 3951].forEach((f, i) => tone(a, { freq: f, duration: 0.25, gain: 0.05, start: 0.3 + i * 0.07 }));
      break;
  }
}

/** A pub crowd reacting: `size` 0..1 (a nice round … a 180). */
export function playCrowd(size: number): void {
  const a = audio();
  if (!a) return;
  const k = Math.max(0.2, Math.min(1, size));
  const duration = 0.9 + k * 1.8;
  // Many voices: a swelling low-mid band of noise with some chatter on top.
  hiss(a, { duration, from: 500, to: 900, gain: 0.18 + 0.3 * k, q: 0.5, attack: 0.25 * k + 0.05 });
  hiss(a, { duration: duration * 0.8, from: 1200, to: 1700, gain: 0.08 + 0.14 * k, q: 1.2, attack: 0.2, start: 0.05 });
  const whoops = Math.round(2 + k * 7);
  for (let i = 0; i < whoops; i++) {
    const f = 380 + Math.random() * 380;
    tone(a, { freq: f, to: f * (1.3 + Math.random() * 0.5), duration: 0.35, gain: 0.03 + 0.03 * k, type: "sawtooth", start: 0.1 + Math.random() * duration * 0.6 });
  }
  if (k >= 0.95) {
    // 180: the fanfare over the roar.
    [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      tone(a, { freq: f, duration: 0.3, gain: 0.16, type: "square", start: 0.15 + i * 0.12 }),
    );
    tone(a, { freq: 1046.5, duration: 1.1, gain: 0.14, type: "triangle", start: 0.8 });
    tone(a, { freq: 1318.5, duration: 1.1, gain: 0.1, type: "triangle", start: 0.8 });
  }
}

/** A groan for a round of nothing. */
export function playGroan(): void {
  const a = audio();
  if (!a) return;
  hiss(a, { duration: 0.9, from: 700, to: 300, gain: 0.18, q: 0.7, attack: 0.1 });
  tone(a, { freq: 220, to: 150, duration: 0.7, gain: 0.05, type: "sawtooth" });
}

/** Pulling the darts out of the board. */
export function playPull(): void {
  const a = audio();
  if (!a) return;
  for (let i = 0; i < 3; i++) {
    hiss(a, { duration: 0.07, from: 3000, to: 1500, gain: 0.08, q: 2, start: i * 0.09 });
    tone(a, { freq: 420, to: 600, duration: 0.05, gain: 0.05, start: i * 0.09 });
  }
}

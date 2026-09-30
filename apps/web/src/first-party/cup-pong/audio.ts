/**
 * Table sounds, synthesized with WebAudio (no assets): the hollow "pock" of a
 * ping-pong ball on wood, the plasticky tick of a rim, the plop and splash of
 * a make, a whoosh on release, fire ignition, and a small crowd that goes
 * "ooh" on near misses and cheers on makes. Follows the platform's sound
 * toggle (`@/lib/sfx`), like every first-party app.
 */

import { isSoundEnabled, onSoundChange } from "@/lib/sfx";

export class TableAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private enabled = isSoundEnabled();
  private readonly off: () => void;
  private lastAt = new Map<string, number>();

  constructor() {
    this.off = onSoundChange((on) => {
      this.enabled = on;
      if (this.master && this.ctx) this.master.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.05);
    });
  }

  /** Creates (or resumes) the audio graph; call from a gesture when possible. */
  resume(): void {
    this.ensure();
  }

  private ensure(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      try {
        this.ctx = new Ctor();
      } catch {
        return null;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? 0.55 : 0;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.ratio.value = 5;
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  private ready(key: string, gapMs: number): AudioContext | null {
    if (!this.enabled) return null;
    const now = performance.now();
    if (now - (this.lastAt.get(key) ?? 0) < gapMs) return null;
    this.lastAt.set(key, now);
    return this.ensure();
  }

  private tone(o: { freq: number; to?: number; type?: OscillatorType; at?: number; dur: number; gain: number; attack?: number }) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + (o.at ?? 0);
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = o.type ?? "sine";
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + o.dur);
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(o.gain, t0 + (o.attack ?? 0.004));
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    osc.connect(env).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.02);
  }

  private noise(o: { at?: number; dur: number; gain: number; type: BiquadFilterType; freq: number; to?: number; q?: number; attack?: number }) {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuf) return;
    const t0 = ctx.currentTime + (o.at ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = o.type;
    filter.Q.value = o.q ?? 1;
    filter.frequency.setValueAtTime(o.freq, t0);
    if (o.to) filter.frequency.exponentialRampToValueAtTime(o.to, t0 + o.dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(o.gain, t0 + (o.attack ?? 0.005));
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    src.connect(filter).connect(env).connect(this.master);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + o.dur + 0.05);
  }

  /** Ball on the table: loudness and pitch follow the impact speed. */
  pong(speed: number) {
    if (!this.ready("pong", 30)) return;
    const v = Math.max(0.15, Math.min(1, speed / 3.5));
    this.tone({ freq: 1650 + v * 350, to: 1250, dur: 0.07, gain: 0.5 * v, attack: 0.002 });
    this.tone({ freq: 3400, dur: 0.03, gain: 0.18 * v, type: "triangle", attack: 0.001 });
    this.noise({ dur: 0.05, gain: 0.35 * v, type: "bandpass", freq: 2600, q: 2.5, attack: 0.001 });
  }

  /** Ball clipping a plastic rim. */
  rim(speed: number) {
    if (!this.ready("rim", 35)) return;
    const v = Math.max(0.2, Math.min(1, speed / 2.5));
    this.tone({ freq: 2900, to: 2500, dur: 0.05, gain: 0.32 * v, type: "triangle", attack: 0.001 });
    this.tone({ freq: 4700, dur: 0.035, gain: 0.14 * v, type: "square", attack: 0.001 });
    this.noise({ dur: 0.04, gain: 0.2 * v, type: "highpass", freq: 3500, attack: 0.001 });
  }

  /** Ball glancing off a cup's side. */
  wall(speed: number) {
    if (!this.ready("wall", 40)) return;
    const v = Math.max(0.2, Math.min(1, speed / 2.5));
    this.tone({ freq: 900, to: 700, dur: 0.06, gain: 0.25 * v, type: "triangle", attack: 0.001 });
    this.noise({ dur: 0.05, gain: 0.18 * v, type: "bandpass", freq: 1400, q: 1.5, attack: 0.001 });
  }

  /** Plop into the drink, then a little splash and bubbles. */
  splash() {
    if (!this.ready("splash", 80)) return;
    this.tone({ freq: 260, to: 720, dur: 0.12, gain: 0.55, attack: 0.003 });
    this.noise({ dur: 0.32, gain: 0.45, type: "lowpass", freq: 2400, to: 380, q: 0.7, attack: 0.004 });
    for (let i = 0; i < 4; i++) {
      this.tone({ freq: 600 + Math.random() * 700, to: 1300 + Math.random() * 600, at: 0.08 + i * 0.05 + Math.random() * 0.03, dur: 0.05, gain: 0.12 });
    }
  }

  /** Release: a quick airy whoosh. */
  whoosh() {
    if (!this.ready("whoosh", 60)) return;
    this.noise({ dur: 0.28, gain: 0.22, type: "bandpass", freq: 700, to: 2600, q: 0.9, attack: 0.03 });
  }

  /** The crowd: "ooh" (near miss) or a cheer (make / big moment). */
  crowd(kind: "ooh" | "cheer" | "roar") {
    if (!this.ready(`crowd-${kind}`, 500)) return;
    if (kind === "ooh") {
      // Many voices sliding up and down a vowel.
      for (let i = 0; i < 6; i++) {
        const f = 170 + Math.random() * 110;
        this.tone({ freq: f, to: f * 1.35, dur: 0.55 + Math.random() * 0.25, gain: 0.05, type: "sawtooth", attack: 0.12, at: Math.random() * 0.06 });
      }
      this.noise({ dur: 0.8, gain: 0.12, type: "bandpass", freq: 520, to: 780, q: 3, attack: 0.15 });
      this.noise({ dur: 0.8, gain: 0.06, type: "bandpass", freq: 1100, to: 900, q: 4, attack: 0.15 });
    } else {
      const big = kind === "roar";
      this.noise({ dur: big ? 1.6 : 1.0, gain: big ? 0.3 : 0.2, type: "bandpass", freq: 1200, to: 1800, q: 0.6, attack: 0.08 });
      this.noise({ dur: big ? 1.4 : 0.8, gain: big ? 0.16 : 0.1, type: "highpass", freq: 3000, attack: 0.05 });
      // Claps.
      const claps = big ? 14 : 7;
      for (let i = 0; i < claps; i++) {
        this.noise({ at: 0.05 + Math.random() * (big ? 1.2 : 0.7), dur: 0.03, gain: 0.12, type: "bandpass", freq: 1800 + Math.random() * 900, q: 1.2, attack: 0.001 });
      }
    }
  }

  /** Catching fire. */
  ignite() {
    if (!this.ready("ignite", 400)) return;
    this.noise({ dur: 0.7, gain: 0.35, type: "lowpass", freq: 300, to: 1800, q: 0.8, attack: 0.02 });
    this.tone({ freq: 180, to: 520, dur: 0.5, gain: 0.25, type: "sawtooth", attack: 0.02 });
  }

  /** A cup being slid into a new rack. */
  slide() {
    if (!this.ready("slide", 200)) return;
    this.noise({ dur: 0.35, gain: 0.14, type: "bandpass", freq: 900, to: 500, q: 1.2, attack: 0.03 });
  }

  dispose() {
    this.off();
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}

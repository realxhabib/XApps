/**
 * Arena sound, synthesized with WebAudio (no assets): your engine note,
 * spinner whine and flame roar as continuous voices, plus one-shot impacts,
 * clangs, pneumatic flips, hammer blows, explosions and hazards. Follows the
 * platform's sound toggle (`@/lib/sfx`), and attenuates one-shots by their
 * distance from the listener.
 */

import { isSoundEnabled, onSoundChange } from "@/lib/sfx";
import type { SoundName } from "./world";

export class ArenaAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private engine: { osc: OscillatorNode; osc2: OscillatorNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private whine: { osc: OscillatorNode; gain: GainNode } | null = null;
  private roar: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private enabled = isSoundEnabled();
  private readonly off: () => void;
  private lx = 0;
  private lz = 0;
  private lastAt = new Map<string, number>();

  constructor() {
    this.off = onSoundChange((on) => {
      this.enabled = on;
      if (this.master && this.ctx) this.master.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, 0.05);
    });
  }

  /** Creates the audio graph (call from a user gesture or once the match starts). */
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
      this.master.gain.value = this.enabled ? 0.5 : 0;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  resume(): void {
    this.ensure();
  }

  setListener(x: number, z: number): void {
    this.lx = x;
    this.lz = z;
  }

  /* Continuous voices ---------------------------------------------------- */

  /** Your engine: `load` 0..1 (throttle), `speed` 0..1 of top speed, boost adds grit. */
  setEngine(active: boolean, speed: number, load: number, boost: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    if (!this.engine && active) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      const osc2 = ctx.createOscillator();
      osc2.type = "square";
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.Q.value = 4;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(filter);
      osc2.connect(filter);
      filter.connect(gain).connect(this.master);
      osc.start();
      osc2.start();
      this.engine = { osc, osc2, filter, gain };
    }
    if (!this.engine) return;
    const t = ctx.currentTime;
    const rpm = 38 + speed * 95 + load * 18 + (boost ? 30 : 0);
    this.engine.osc.frequency.setTargetAtTime(rpm, t, 0.08);
    this.engine.osc2.frequency.setTargetAtTime(rpm * 0.5, t, 0.08);
    this.engine.filter.frequency.setTargetAtTime(260 + speed * 900 + load * 500 + (boost ? 900 : 0), t, 0.1);
    this.engine.gain.gain.setTargetAtTime(active ? 0.1 + load * 0.08 + (boost ? 0.06 : 0) : 0, t, 0.12);
  }

  /** Spinner whine 0..1. */
  setWhine(level: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    if (!this.whine && level > 0.01) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain).connect(this.master);
      osc.start();
      this.whine = { osc, gain };
    }
    if (!this.whine) return;
    const t = ctx.currentTime;
    this.whine.osc.frequency.setTargetAtTime(180 + level * 1400, t, 0.1);
    this.whine.gain.gain.setTargetAtTime(level * level * 0.06, t, 0.1);
  }

  /** Flame roar volume 0..1. */
  setRoar(level: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    if (!this.roar && level > 0.01) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 900;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.master);
      src.start();
      this.roar = { src, filter, gain };
    }
    if (!this.roar) return;
    this.roar.gain.gain.setTargetAtTime(level * 0.35, ctx.currentTime, 0.06);
  }

  /* One-shots ------------------------------------------------------------ */

  play(name: SoundName, volume = 1, x?: number, z?: number): void {
    if (!this.enabled) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    // De-dupe floods (e.g. 3 spark hits in one frame).
    const now = performance.now();
    if ((this.lastAt.get(name) ?? 0) > now - 45) return;
    this.lastAt.set(name, now);
    let v = volume;
    if (x !== undefined && z !== undefined) {
      const d = Math.hypot(x - this.lx, z - this.lz);
      v *= 1 / (1 + d * 0.08);
    }
    if (v < 0.02) return;
    const t = ctx.currentTime;
    switch (name) {
      case "impact":
        this.thump(t, 110, 50, 0.16, 0.7 * v);
        this.hiss(t, 0.12, 2500, 800, 0.5 * v, 1.5);
        this.ring(t, [620, 1480, 2210], 0.18, 0.12 * v);
        break;
      case "bigImpact":
        this.thump(t, 80, 32, 0.4, 1 * v);
        this.hiss(t, 0.35, 3200, 300, 0.7 * v, 0.8);
        this.ring(t, [340, 870, 1330, 2400], 0.5, 0.18 * v);
        break;
      case "clang":
      case "wall":
        this.thump(t, 70, 40, 0.2, 0.6 * v);
        this.ring(t, [410, 980, 1620], 0.35, 0.15 * v);
        break;
      case "flip":
        this.hiss(t, 0.22, 5200, 1400, 0.6 * v, 0.9);
        this.thump(t + 0.02, 140, 60, 0.12, 0.6 * v);
        this.ring(t + 0.02, [520, 1210], 0.2, 0.1 * v);
        break;
      case "hammer":
        this.hiss(t, 0.14, 1800, 500, 0.35 * v, 1);
        this.thump(t + 0.02, 95, 38, 0.3, 0.95 * v);
        this.ring(t + 0.02, [300, 720, 1180, 1990], 0.6, 0.2 * v);
        break;
      case "ko":
        this.thump(t, 60, 24, 0.9, 1 * v);
        this.hiss(t, 1.1, 1400, 120, 0.9 * v, 0.6);
        this.ring(t + 0.05, [210, 530, 890], 0.9, 0.12 * v);
        break;
      case "saw":
        this.hiss(t, 0.25, 4200, 3600, 0.4 * v, 6);
        this.buzz(t, 330, 0.25, 0.08 * v);
        break;
      case "vent":
        this.hiss(t, 1.2, 600, 300, 0.6 * v, 0.7);
        break;
      case "pulverizer":
        this.thump(t, 55, 22, 0.7, 1 * v);
        this.hiss(t, 0.5, 2200, 150, 0.8 * v, 0.6);
        this.ring(t, [180, 470, 760], 0.8, 0.14 * v);
        break;
      case "boost":
        this.hiss(t, 0.45, 600, 3200, 0.35 * v, 1.2);
        break;
      case "selfRight":
        this.hiss(t, 0.3, 4200, 1500, 0.5 * v, 1);
        this.thump(t + 0.1, 120, 50, 0.2, 0.7 * v);
        break;
    }
  }

  private thump(t: number, from: number, to: number, dur: number, gain: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private hiss(t: number, dur: number, from: number, to: number, gain: number, q: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = q;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, to), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  /** Metallic ring: inharmonic partials with fast decay. */
  private ring(t: number, freqs: number[], dur: number, gain: number): void {
    const ctx = this.ctx!;
    for (const [i, fq] of freqs.entries()) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = fq * (0.97 + Math.random() * 0.06);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain / (1 + i * 0.4), t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur / (1 + i * 0.3));
      o.connect(g).connect(this.master!);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  private buzz(t: number, freq: number, dur: number, gain: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sawtooth";
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  dispose(): void {
    this.off();
    try {
      this.engine?.osc.stop();
      this.engine?.osc2.stop();
      this.whine?.osc.stop();
      this.roar?.src.stop();
    } catch {
      // already stopped
    }
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}

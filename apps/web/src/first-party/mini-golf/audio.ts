/**
 * Mini Golf sounds, synthesized with WebAudio (no assets): the putter tock
 * (brighter and louder with power), wall knocks, rubber bumpers, sand, the
 * splash, tubes, the cup rattle, and a crowd for a hole in one. Follows the
 * platform's sound toggle (`@/lib/sfx`).
 */

import { isSoundEnabled, onSoundChange } from "@/lib/sfx";

type Ctx = AudioContext;

export class GolfAudio {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private enabled = isSoundEnabled();
  private off: (() => void) | null = null;
  private last = new Map<string, number>();

  /** Follow the platform's sound toggle (call when the view mounts). */
  attach(): void {
    if (this.off) return;
    this.enabled = isSoundEnabled();
    this.off = onSoundChange((on) => {
      this.enabled = on;
      if (this.master && this.ctx) this.master.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.05);
    });
  }

  private ensure(): Ctx | null {
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
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  /** Call from a user gesture so iOS lets us play. */
  resume(): void {
    this.ensure();
  }

  /** Stop listening and release the audio context (a later sound makes a new one). */
  detach(): void {
    this.off?.();
    this.off = null;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.master = null;
  }

  /** Skip repeats of the same sound within `ms` (a ball grinding along a wall). */
  private throttle(key: string, ms: number): boolean {
    const now = performance.now();
    if (now - (this.last.get(key) ?? -1e9) < ms) return true;
    this.last.set(key, now);
    return false;
  }

  private tone(o: { freq: number; to?: number; type?: OscillatorType; at?: number; dur: number; gain: number; attack?: number }): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.enabled) return;
    const t0 = ctx.currentTime + (o.at ?? 0);
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = o.type ?? "sine";
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + o.dur);
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t0 + (o.attack ?? 0.004));
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    osc.connect(env).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.03);
  }

  private hiss(o: { from: number; to: number; dur: number; gain: number; at?: number; q?: number; type?: BiquadFilterType; attack?: number }): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise || !this.enabled) return;
    const t0 = ctx.currentTime + (o.at ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = o.type ?? "bandpass";
    filter.Q.value = o.q ?? 1;
    filter.frequency.setValueAtTime(o.from, t0);
    filter.frequency.exponentialRampToValueAtTime(o.to, t0 + o.dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t0 + (o.attack ?? 0.01));
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    src.connect(filter).connect(env).connect(this.master);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + o.dur + 0.05);
  }

  /* Sounds ------------------------------------------------------------- */

  /** The putter: a woody tock, fuller and louder with power (0..1). */
  putt(power: number): void {
    if (!this.ensure()) return;
    const p = Math.max(0.05, Math.min(1, power));
    this.tone({ freq: 900 + p * 500, to: 420, dur: 0.07, gain: 0.25 + p * 0.5, attack: 0.002 });
    this.tone({ freq: 190 + p * 60, to: 110, dur: 0.12 + p * 0.06, gain: 0.2 + p * 0.45, type: "triangle", attack: 0.002 });
    this.hiss({ from: 5000, to: 2500, dur: 0.03, gain: 0.08 + p * 0.25, q: 0.8, attack: 0.001 });
  }

  /** Ball against a wall or block, by impact speed. */
  knock(speed: number, volume = 1): void {
    if (speed < 0.25 || !this.ensure() || this.throttle("knock", 45)) return;
    const s = Math.min(1, speed / 8) * volume;
    this.tone({ freq: 520 + s * 260, to: 260, dur: 0.06, gain: 0.08 + s * 0.45, type: "triangle", attack: 0.002 });
    this.hiss({ from: 1800, to: 900, dur: 0.035, gain: 0.05 + s * 0.2, q: 2, attack: 0.001 });
  }

  bumper(speed: number, volume = 1): void {
    if (!this.ensure() || this.throttle("bumper", 60)) return;
    const s = Math.min(1, speed / 6) * volume;
    this.tone({ freq: 220, to: 520, dur: 0.16, gain: 0.2 + s * 0.4, type: "sine", attack: 0.003 });
    this.tone({ freq: 660, to: 330, dur: 0.12, gain: 0.08 + s * 0.2, type: "triangle", at: 0.02 });
  }

  obstacle(speed: number, volume = 1): void {
    if (!this.ensure() || this.throttle("obstacle", 60)) return;
    const s = Math.min(1, speed / 6) * volume;
    this.tone({ freq: 340, to: 170, dur: 0.1, gain: 0.12 + s * 0.4, type: "square", attack: 0.002 });
    this.hiss({ from: 900, to: 400, dur: 0.06, gain: 0.08 + s * 0.2 });
  }

  sand(volume = 1): void {
    if (!this.ensure() || this.throttle("sand", 250)) return;
    this.hiss({ from: 2400, to: 700, dur: 0.35, gain: 0.22 * volume, q: 0.6, type: "lowpass", attack: 0.02 });
  }

  splash(volume = 1): void {
    if (!this.ensure()) return;
    this.hiss({ from: 1600, to: 180, dur: 0.6, gain: 0.55 * volume, q: 0.7, attack: 0.005 });
    this.hiss({ from: 4000, to: 1200, dur: 0.25, gain: 0.25 * volume, q: 0.5, attack: 0.002 });
    for (let i = 0; i < 6; i++) {
      const f = 380 + Math.random() * 600;
      this.tone({ freq: f, to: f * 1.8, dur: 0.06, gain: 0.08 * volume, at: 0.18 + i * 0.07 + Math.random() * 0.05 });
    }
  }

  tubeIn(volume = 1): void {
    if (!this.ensure()) return;
    this.tone({ freq: 700, to: 160, dur: 0.3, gain: 0.25 * volume, type: "triangle" });
    this.hiss({ from: 600, to: 2400, dur: 0.5, gain: 0.18 * volume, q: 4, at: 0.05 });
  }

  tubeOut(volume = 1): void {
    if (!this.ensure()) return;
    this.tone({ freq: 180, to: 620, dur: 0.18, gain: 0.3 * volume, type: "triangle" });
    this.hiss({ from: 2000, to: 800, dur: 0.18, gain: 0.15 * volume, q: 3 });
  }

  launch(): void {
    if (!this.ensure()) return;
    this.hiss({ from: 400, to: 3000, dur: 0.45, gain: 0.25, q: 1.5 });
    this.tone({ freq: 300, to: 900, dur: 0.35, gain: 0.12, type: "triangle" });
  }

  land(speed: number, volume = 1): void {
    if (!this.ensure() || this.throttle("land", 80)) return;
    const s = Math.min(1, speed / 4) * volume;
    this.tone({ freq: 140, to: 70, dur: 0.14, gain: 0.2 + s * 0.5, attack: 0.002 });
  }

  boost(): void {
    if (!this.ensure() || this.throttle("boost", 300)) return;
    this.tone({ freq: 300, to: 1400, dur: 0.28, gain: 0.22, type: "sawtooth" });
    this.tone({ freq: 600, to: 2200, dur: 0.22, gain: 0.1, type: "square", at: 0.04 });
  }

  lip(): void {
    if (!this.ensure()) return;
    this.tone({ freq: 2400, to: 1800, dur: 0.04, gain: 0.2, type: "triangle" });
    this.tone({ freq: 2100, to: 1500, dur: 0.05, gain: 0.16, type: "triangle", at: 0.07 });
  }

  /** The best sound in golf: rattle around the cup, then the plunk. */
  cup(volume = 1): void {
    if (!this.ensure()) return;
    for (let i = 0; i < 4; i++) {
      this.tone({ freq: 2600 - i * 180, to: 1900 - i * 150, dur: 0.045, gain: (0.24 - i * 0.04) * volume, type: "triangle", at: i * 0.055 });
    }
    this.tone({ freq: 240, to: 120, dur: 0.22, gain: 0.45 * volume, at: 0.24, attack: 0.003 });
    this.hiss({ from: 900, to: 300, dur: 0.12, gain: 0.12 * volume, at: 0.24 });
  }

  /** A crowd going wild for a hole in one. */
  applause(): void {
    if (!this.ensure()) return;
    for (let i = 0; i < 70; i++) {
      const at = Math.pow(Math.random(), 0.7) * 2.4;
      const f = 1200 + Math.random() * 2400;
      this.hiss({ from: f, to: f * 0.7, dur: 0.05 + Math.random() * 0.04, gain: 0.05 + Math.random() * 0.1, at, q: 1.4, attack: 0.002 });
    }
    this.hiss({ from: 800, to: 1400, dur: 2.6, gain: 0.12, q: 0.4, attack: 0.3 });
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone({ freq: f, dur: 0.3, gain: 0.25, type: "triangle", at: 0.1 + i * 0.1 }));
  }

  /** Birdie / eagle chime. */
  chime(big: boolean): void {
    if (!this.ensure()) return;
    const notes = big ? [659.25, 830.61, 987.77, 1318.5] : [783.99, 1174.66];
    notes.forEach((f, i) => this.tone({ freq: f, dur: 0.28, gain: 0.22, type: "triangle", at: i * 0.08 }));
  }

  /** Bogey or worse: a deflated two-note. */
  sag(): void {
    if (!this.ensure()) return;
    this.tone({ freq: 392, to: 370, dur: 0.22, gain: 0.14, type: "triangle" });
    this.tone({ freq: 330, to: 262, dur: 0.4, gain: 0.14, type: "triangle", at: 0.18 });
  }

  /** Soft tick while pulling back the putter (rises with power). */
  aimTick(power: number): void {
    if (!this.ensure() || this.throttle("aim", 55)) return;
    this.tone({ freq: 500 + power * 900, dur: 0.025, gain: 0.05, type: "sine" });
  }
}

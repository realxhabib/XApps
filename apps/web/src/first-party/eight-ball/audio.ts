/**
 * Table sound, synthesized with WebAudio (no assets): the phenolic click of
 * two balls (louder and brighter the harder they meet), the dull thud of a
 * cushion, the rattle-and-drop of a pocket and the knock of the cue tip.
 * Follows the platform's sound toggle (`@/lib/sfx`).
 */

import { isSoundEnabled, onSoundChange } from "@/lib/sfx";

export class PoolAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private enabled = isSoundEnabled();
  private off: (() => void) | null = null;
  /** Recent one-shots per kind, so a burst of simultaneous clicks (the break) doesn't clip. */
  private recent = new Map<string, number[]>();

  /** Creates the audio graph (from a user gesture, or lazily on the first sound). */
  private ensure(): AudioContext | null {
    if (typeof window === "undefined") return null;
    this.off ??= onSoundChange((on) => {
      this.enabled = on;
      if (this.master && this.ctx) this.master.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.05);
    });
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
      const len = Math.floor(this.ctx.sampleRate * 0.5);
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

  /** Allows at most `max` sounds of a kind per 60 ms window. */
  private budget(kind: string, max: number): boolean {
    const now = performance.now();
    const list = (this.recent.get(kind) ?? []).filter((t) => now - t < 60);
    if (list.length >= max) {
      this.recent.set(kind, list);
      return false;
    }
    list.push(now);
    this.recent.set(kind, list);
    return true;
  }

  private voice(opts: { freq: number; to?: number; type?: OscillatorType; gain: number; decay: number; start?: number; attack?: number }) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + (opts.start ?? 0);
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = opts.type ?? "sine";
    osc.frequency.setValueAtTime(opts.freq, t0);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, t0 + opts.decay);
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.gain), t0 + (opts.attack ?? 0.002));
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.decay);
    osc.connect(env).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + opts.decay + 0.02);
  }

  private burst(opts: { gain: number; decay: number; freq: number; q?: number; type?: BiquadFilterType; start?: number }) {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const t0 = ctx.currentTime + (opts.start ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = opts.type ?? "bandpass";
    filter.frequency.value = opts.freq;
    filter.Q.value = opts.q ?? 1;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.gain), t0 + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.decay);
    src.connect(filter).connect(env).connect(this.master);
    src.start(t0, Math.random() * 0.3);
    src.stop(t0 + opts.decay + 0.02);
  }

  /** Two balls meet at `speed` m/s. */
  click(speed: number): void {
    if (!this.enabled || !this.ensure() || !this.budget("click", 3)) return;
    const v = Math.min(1, speed / 4);
    const gain = 0.08 + 0.9 * Math.pow(v, 0.8);
    const pitch = 2600 + 1800 * v + Math.random() * 300;
    this.voice({ freq: pitch, to: pitch * 0.92, type: "sine", gain: gain * 0.55, decay: 0.035 + 0.02 * v });
    this.voice({ freq: pitch * 1.52, type: "sine", gain: gain * 0.25, decay: 0.025 });
    this.burst({ gain: gain * 0.5, decay: 0.018, freq: 5200, q: 0.9 });
  }

  /** A ball hits a cushion at `speed` m/s (normal component). */
  rail(speed: number): void {
    if (!this.enabled || !this.ensure() || !this.budget("rail", 3)) return;
    const v = Math.min(1, speed / 3);
    const gain = 0.06 + 0.6 * v;
    this.voice({ freq: 150 + 60 * v, to: 70, type: "sine", gain: gain * 0.9, decay: 0.09 + 0.05 * v });
    this.burst({ gain: gain * 0.35, decay: 0.05, freq: 900, q: 0.7, type: "lowpass" });
  }

  /** A ball drops into a pocket. */
  pocket(speed = 1): void {
    if (!this.enabled || !this.ensure() || !this.budget("pocket", 2)) return;
    const v = Math.min(1, speed);
    // Rattle in the jaws, then the knock of the ball landing in the pocket.
    for (let k = 0; k < 3; k++) {
      this.voice({ freq: 1500 + Math.random() * 700, type: "triangle", gain: 0.12 * (1 - k * 0.25), decay: 0.03, start: k * 0.045 });
    }
    this.voice({ freq: 190, to: 95, type: "sine", gain: 0.55 + 0.25 * v, decay: 0.22, start: 0.13 });
    this.burst({ gain: 0.25, decay: 0.18, freq: 420, q: 0.8, type: "lowpass", start: 0.13 });
  }

  /** The tip strikes the cue ball at `speed` m/s. */
  cue(speed: number): void {
    if (!this.enabled || !this.ensure()) return;
    const v = Math.min(1, speed / 7);
    const gain = 0.18 + 0.8 * v;
    this.voice({ freq: 780 + 400 * v, to: 520, type: "triangle", gain: gain * 0.45, decay: 0.05 });
    this.burst({ gain: gain * 0.55, decay: 0.035, freq: 2400, q: 1.2 });
    this.voice({ freq: 110, to: 60, type: "sine", gain: gain * 0.35, decay: 0.08 });
  }

  /** A soft tick for UI (calling a pocket, placing the cue ball). */
  tick(): void {
    if (!this.enabled || !this.ensure()) return;
    this.voice({ freq: 1320, type: "sine", gain: 0.12, decay: 0.04 });
  }

  /** Releases the audio graph; the next sound builds it again. */
  dispose(): void {
    this.off?.();
    this.off = null;
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    if (ctx) void ctx.close().catch(() => {});
  }
}

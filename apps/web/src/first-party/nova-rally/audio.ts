/**
 * Nova Rally sound: everything is synthesized with WebAudio (no assets).
 *
 * - `engine()` drives a continuous rocket engine (saw + square sub through a
 *   speed-tracking filter, filtered-noise rumble, a boost hiss with bright
 *   harmonics, and a drift whine that climbs with the mini-turbo tier).
 * - `play()` fires one-shot effects (items, boosts, hits, UI, jingles).
 * - `music()` runs a sequenced synth track per course with a lookahead
 *   scheduler (drums, bass, chord pads, arpeggio and a lead hook).
 *
 * Follows the platform's sound toggle (`@/lib/sfx`). Nothing touches `window`
 * until a method is called, so importing this during SSR is safe.
 */

import { isSoundEnabled, onSoundChange } from "@/lib/sfx";

export type RaceSound =
  | "countdown"
  | "go"
  | "rocketStart"
  | "stall"
  | "boost"
  | "boostPad"
  | "miniTurbo1"
  | "miniTurbo2"
  | "miniTurbo3"
  | "driftStart"
  | "itemBox"
  | "roulette"
  | "rouletteStop"
  | "fire"
  | "missile"
  | "mineDrop"
  | "shieldUp"
  | "shieldPop"
  | "explosion"
  | "spinout"
  | "empZap"
  | "singularity"
  | "warp"
  | "cloak"
  | "wallHit"
  | "bump"
  | "land"
  | "trick"
  | "coin"
  | "jump"
  | "fall"
  | "respawn"
  | "lap"
  | "finalLap"
  | "finish"
  | "win"
  | "lose"
  | "positionUp"
  | "positionDown"
  | "select"
  | "click"
  | "whoosh";

export type MusicTheme = "mars" | "belt" | "saturn" | "nebula" | "luna" | "menu";

/* ------------------------------------------------------------------------ */
/* Levels                                                                    */
/* ------------------------------------------------------------------------ */

const MASTER = 0.62;
const SFX_BUS = 1;
const ENGINE_BUS = 0.55;
/** Music bus gain at musicVolume 1 (music sits well under the effects). */
const MUSIC_BUS = 0.38;

/** Minimum ms between two plays of the same sound (default 50ms). */
const RATE: Partial<Record<RaceSound, number>> = {
  roulette: 350,
  explosion: 80,
  wallHit: 90,
  bump: 70,
  spinout: 200,
  finish: 800,
  win: 800,
  lose: 800,
  finalLap: 800,
  lap: 300,
  countdown: 200,
  go: 400,
};

/* ------------------------------------------------------------------------ */
/* Music data                                                                */
/* ------------------------------------------------------------------------ */

type Wave = OscillatorType | "pulse";
type Quality = "M" | "m" | "M7" | "m7" | "5";

const QUALITY: Record<Quality, number[]> = {
  M: [0, 4, 7],
  m: [0, 3, 7],
  M7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  "5": [0, 7, 12],
};

interface VoiceDef {
  wave: Wave;
  detune: number;
  cutoff: number;
  q: number;
  gain: number;
  vibrato: number;
  /** Filter envelope start as a multiple of cutoff (pluckiness). */
  pluck: number;
  /** Fraction of the written length that sounds. */
  legato: number;
}

interface ThemeDef {
  bpm: number;
  /** MIDI note of the key root in the bass octave. */
  key: number;
  /** Semitones added to `key` for the melody. */
  leadOct: number;
  chords: [number, Quality][];
  /** One string per bar: 8 eighth-note tokens (semitones from the lead root, "-" hold, "." rest). */
  melody: string[];
  /** 16 sixteenth tokens: semitones from the chord root, "." rest. */
  bass: string;
  kick: string;
  snare: string;
  /** "x" closed, "o" open. */
  hat: string;
  lead: VoiceDef;
  bassVoice: { wave: Wave; cutoff: number; q: number; gain: number; sub: number };
  pad: { wave: Wave; cutoff: number; gain: number; attack: number; gate: number } | null;
  arp: { wave: Wave; rate: number; oct: number; gain: number; decay: number; cutoff: number } | null;
  drive: number;
  echo: number;
  chip: boolean;
  drumGain: number;
  fill: boolean;
}

interface MelNote {
  n: number;
  len: number;
}

interface Theme extends ThemeDef {
  bars: number;
  mel: (MelNote | null)[];
  bassSteps: (number | null)[];
  bassLen: number[];
}

const THEMES: Record<MusicTheme, ThemeDef> = {
  // Driving rock-ish synth in E minor: chugging power chords and a gritty saw lead.
  mars: {
    bpm: 160,
    key: 40,
    leadOct: 24,
    chords: [
      [0, "m"],
      [8, "M"],
      [3, "M"],
      [10, "M"],
      [0, "m"],
      [8, "M"],
      [10, "M"],
      [7, "M"],
    ],
    melody: [
      "7 . 7 12 10 . 7 3",
      "8 - 12 - 15 - 12 10",
      "7 . 7 10 15 - 14 10",
      "14 - - . 10 12 14 17",
      "19 . 19 17 15 . 14 12",
      "15 - 12 - 8 . 12 15",
      "14 - 17 - 14 12 10 14",
      "11 - - - 7 . 11 14",
    ],
    bass: "0 . 0 . 12 . 0 . 0 . 0 . 12 . 10 .",
    kick: "x.....x.x.....x.",
    snare: "....x.......x...",
    hat: "x.x.x.x.x.x.x.x.",
    lead: { wave: "sawtooth", detune: 9, cutoff: 2600, q: 2, gain: 0.085, vibrato: 14, pluck: 2, legato: 0.92 },
    bassVoice: { wave: "sawtooth", cutoff: 650, q: 5, gain: 0.17, sub: 0.6 },
    pad: { wave: "sawtooth", cutoff: 1300, gain: 0.018, attack: 0.01, gate: 2 },
    arp: { wave: "pulse", rate: 2, oct: 1, gain: 0.022, decay: 0.12, cutoff: 3200 },
    drive: 3,
    echo: 0.12,
    chip: false,
    drumGain: 1,
    fill: true,
  },
  // Dark electro in A minor: rolling square bass, gated pads, stabby resonant lead.
  belt: {
    bpm: 150,
    key: 33,
    leadOct: 24,
    chords: [
      [0, "m"],
      [0, "m"],
      [8, "M"],
      [10, "M"],
      [0, "m"],
      [0, "m"],
      [5, "m"],
      [7, "M"],
    ],
    melody: [
      "12 . 12 . 15 . 12 10",
      "7 . . 7 8 . 7 3",
      "12 . 12 . 15 . 17 15",
      "14 - - . 10 . 14 .",
      "12 . 12 . 15 . 19 17",
      "15 - 12 . 10 . 12 .",
      "8 . 12 . 17 . 15 12",
      "11 - 7 - 11 . 14 .",
    ],
    bass: "0 . 0 0 . 0 0 . 0 . 0 0 . 12 0 .",
    kick: "x...x...x...x...",
    snare: "....x.......x...",
    hat: "xxo.xxo.xxo.xxox",
    lead: { wave: "square", detune: 0, cutoff: 1700, q: 7, gain: 0.07, vibrato: 0, pluck: 3.5, legato: 0.7 },
    bassVoice: { wave: "square", cutoff: 480, q: 8, gain: 0.16, sub: 0.8 },
    pad: { wave: "sawtooth", cutoff: 900, gain: 0.018, attack: 0.005, gate: 2 },
    arp: { wave: "sawtooth", rate: 1, oct: 1, gain: 0.028, decay: 0.09, cutoff: 2200 },
    drive: 0,
    echo: 0.25,
    chip: false,
    drumGain: 1,
    fill: true,
  },
  // Dreamy and airy in D major: soft pads, bell arps, a singing triangle lead with echo.
  saturn: {
    bpm: 142,
    key: 38,
    leadOct: 24,
    chords: [
      [0, "M"],
      [7, "M"],
      [9, "m"],
      [5, "M"],
      [0, "M"],
      [7, "M"],
      [5, "M"],
      [7, "M"],
    ],
    melody: [
      "12 - 11 - 9 - 7 -",
      "9 - - 11 - - 7 -",
      "12 - 14 - 16 - 14 12",
      "14 - - - 12 - - -",
      "12 - 11 - 9 - 7 4",
      "7 - 9 - 11 - 14 -",
      "16 - 14 - 12 - 9 -",
      "11 - - - 7 - - -",
    ],
    bass: "0 . . . . . 0 . . . 7 . . . 12 .",
    kick: "x.........x.....",
    snare: "....x.......x...",
    hat: "..x...x...x...x.",
    lead: { wave: "triangle", detune: 5, cutoff: 5000, q: 0.7, gain: 0.13, vibrato: 18, pluck: 1, legato: 0.95 },
    bassVoice: { wave: "triangle", cutoff: 900, q: 1, gain: 0.24, sub: 0.4 },
    pad: { wave: "triangle", cutoff: 2500, gain: 0.035, attack: 0.3, gate: 0 },
    arp: { wave: "sine", rate: 1, oct: 2, gain: 0.04, decay: 0.25, cutoff: 6000 },
    drive: 0,
    echo: 0.35,
    chip: false,
    drumGain: 0.8,
    fill: false,
  },
  // Synthwave in C minor: octave bass, lush detuned pads, big saw lead.
  nebula: {
    bpm: 150,
    key: 36,
    leadOct: 12,
    chords: [
      [0, "m"],
      [8, "M"],
      [3, "M"],
      [10, "M"],
      [0, "m"],
      [8, "M"],
      [10, "M"],
      [7, "M"],
    ],
    melody: [
      "12 . 15 . 19 - 17 15",
      "15 - 12 - 8 - 12 -",
      "10 . 15 . 19 - 22 19",
      "17 - - - 14 - 10 -",
      "12 . 15 . 19 - 24 22",
      "20 - 19 - 15 - 12 -",
      "14 - 17 - 22 - 19 17",
      "19 - - - 14 - 11 -",
    ],
    bass: "0 . 12 . 0 . 12 . 0 . 12 . 0 . 12 .",
    kick: "x...x...x...x...",
    snare: "....x.......x...",
    hat: "x.x.x.x.x.x.x.x.",
    lead: { wave: "sawtooth", detune: 12, cutoff: 3200, q: 1.5, gain: 0.08, vibrato: 10, pluck: 1.6, legato: 0.92 },
    bassVoice: { wave: "sawtooth", cutoff: 600, q: 3, gain: 0.16, sub: 0.7 },
    pad: { wave: "sawtooth", cutoff: 1600, gain: 0.02, attack: 0.15, gate: 0 },
    arp: { wave: "pulse", rate: 1, oct: 1, gain: 0.026, decay: 0.1, cutoff: 3500 },
    drive: 0,
    echo: 0.3,
    chip: false,
    drumGain: 1,
    fill: true,
  },
  // Bouncy chiptune in C major: pulse lead, triangle bass, crunchy noise drums.
  luna: {
    bpm: 168,
    key: 36,
    leadOct: 24,
    chords: [
      [0, "M"],
      [7, "M"],
      [9, "m"],
      [5, "M"],
      [0, "M"],
      [7, "M"],
      [5, "M"],
      [7, "M"],
    ],
    melody: [
      "7 . 12 . 16 - 14 12",
      "14 . 11 . 7 - . 11",
      "12 . 16 . 21 - 19 16",
      "17 - 16 - 14 - 12 -",
      "7 . 12 . 16 - 19 21",
      "19 . 14 . 11 - 14 .",
      "17 . 16 . 14 . 12 14",
      "11 - 14 - 19 - . .",
    ],
    bass: "0 . 12 . 7 . 12 . 0 . 12 . 7 . 12 .",
    kick: "x.......x.x.....",
    snare: "....x.......x..x",
    hat: "x.x.x.x.x.x.x.x.",
    lead: { wave: "pulse", detune: 0, cutoff: 9000, q: 0.5, gain: 0.07, vibrato: 0, pluck: 1, legato: 0.85 },
    bassVoice: { wave: "triangle", cutoff: 5000, q: 0.5, gain: 0.26, sub: 0 },
    pad: null,
    arp: { wave: "square", rate: 1, oct: 1, gain: 0.026, decay: 0.06, cutoff: 8000 },
    drive: 0,
    echo: 0,
    chip: true,
    drumGain: 0.9,
    fill: true,
  },
  // Chill menu loop in G major: jazzy sevenths, soft bells.
  menu: {
    bpm: 108,
    key: 43,
    leadOct: 12,
    chords: [
      [0, "M7"],
      [9, "m7"],
      [5, "M7"],
      [7, "M"],
      [0, "M7"],
      [9, "m7"],
      [5, "M7"],
      [7, "M"],
    ],
    melody: [
      "7 - 11 - 14 - - -",
      "12 - - 11 9 - - -",
      "9 - 12 - 16 - 14 -",
      "14 - - - . . 11 12",
      "14 - 11 - 7 - 11 -",
      "16 - - 14 12 - 11 -",
      "9 - 12 - 16 - 19 -",
      "18 - - - 14 - - -",
    ],
    bass: "0 . . . . . . 7 . . 0 . . . 12 .",
    kick: "x.........x.....",
    snare: "....x.......x...",
    hat: "x.x.x.x.x.x.x.x.",
    lead: { wave: "triangle", detune: 4, cutoff: 3000, q: 0.7, gain: 0.1, vibrato: 10, pluck: 1.2, legato: 0.95 },
    bassVoice: { wave: "sine", cutoff: 800, q: 1, gain: 0.26, sub: 0 },
    pad: { wave: "triangle", cutoff: 1800, gain: 0.032, attack: 0.25, gate: 0 },
    arp: { wave: "sine", rate: 2, oct: 2, gain: 0.032, decay: 0.3, cutoff: 5000 },
    drive: 0,
    echo: 0.3,
    chip: false,
    drumGain: 0.55,
    fill: false,
  },
};

function compile(def: ThemeDef): Theme {
  const bars = def.chords.length;
  const mel: (MelNote | null)[] = [];
  let last: MelNote | null = null;
  for (const bar of def.melody) {
    for (const tok of bar.trim().split(/\s+/)) {
      if (tok === "-") {
        if (last) last.len++;
        mel.push(null);
      } else if (tok === ".") {
        last = null;
        mel.push(null);
      } else {
        last = { n: Number(tok), len: 1 };
        mel.push(last);
      }
    }
  }
  while (mel.length < bars * 8) mel.push(null);
  const bassSteps = def.bass
    .trim()
    .split(/\s+/)
    .map((t) => (t === "." ? null : Number(t)));
  const bassLen = bassSteps.map((v, i) => {
    if (v === null) return 0;
    let n = 1;
    while (n < 4 && bassSteps[(i + n) % 16] === null) n++;
    return n;
  });
  return { ...def, bars, mel, bassSteps, bassLen };
}

const COMPILED: Partial<Record<MusicTheme, Theme>> = {};
function theme(name: MusicTheme): Theme {
  let t = COMPILED[name];
  if (!t) {
    t = compile(THEMES[name]);
    COMPILED[name] = t;
  }
  return t;
}

const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
const fold = (n: number): number => ((n % 12) + 12) % 12;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/* ------------------------------------------------------------------------ */
/* Engine graph                                                              */
/* ------------------------------------------------------------------------ */

interface EngineNodes {
  out: GainNode;
  saw: OscillatorNode;
  sub: OscillatorNode;
  toneFilter: BiquadFilterNode;
  toneGain: GainNode;
  flutter: OscillatorNode;
  flutterGain: GainNode;
  rumbleFilter: BiquadFilterNode;
  rumbleGain: GainNode;
  hissFilter: BiquadFilterNode;
  hissGain: GainNode;
  harm: OscillatorNode;
  harmGain: GainNode;
  drift1: OscillatorNode;
  drift2: OscillatorNode;
  driftFilter: BiquadFilterNode;
  driftGain: GainNode;
  screechGain: GainNode;
  sources: AudioScheduledSourceNode[];
}

/** Where a one-shot plays: destination, start time and pitch multiplier. */
interface Voice {
  ctx: AudioContext;
  out: AudioNode;
  t: number;
  p: number;
}

interface ToneOpts {
  f: number;
  to?: number;
  type?: Wave;
  at?: number;
  dur: number;
  g: number;
  a?: number;
  det?: number;
  lp?: [number, number];
  q?: number;
  vib?: [number, number];
}

interface NoiseOpts {
  from: number;
  to: number;
  dur: number;
  g: number;
  at?: number;
  q?: number;
  type?: BiquadFilterType;
  a?: number;
}

/* ------------------------------------------------------------------------ */
/* RaceAudio                                                                 */
/* ------------------------------------------------------------------------ */

export class RaceAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private engBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private pulse: PeriodicWave | null = null;
  private enabled = true;
  private off: (() => void) | null = null;
  private last = new Map<string, number>();
  private eng: EngineNodes | null = null;

  // Music state.
  private musicVol = 0.5;
  private wantTheme: MusicTheme | null = null;
  private curTheme: MusicTheme | null = null;
  private song: Theme | null = null;
  private mOut: GainNode | null = null;
  private mLead: AudioNode | null = null;
  private mFx: AudioNode | null = null;
  private mNodes: AudioNode[] = [];
  private timer: number | null = null;
  private step = 0;
  private nextTime = 0;
  private arpIdx = 0;
  private finalLap = false;

  /** Follow the platform's sound toggle (call when the view mounts). */
  attach(): void {
    if (this.off) return;
    this.enabled = isSoundEnabled();
    this.off = onSoundChange((on) => {
      this.enabled = on;
      if (this.master && this.ctx) this.master.gain.setTargetAtTime(on ? MASTER : 0, this.ctx.currentTime, 0.05);
    });
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.enabled ? MASTER : 0, this.ctx.currentTime, 0.05);
  }

  /** Stop listening and release the audio context (a later `resume()` makes a new one and restarts the music). */
  detach(): void {
    this.off?.();
    this.off = null;
    this.stopScheduler();
    this.eng = null;
    this.song = null;
    this.curTheme = null;
    this.mOut = null;
    this.mLead = null;
    this.mFx = null;
    this.mNodes = [];
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    this.sfxBus = null;
    this.engBus = null;
    this.musicBus = null;
    this.noise = null;
    this.pulse = null;
    if (ctx) void ctx.close().catch(() => {});
  }

  /** Call from a user gesture (so browsers let us play). Creates the context lazily. */
  resume(): void {
    this.ensure();
  }

  dispose(): void {
    this.wantTheme = null;
    this.detach();
    this.last.clear();
  }

  private ensure(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      let ctx: AudioContext;
      try {
        ctx = new Ctor();
      } catch {
        return null;
      }
      this.ctx = ctx;
      if (!this.off) this.enabled = isSoundEnabled();
      const master = ctx.createGain();
      master.gain.value = this.enabled ? MASTER : 0;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 8;
      comp.ratio.value = 6;
      comp.attack.value = 0.003;
      comp.release.value = 0.2;
      const trim = ctx.createGain();
      trim.gain.value = 0.9;
      master.connect(comp).connect(trim).connect(ctx.destination);
      this.master = master;
      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = SFX_BUS;
      this.sfxBus.connect(master);
      this.engBus = ctx.createGain();
      this.engBus.gain.value = ENGINE_BUS;
      this.engBus.connect(master);
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = this.musicVol * MUSIC_BUS;
      this.musicBus.connect(master);

      const len = ctx.sampleRate * 2;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

      // 25% pulse for chiptune / nasal voices.
      const n = 32;
      const real = new Float32Array(n);
      const imag = new Float32Array(n);
      for (let k = 1; k < n; k++) {
        real[k] = Math.sin(2 * Math.PI * k * 0.25) / k;
        imag[k] = (1 - Math.cos(2 * Math.PI * k * 0.25)) / k;
      }
      this.pulse = ctx.createPeriodicWave(real, imag);

      if (this.wantTheme) this.startTheme(this.wantTheme);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  /* ---------------------------------------------------------------------- */
  /* Primitives                                                              */
  /* ---------------------------------------------------------------------- */

  private osc(ctx: AudioContext, wave: Wave): OscillatorNode {
    const o = ctx.createOscillator();
    if (wave === "pulse") {
      if (this.pulse) o.setPeriodicWave(this.pulse);
      else o.type = "square";
    } else if (wave !== "custom") {
      o.type = wave;
    }
    return o;
  }

  private tone(v: Voice, o: ToneOpts): void {
    const { ctx } = v;
    const t0 = v.t + (o.at ?? 0);
    const osc = this.osc(ctx, o.type ?? "sine");
    osc.frequency.setValueAtTime(o.f * v.p, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to * v.p, t0 + o.dur);
    if (o.det) osc.detune.value = o.det;
    let node: AudioNode = osc;
    if (o.lp) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.Q.value = o.q ?? 1;
      f.frequency.setValueAtTime(o.lp[0], t0);
      f.frequency.exponentialRampToValueAtTime(o.lp[1], t0 + o.dur);
      node.connect(f);
      node = f;
    }
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.g), t0 + (o.a ?? 0.004));
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    node.connect(env).connect(v.out);
    const end = t0 + o.dur + 0.05;
    if (o.vib) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = o.vib[0];
      depth.gain.value = o.vib[1];
      lfo.connect(depth).connect(osc.detune);
      lfo.start(t0);
      lfo.stop(end);
    }
    osc.start(t0);
    osc.stop(end);
  }

  private hiss(v: Voice, o: NoiseOpts): void {
    const { ctx } = v;
    if (!this.noise) return;
    const t0 = v.t + (o.at ?? 0);
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
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.g), t0 + (o.a ?? 0.005));
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    src.connect(filter).connect(env).connect(v.out);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + o.dur + 0.05);
  }

  /** Brassy stab/swell: detuned saws with an opening filter (fanfares). */
  private brass(v: Voice, f: number, at: number, dur: number, g: number, vib = 0): void {
    const { ctx } = v;
    const t0 = v.t + at;
    const end = t0 + dur + 0.2;
    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.Q.value = 2;
    filt.frequency.setValueAtTime(350, t0);
    filt.frequency.exponentialRampToValueAtTime(3200, t0 + 0.04);
    filt.frequency.exponentialRampToValueAtTime(1700, t0 + Math.min(dur, 0.3));
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(g, t0 + 0.02);
    env.gain.linearRampToValueAtTime(g * 0.75, t0 + Math.min(dur, 0.2));
    env.gain.setValueAtTime(g * 0.75, t0 + dur);
    env.gain.linearRampToValueAtTime(0, t0 + dur + 0.15);
    filt.connect(env).connect(v.out);
    const oscs: OscillatorNode[] = [];
    for (const [type, mul, det, lvl] of [
      ["sawtooth", 1, -8, 1],
      ["sawtooth", 1, 8, 1],
      ["square", 0.5, 0, 0.35],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f * mul * v.p;
      o.detune.value = det;
      const lg = ctx.createGain();
      lg.gain.value = lvl * 0.5;
      o.connect(lg).connect(filt);
      oscs.push(o);
    }
    if (vib > 0) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = 5.5;
      depth.gain.setValueAtTime(0, t0);
      depth.gain.linearRampToValueAtTime(vib, t0 + Math.min(dur, 0.4));
      lfo.connect(depth);
      for (const o of oscs) depth.connect(o.detune);
      lfo.start(t0);
      lfo.stop(end);
    }
    for (const o of oscs) {
      o.start(t0);
      o.stop(end);
    }
  }

  /** A bell: sine + inharmonic partial + a bright tick. */
  private bell(v: Voice, f: number, at: number, dur: number, g: number): void {
    this.tone(v, { f, at, dur, g, a: 0.002 });
    this.tone(v, { f: f * 2.76, at, dur: dur * 0.45, g: g * 0.3, a: 0.002 });
    this.tone(v, { f: f * 2, type: "triangle", at, dur: dur * 0.25, g: g * 0.35, a: 0.002 });
  }

  private cymbal(v: Voice, at: number, dur: number, g: number): void {
    this.hiss(v, { from: 9000, to: 5000, dur, g, at, q: 0.5, type: "highpass", a: 0.002 });
    this.hiss(v, { from: 6000, to: 3500, dur: dur * 0.5, g: g * 0.6, at, q: 1.5, a: 0.002 });
  }

  /** Skip repeats of the same sound within `ms`. */
  private throttle(key: string, ms: number): boolean {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (now - (this.last.get(key) ?? -1e9) < ms) return true;
    this.last.set(key, now);
    return false;
  }

  /* ---------------------------------------------------------------------- */
  /* Engine                                                                  */
  /* ---------------------------------------------------------------------- */

  private buildEngine(ctx: AudioContext, bus: AudioNode): EngineNodes | null {
    if (!this.noise) return null;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(bus);
    const sources: AudioScheduledSourceNode[] = [];

    // Tonal core: saw + square sub through a tracking lowpass.
    const toneFilter = ctx.createBiquadFilter();
    toneFilter.type = "lowpass";
    toneFilter.frequency.value = 300;
    toneFilter.Q.value = 3;
    const toneGain = ctx.createGain();
    toneGain.gain.value = 0.05;
    toneFilter.connect(toneGain).connect(out);
    const saw = ctx.createOscillator();
    saw.type = "sawtooth";
    saw.frequency.value = 45;
    const sub = ctx.createOscillator();
    sub.type = "square";
    sub.frequency.value = 22.5;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.6;
    saw.connect(toneFilter);
    sub.connect(subGain).connect(toneFilter);
    // Rocket flutter: amplitude wobble that speeds up with revs.
    const flutter = ctx.createOscillator();
    flutter.frequency.value = 9;
    const flutterGain = ctx.createGain();
    flutterGain.gain.value = 0.012;
    flutter.connect(flutterGain).connect(toneGain.gain);
    sources.push(saw, sub, flutter);

    // Rumble: looping noise through a lowpass.
    const rumbleSrc = ctx.createBufferSource();
    rumbleSrc.buffer = this.noise;
    rumbleSrc.loop = true;
    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = "lowpass";
    rumbleFilter.frequency.value = 120;
    rumbleFilter.Q.value = 0.8;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0;
    rumbleSrc.connect(rumbleFilter).connect(rumbleGain).connect(out);
    sources.push(rumbleSrc);

    // Boost: bright hiss plus a high saw harmonic.
    const hissSrc = ctx.createBufferSource();
    hissSrc.buffer = this.noise;
    hissSrc.loop = true;
    const hissFilter = ctx.createBiquadFilter();
    hissFilter.type = "bandpass";
    hissFilter.frequency.value = 3000;
    hissFilter.Q.value = 0.7;
    const hissGain = ctx.createGain();
    hissGain.gain.value = 0;
    hissSrc.connect(hissFilter).connect(hissGain).connect(out);
    const harm = ctx.createOscillator();
    harm.type = "sawtooth";
    harm.frequency.value = 200;
    const harmFilter = ctx.createBiquadFilter();
    harmFilter.type = "highpass";
    harmFilter.frequency.value = 400;
    const harmGain = ctx.createGain();
    harmGain.gain.value = 0;
    harm.connect(harmFilter).connect(harmGain).connect(out);
    sources.push(hissSrc, harm);

    // Drift: a wobbling whine plus a tyre-ish screech band.
    const drift1 = ctx.createOscillator();
    drift1.type = "triangle";
    drift1.frequency.value = 620;
    const drift2 = ctx.createOscillator();
    drift2.type = "square";
    drift2.frequency.value = 930;
    const d2g = ctx.createGain();
    d2g.gain.value = 0.25;
    const driftFilter = ctx.createBiquadFilter();
    driftFilter.type = "bandpass";
    driftFilter.frequency.value = 900;
    driftFilter.Q.value = 2;
    const driftGain = ctx.createGain();
    driftGain.gain.value = 0;
    drift1.connect(driftFilter);
    drift2.connect(d2g).connect(driftFilter);
    driftFilter.connect(driftGain).connect(out);
    const wob = ctx.createOscillator();
    wob.frequency.value = 13;
    const wobGain = ctx.createGain();
    wobGain.gain.value = 22;
    wob.connect(wobGain);
    wobGain.connect(drift1.detune);
    wobGain.connect(drift2.detune);
    const scrSrc = ctx.createBufferSource();
    scrSrc.buffer = this.noise;
    scrSrc.loop = true;
    const scrFilter = ctx.createBiquadFilter();
    scrFilter.type = "bandpass";
    scrFilter.frequency.value = 2600;
    scrFilter.Q.value = 4;
    const screechGain = ctx.createGain();
    screechGain.gain.value = 0;
    scrSrc.connect(scrFilter).connect(screechGain).connect(out);
    sources.push(drift1, drift2, wob, scrSrc);

    const t = ctx.currentTime;
    rumbleSrc.start(t, 0);
    hissSrc.start(t, 0.7);
    scrSrc.start(t, 1.3);
    for (const s of [saw, sub, flutter, harm, drift1, drift2, wob]) s.start(t);
    out.gain.setTargetAtTime(1, t, 0.2);

    return {
      out,
      saw,
      sub,
      toneFilter,
      toneGain,
      flutter,
      flutterGain,
      rumbleFilter,
      rumbleGain,
      hissFilter,
      hissGain,
      harm,
      harmGain,
      drift1,
      drift2,
      driftFilter,
      driftGain,
      screechGain,
      sources,
    };
  }

  /** Called every frame with the local ship state. */
  engine(state: {
    speed01: number;
    throttle: number;
    boost: number;
    drifting: boolean;
    driftTier: number;
    airborne: boolean;
    muted?: boolean;
  }): void {
    const ctx = this.ctx;
    if (!ctx || !this.engBus) return;
    if (!this.eng) this.eng = this.buildEngine(ctx, this.engBus);
    const e = this.eng;
    if (!e) return;
    const t = ctx.currentTime;
    const k = 0.06;
    const s = clamp(Number.isFinite(state.speed01) ? state.speed01 : 0, 0, 1.4);
    const thr = clamp(Number.isFinite(state.throttle) ? state.throttle : 0, 0, 1);
    const b = clamp(Number.isFinite(state.boost) ? state.boost : 0, 0, 1);
    const air = state.airborne;
    const tier = clamp(Math.round(state.driftTier || 0), 0, 3);

    const base = 42 + s * 115 + thr * 10 + (air ? 14 : 0) + b * 12;
    e.saw.frequency.setTargetAtTime(base, t, k);
    e.sub.frequency.setTargetAtTime(base / 2, t, k);
    e.toneFilter.frequency.setTargetAtTime(220 + s * 1500 + thr * 450 + b * 1600, t, k);
    e.toneGain.gain.setTargetAtTime((0.045 + thr * 0.045 + s * 0.045) * (air ? 0.8 : 1), t, k);
    e.flutter.frequency.setTargetAtTime(8 + s * 22, t, k);
    e.flutterGain.gain.setTargetAtTime(0.008 + thr * 0.012, t, k);

    e.rumbleFilter.frequency.setTargetAtTime(90 + s * 380 + b * 450, t, k);
    e.rumbleGain.gain.setTargetAtTime((0.16 + s * 0.2 + thr * 0.1) * (air ? 0.35 : 1), t, 0.08);

    e.hissFilter.frequency.setTargetAtTime(2200 + s * 1600, t, k);
    e.hissGain.gain.setTargetAtTime(b * 0.09, t, b > 0.01 ? 0.03 : 0.15);
    e.harm.frequency.setTargetAtTime(base * 4, t, k);
    e.harmGain.gain.setTargetAtTime(b * 0.03, t, b > 0.01 ? 0.03 : 0.15);

    const drift = state.drifting && !air;
    const df = 560 + tier * 280 + s * 60;
    e.drift1.frequency.setTargetAtTime(df, t, 0.05);
    e.drift2.frequency.setTargetAtTime(df * 1.5, t, 0.05);
    e.driftFilter.frequency.setTargetAtTime(df * 1.4, t, 0.05);
    e.driftGain.gain.setTargetAtTime(drift ? 0.016 + tier * 0.009 : 0, t, 0.05);
    e.screechGain.gain.setTargetAtTime(drift ? 0.04 + s * 0.03 : 0, t, 0.05);

    e.out.gain.setTargetAtTime(state.muted ? 0 : 1, t, 0.08);
  }

  /* ---------------------------------------------------------------------- */
  /* One-shots                                                               */
  /* ---------------------------------------------------------------------- */

  play(sound: RaceSound, opts?: { pan?: number; volume?: number; pitch?: number }): void {
    const ctx = this.ensure();
    if (!ctx || !this.sfxBus || !this.enabled) return;
    const vol = clamp(opts?.volume ?? 1, 0, 1);
    if (vol <= 0.001) return;
    if (this.throttle(sound, RATE[sound] ?? 50)) return;
    const out = ctx.createGain();
    out.gain.value = vol;
    const pan = clamp(opts?.pan ?? 0, -1, 1);
    const nodes: AudioNode[] = [out];
    if (pan !== 0 && typeof ctx.createStereoPanner === "function") {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      out.connect(p).connect(this.sfxBus);
      nodes.push(p);
    } else {
      out.connect(this.sfxBus);
    }
    const pitch = opts?.pitch;
    const v: Voice = { ctx, out, t: ctx.currentTime + 0.005, p: pitch && pitch > 0 && Number.isFinite(pitch) ? pitch : 1 };
    try {
      this.sfx(sound, v);
    } catch {
      // A bad parameter should never break the game loop.
    }
    window.setTimeout(() => {
      for (const n of nodes) n.disconnect();
    }, 4500);
  }

  private sfx(sound: RaceSound, v: Voice): void {
    switch (sound) {
      case "countdown":
        this.tone(v, { f: 440, type: "square", dur: 0.3, g: 0.22, lp: [3200, 1400] });
        this.tone(v, { f: 440, dur: 0.38, g: 0.34 });
        this.tone(v, { f: 880, dur: 0.14, g: 0.09 });
        break;
      case "go":
        for (const f of [880, 1108.73, 1318.51]) this.tone(v, { f, type: "square", dur: 0.9, g: 0.09, lp: [6000, 1800] });
        this.tone(v, { f: 1760, dur: 0.7, g: 0.12, vib: [6, 12] });
        this.tone(v, { f: 440, type: "sawtooth", dur: 0.6, g: 0.06, lp: [4000, 800] });
        this.tone(v, { f: 110, to: 50, dur: 0.4, g: 0.35 });
        this.hiss(v, { from: 800, to: 6000, dur: 0.45, g: 0.1, q: 0.8 });
        break;
      case "rocketStart":
        this.tone(v, { f: 65, to: 38, dur: 0.45, g: 0.5, a: 0.003 });
        this.hiss(v, { from: 400, to: 4200, dur: 0.9, g: 0.38, type: "lowpass", q: 1.5, a: 0.02 });
        this.tone(v, { f: 90, to: 440, type: "sawtooth", dur: 0.75, g: 0.14, lp: [600, 3200], q: 3 });
        this.hiss(v, { from: 3000, to: 6500, dur: 0.8, g: 0.1, type: "highpass", a: 0.05 });
        this.bell(v, 1318.51, 0.04, 0.45, 0.1);
        this.bell(v, 1975.53, 0.1, 0.4, 0.07);
        break;
      case "stall":
        for (let i = 0; i < 4; i++) {
          this.tone(v, { f: 115 - i * 10, to: 60, type: "square", at: i * 0.12, dur: 0.07, g: 0.16, lp: [700, 250] });
          this.hiss(v, { from: 900, to: 200, at: i * 0.12, dur: 0.09, g: 0.2, type: "lowpass", a: 0.002 });
        }
        this.tone(v, { f: 320, to: 70, at: 0.48, dur: 0.5, g: 0.14, type: "triangle" });
        this.hiss(v, { from: 1500, to: 300, at: 0.5, dur: 0.7, g: 0.12, q: 0.6, a: 0.05 });
        break;
      case "boost":
        this.tone(v, { f: 95, to: 42, dur: 0.35, g: 0.5, a: 0.003 });
        this.hiss(v, { from: 300, to: 2800, dur: 0.75, g: 0.42, q: 0.8, a: 0.01 });
        this.tone(v, { f: 140, to: 640, type: "sawtooth", dur: 0.5, g: 0.13, lp: [800, 4500], q: 4 });
        this.tone(v, { f: 280, to: 1280, type: "square", dur: 0.35, g: 0.04, lp: [1500, 6000] });
        this.hiss(v, { from: 4000, to: 7500, dur: 0.65, g: 0.12, type: "highpass", a: 0.02 });
        break;
      case "boostPad":
        this.tone(v, { f: 80, to: 48, dur: 0.2, g: 0.35, a: 0.003 });
        this.hiss(v, { from: 900, to: 6500, dur: 0.38, g: 0.3, q: 1.2 });
        this.tone(v, { f: 400, to: 1700, type: "sawtooth", dur: 0.28, g: 0.08, lp: [1200, 6000], q: 3 });
        [1046.5, 1318.51, 1760].forEach((f, i) => this.tone(v, { f, type: "triangle", at: i * 0.035, dur: 0.2, g: 0.12 }));
        break;
      case "miniTurbo1":
      case "miniTurbo2":
      case "miniTurbo3": {
        const n = sound === "miniTurbo1" ? 1 : sound === "miniTurbo2" ? 2 : 3;
        const lo = 150 + n * 40;
        const hi = lo * (2.6 + n * 0.4);
        const dur = 0.42 + n * 0.06;
        this.tone(v, { f: 75, to: 40, dur: 0.3, g: 0.4 + n * 0.05, a: 0.003 });
        this.tone(v, { f: lo, to: hi, type: "sawtooth", dur, g: 0.15, lp: [500 + n * 300, 2500 + n * 2500], q: 5 });
        this.tone(v, { f: lo / 2, to: hi / 2, type: "square", dur, g: 0.07, lp: [400, 1500 + n * 800] });
        this.hiss(v, { from: 600, to: 3000 + n * 2000, dur: dur + 0.1, g: 0.18 + n * 0.05, q: 1 });
        if (n >= 2) this.tone(v, { f: hi, to: hi * 1.5, type: "triangle", at: 0.12, dur: 0.3, g: 0.05 });
        const sparkle = n === 1 ? [] : n === 2 ? [1318.51, 1760] : [1567.98, 2093, 2637.02];
        sparkle.forEach((f, i) => this.bell(v, f, 0.08 + i * 0.05, 0.35, 0.08));
        break;
      }
      case "driftStart":
        this.tone(v, { f: 260, to: 540, dur: 0.1, g: 0.2 });
        this.hiss(v, { from: 2600, to: 3800, at: 0.02, dur: 0.14, g: 0.12, q: 3 });
        this.tone(v, { f: 900, type: "triangle", at: 0.02, dur: 0.05, g: 0.05 });
        break;
      case "itemBox": {
        this.tone(v, { f: 190, to: 95, dur: 0.12, g: 0.25, a: 0.002 });
        this.hiss(v, { from: 3000, to: 8000, dur: 0.25, g: 0.3, type: "highpass", a: 0.002 });
        for (let i = 0; i < 10; i++) {
          const f = 2200 + Math.random() * 3300;
          this.tone(v, { f, to: f * 0.8, type: "triangle", at: Math.random() * 0.2, dur: 0.06, g: 0.06 });
        }
        [1046.5, 1318.51, 1567.98].forEach((f, i) => this.bell(v, f, 0.04 + i * 0.035, 0.3, 0.08));
        break;
      }
      case "roulette":
        for (let i = 0; i < 20; i++) {
          const f = 620 * Math.pow(2, (i / 20) * 1.2);
          const at = i * 0.055;
          const accent = i % 4 === 0 ? 1.4 : 1;
          this.tone(v, { f, type: "square", at, dur: 0.035, g: 0.11 * accent, lp: [4500, 2000], a: 0.001 });
          this.tone(v, { f: f * 1.5, type: "triangle", at: at + 0.012, dur: 0.025, g: 0.045 });
        }
        break;
      case "rouletteStop":
        this.tone(v, { f: 220, to: 110, dur: 0.1, g: 0.22, a: 0.002 });
        this.tone(v, { f: 1318.51, type: "square", dur: 0.08, g: 0.09, lp: [5000, 2500] });
        this.bell(v, 1760, 0.06, 0.55, 0.2);
        this.bell(v, 2637.02, 0.06, 0.4, 0.06);
        break;
      case "fire":
        this.tone(v, { f: 120, to: 55, dur: 0.1, g: 0.28, a: 0.002 });
        this.tone(v, { f: 1600, to: 260, type: "square", dur: 0.16, g: 0.12, lp: [6000, 1500] });
        this.tone(v, { f: 800, to: 200, type: "sawtooth", dur: 0.12, g: 0.06 });
        this.hiss(v, { from: 3000, to: 800, dur: 0.12, g: 0.16, a: 0.001 });
        break;
      case "missile":
        this.tone(v, { f: 1760, type: "square", dur: 0.04, g: 0.06 });
        this.tone(v, { f: 1760, type: "square", at: 0.08, dur: 0.04, g: 0.06 });
        this.tone(v, { f: 70, to: 38, at: 0.1, dur: 0.4, g: 0.45, a: 0.003 });
        this.hiss(v, { from: 250, to: 3200, at: 0.1, dur: 0.9, g: 0.4, q: 0.7, a: 0.02 });
        this.tone(v, { f: 110, to: 520, type: "sawtooth", at: 0.1, dur: 0.7, g: 0.11, lp: [400, 2600], q: 3 });
        this.hiss(v, { from: 5000, to: 6000, at: 0.1, dur: 0.9, g: 0.08, type: "highpass", a: 0.1 });
        break;
      case "mineDrop":
        this.tone(v, { f: 240, to: 110, type: "triangle", dur: 0.14, g: 0.35, a: 0.002 });
        this.hiss(v, { from: 1500, to: 300, dur: 0.08, g: 0.2, type: "lowpass", a: 0.001 });
        this.tone(v, { f: 1480, type: "square", at: 0.18, dur: 0.05, g: 0.07, lp: [4000, 2000] });
        this.tone(v, { f: 1480, type: "square", at: 0.32, dur: 0.05, g: 0.07, lp: [4000, 2000] });
        break;
      case "shieldUp":
        this.tone(v, { f: 300, to: 1200, dur: 0.35, g: 0.14 });
        [659.25, 880, 1108.73, 1318.51, 1760].forEach((f, i) => this.bell(v, f, i * 0.04, 0.35, 0.06));
        this.tone(v, { f: 600, type: "triangle", dur: 0.6, g: 0.05, vib: [7, 25], a: 0.05 });
        this.hiss(v, { from: 4000, to: 8000, dur: 0.5, g: 0.06, type: "highpass", a: 0.1 });
        break;
      case "shieldPop":
        this.tone(v, { f: 1400, to: 180, dur: 0.12, g: 0.3, a: 0.002 });
        this.hiss(v, { from: 2500, to: 6000, dur: 0.15, g: 0.25, type: "highpass", a: 0.001 });
        [2637.02, 2093, 1567.98, 1318.51].forEach((f, i) => this.tone(v, { f, type: "triangle", at: 0.05 + i * 0.04, dur: 0.12, g: 0.07 }));
        break;
      case "explosion":
        this.tone(v, { f: 110, to: 28, dur: 0.9, g: 0.8, a: 0.003 });
        this.hiss(v, { from: 6000, to: 150, dur: 1.1, g: 0.85, type: "lowpass", q: 0.7, a: 0.003 });
        this.tone(v, { f: 70, to: 30, type: "square", dur: 0.3, g: 0.14, lp: [400, 100] });
        this.hiss(v, { from: 1200, to: 400, dur: 0.3, g: 0.35, a: 0.002 });
        for (let i = 0; i < 10; i++) {
          this.hiss(v, { from: 800 + Math.random() * 2400, to: 500, at: 0.05 + Math.random() * 0.5, dur: 0.04, g: 0.1 + Math.random() * 0.1, q: 2, a: 0.001 });
        }
        break;
      case "spinout":
        for (let i = 0; i < 6; i++) {
          const m = Math.pow(0.88, i);
          this.tone(v, { f: 1000 * m, to: 560 * m, type: "triangle", at: i * 0.09, dur: 0.09, g: 0.14 });
        }
        this.hiss(v, { from: 2800, to: 1800, dur: 0.6, g: 0.15, q: 3, a: 0.01 });
        this.tone(v, { f: 200, to: 80, at: 0.1, dur: 0.6, g: 0.1 });
        break;
      case "empZap": {
        const { ctx } = v;
        const t0 = v.t;
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        for (let i = 0; i < 22; i++) o.frequency.setValueAtTime((150 + Math.random() * 1650) * v.p, t0 + i * 0.02);
        const f = ctx.createBiquadFilter();
        f.type = "highpass";
        f.frequency.value = 300;
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.0001, t0);
        env.gain.exponentialRampToValueAtTime(0.1, t0 + 0.005);
        env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45);
        o.connect(f).connect(env).connect(v.out);
        o.start(t0);
        o.stop(t0 + 0.5);
        this.hiss(v, { from: 3500, to: 2500, dur: 0.4, g: 0.25, q: 2, a: 0.002 });
        this.tone(v, { f: 60, type: "square", dur: 0.45, g: 0.12, lp: [900, 200] });
        this.tone(v, { f: 2000, to: 300, dur: 0.2, g: 0.1 });
        break;
      }
      case "singularity":
        this.tone(v, { f: 180, to: 28, dur: 1.6, g: 0.5, a: 0.05 });
        this.tone(v, { f: 90, to: 45, type: "sawtooth", dur: 1.5, g: 0.1, det: -12, lp: [2200, 90], q: 6, a: 0.1 });
        this.tone(v, { f: 90, to: 45, type: "sawtooth", dur: 1.5, g: 0.1, det: 12, lp: [2200, 90], q: 6, a: 0.1 });
        this.hiss(v, { from: 3000, to: 100, dur: 1.4, g: 0.35, type: "lowpass", a: 0.35 });
        for (let i = 0; i < 4; i++) this.tone(v, { f: 400 + i * 150, to: 2000 + i * 400, at: i * 0.1, dur: 0.8, g: 0.03, a: 0.3 });
        break;
      case "warp":
        this.tone(v, { f: 180, to: 2600, dur: 0.55, g: 0.2, a: 0.02 });
        this.tone(v, { f: 360, to: 5200, type: "triangle", dur: 0.5, g: 0.06 });
        this.hiss(v, { from: 400, to: 6000, dur: 0.6, g: 0.25, q: 2, a: 0.05 });
        this.bell(v, 1567.98, 0.45, 0.4, 0.07);
        this.bell(v, 2093, 0.5, 0.4, 0.06);
        this.tone(v, { f: 80, to: 40, at: 0.5, dur: 0.3, g: 0.35, a: 0.003 });
        break;
      case "cloak":
        for (let i = 0; i < 5; i++) {
          this.tone(v, { f: 2800 + Math.random() * 800, to: 700 + Math.random() * 200, at: i * 0.03, dur: 0.6, g: 0.045, det: (Math.random() - 0.5) * 30 });
        }
        this.hiss(v, { from: 6000, to: 2000, dur: 0.6, g: 0.1, type: "highpass", a: 0.05 });
        this.tone(v, { f: 440, to: 220, type: "triangle", dur: 0.5, g: 0.06, vib: [9, 40] });
        break;
      case "wallHit":
        this.tone(v, { f: 130, to: 55, dur: 0.18, g: 0.55, a: 0.002 });
        this.tone(v, { f: 320, to: 140, type: "square", dur: 0.08, g: 0.12, lp: [2000, 500] });
        this.hiss(v, { from: 1500, to: 600, dur: 0.1, g: 0.35, q: 1.2, a: 0.001 });
        this.tone(v, { f: 1240, type: "triangle", dur: 0.12, g: 0.04 });
        this.tone(v, { f: 1730, type: "triangle", dur: 0.1, g: 0.03 });
        break;
      case "bump":
        this.tone(v, { f: 240, to: 150, type: "triangle", dur: 0.1, g: 0.3, a: 0.002 });
        this.hiss(v, { from: 900, to: 500, dur: 0.07, g: 0.18, a: 0.001 });
        this.tone(v, { f: 100, to: 60, dur: 0.1, g: 0.3, a: 0.002 });
        break;
      case "land":
        this.tone(v, { f: 110, to: 48, dur: 0.2, g: 0.5, a: 0.003 });
        this.hiss(v, { from: 1200, to: 200, dur: 0.15, g: 0.25, type: "lowpass", a: 0.002 });
        break;
      case "trick":
        this.hiss(v, { from: 1000, to: 5000, dur: 0.2, g: 0.15, q: 1 });
        [1046.5, 1318.51, 1567.98, 2093].forEach((f, i) => this.tone(v, { f, type: "triangle", at: i * 0.035, dur: 0.14, g: 0.1 }));
        this.tone(v, { f: 2093, at: 0.14, dur: 0.35, g: 0.08, vib: [8, 20] });
        break;
      case "coin":
        this.tone(v, { f: 987.77, type: "square", dur: 0.08, g: 0.15, lp: [6000, 3000], a: 0.001 });
        this.tone(v, { f: 987.77, dur: 0.08, g: 0.14, a: 0.001 });
        this.tone(v, { f: 1318.51, type: "square", at: 0.075, dur: 0.45, g: 0.15, lp: [7000, 2500], a: 0.001 });
        this.tone(v, { f: 1318.51, at: 0.075, dur: 0.3, g: 0.1, a: 0.001 });
        this.tone(v, { f: 2637.02, at: 0.075, dur: 0.28, g: 0.07, a: 0.001 });
        break;
      case "jump":
        this.tone(v, { f: 280, to: 720, dur: 0.14, g: 0.24 });
        this.tone(v, { f: 560, to: 1440, type: "triangle", dur: 0.1, g: 0.06 });
        this.hiss(v, { from: 2000, to: 4000, dur: 0.1, g: 0.08, type: "highpass" });
        break;
      case "fall":
        this.tone(v, { f: 1400, to: 180, dur: 1.1, g: 0.16, a: 0.02 });
        this.tone(v, { f: 1400, to: 180, type: "triangle", dur: 1.1, g: 0.05, det: 20, vib: [6, 30] });
        this.hiss(v, { from: 800, to: 200, dur: 1.2, g: 0.15, a: 0.3 });
        break;
      case "respawn":
        [523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((f, i) => this.bell(v, f, i * 0.06, 0.32, 0.1));
        this.tone(v, { f: 200, to: 800, dur: 0.4, g: 0.1, a: 0.02 });
        this.hiss(v, { from: 3000, to: 7000, dur: 0.5, g: 0.06, type: "highpass", a: 0.1 });
        break;
      case "lap":
        this.tone(v, { f: 783.99, type: "square", dur: 0.1, g: 0.09, lp: [5000, 2500] });
        this.tone(v, { f: 1046.5, type: "square", at: 0.09, dur: 0.35, g: 0.09, lp: [5000, 2000] });
        this.tone(v, { f: 659.25, type: "triangle", at: 0.09, dur: 0.35, g: 0.08 });
        this.bell(v, 1567.98, 0.09, 0.55, 0.1);
        break;
      case "finalLap": {
        const stab = [392, 493.88, 587.33];
        for (let i = 0; i < 3; i++) for (const f of stab) this.brass(v, f, i * 0.13, 0.08, 0.07);
        for (const f of [523.25, 659.25, 783.99]) this.brass(v, f, 0.39, 0.9, 0.08, 14);
        this.brass(v, 261.63, 0.39, 0.9, 0.08);
        for (let i = 0; i < 3; i++) this.hiss(v, { from: 2000, to: 1200, at: i * 0.13, dur: 0.1, g: 0.12, a: 0.001 });
        this.tone(v, { f: 130, to: 55, at: 0.39, dur: 0.3, g: 0.35, a: 0.003 });
        this.cymbal(v, 0.39, 1.2, 0.1);
        break;
      }
      case "finish": {
        const mel: [number, number, number][] = [
          [523.25, 0, 0.1],
          [659.25, 0.12, 0.1],
          [783.99, 0.24, 0.1],
        ];
        for (const [f, at, d] of mel) this.brass(v, f, at, d, 0.1);
        for (const f of [659.25, 783.99, 1046.5]) this.brass(v, f, 0.36, 1.0, 0.08, 16);
        this.brass(v, 261.63, 0.36, 1.0, 0.08);
        for (let i = 0; i < 8; i++) this.tone(v, { f: 98, to: 80, at: i * 0.045, dur: 0.08, g: 0.12 + i * 0.03, a: 0.002 });
        this.tone(v, { f: 98, to: 45, at: 0.36, dur: 0.5, g: 0.45, a: 0.003 });
        this.cymbal(v, 0.36, 1.6, 0.12);
        [2093, 2637.02, 3135.96].forEach((f, i) => this.bell(v, f, 0.5 + i * 0.07, 0.5, 0.04));
        break;
      }
      case "win": {
        const seq: [number, number, number][] = [
          [523.25, 0, 0.09],
          [659.25, 0.1, 0.09],
          [783.99, 0.2, 0.09],
          [1046.5, 0.3, 0.22],
          [783.99, 0.6, 0.09],
          [1046.5, 0.72, 0.09],
        ];
        for (const [f, at, d] of seq) {
          this.tone(v, { f, type: "square", at, dur: d + 0.06, g: 0.08, lp: [5000, 2500] });
          this.tone(v, { f: f * 2, type: "triangle", at, dur: d, g: 0.04 });
        }
        this.tone(v, { f: 1318.51, type: "square", at: 0.84, dur: 1.0, g: 0.08, lp: [5000, 1500], vib: [6, 15] });
        for (const f of [523.25, 659.25, 783.99]) this.brass(v, f, 0.84, 0.9, 0.06, 12);
        [130.81, 196, 130.81, 261.63].forEach((f, i) => this.tone(v, { f, type: "triangle", at: [0, 0.3, 0.6, 0.84][i], dur: 0.25, g: 0.18 }));
        this.cymbal(v, 0.84, 1.4, 0.1);
        [2093, 2637.02, 3135.96, 4186].forEach((f, i) => this.bell(v, f, 0.95 + i * 0.06, 0.5, 0.04));
        break;
      }
      case "lose": {
        const notes: [number, number, number][] = [
          [392, 0, 0.28],
          [369.99, 0.36, 0.28],
          [349.23, 0.72, 0.28],
          [329.63, 1.08, 0.9],
        ];
        notes.forEach(([f, at, d], i) => {
          this.tone(v, { f, type: "sawtooth", at, dur: d, g: 0.12, lp: [300, 1300], q: 4, a: 0.03, vib: i === 3 ? [5, 30] : undefined });
          this.tone(v, { f: f / 2, type: "triangle", at, dur: d, g: 0.1, a: 0.03 });
        });
        break;
      }
      case "positionUp":
        this.tone(v, { f: 880, type: "triangle", dur: 0.07, g: 0.12 });
        this.tone(v, { f: 1318.51, type: "triangle", at: 0.06, dur: 0.16, g: 0.12 });
        this.tone(v, { f: 2637.02, at: 0.06, dur: 0.1, g: 0.03 });
        break;
      case "positionDown":
        this.tone(v, { f: 660, type: "triangle", dur: 0.08, g: 0.09 });
        this.tone(v, { f: 440, type: "triangle", at: 0.07, dur: 0.18, g: 0.09 });
        break;
      case "select":
        this.tone(v, { f: 880, type: "square", dur: 0.06, g: 0.07, lp: [5000, 2500] });
        this.tone(v, { f: 1318.51, type: "square", at: 0.06, dur: 0.14, g: 0.07, lp: [5000, 2500] });
        this.tone(v, { f: 1760, at: 0.06, dur: 0.1, g: 0.04 });
        break;
      case "click":
        this.tone(v, { f: 1800, to: 1200, type: "triangle", dur: 0.03, g: 0.12, a: 0.001 });
        this.hiss(v, { from: 4000, to: 5000, dur: 0.015, g: 0.05, type: "highpass", a: 0.001 });
        break;
      case "whoosh":
        this.hiss(v, { from: 350, to: 2800, dur: 0.35, g: 0.35, q: 1.3, a: 0.12 });
        break;
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Music                                                                   */
  /* ---------------------------------------------------------------------- */

  music(themeName: MusicTheme | null): void {
    this.wantTheme = themeName;
    if (!this.ctx) return; // starts on resume()
    if (themeName === null) {
      this.fadeOutSong(0.5);
      this.stopScheduler();
      this.curTheme = null;
      this.song = null;
      return;
    }
    if (themeName === this.curTheme && this.timer !== null) return;
    this.startTheme(themeName);
  }

  setIntensity(finalLap: boolean): void {
    this.finalLap = finalLap;
  }

  setMusicVolume(v: number): void {
    this.musicVol = clamp(Number.isFinite(v) ? v : 0.5, 0, 1);
    if (this.musicBus && this.ctx) this.musicBus.gain.setTargetAtTime(this.musicVol * MUSIC_BUS, this.ctx.currentTime, 0.05);
  }

  private stopScheduler(): void {
    if (this.timer !== null && typeof window !== "undefined") window.clearInterval(this.timer);
    this.timer = null;
  }

  private fadeOutSong(seconds: number): void {
    const ctx = this.ctx;
    const out = this.mOut;
    const nodes = this.mNodes;
    this.mOut = null;
    this.mLead = null;
    this.mFx = null;
    this.mNodes = [];
    if (!ctx || !out) return;
    const t = ctx.currentTime;
    out.gain.cancelScheduledValues(t);
    out.gain.setValueAtTime(out.gain.value, t);
    out.gain.linearRampToValueAtTime(0, t + seconds);
    window.setTimeout(
      () => {
        for (const n of nodes) n.disconnect();
      },
      seconds * 1000 + 800,
    );
  }

  private startTheme(name: MusicTheme): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (!ctx || !bus) return;
    this.fadeOutSong(0.5);
    const th = theme(name);
    this.song = th;
    this.curTheme = name;

    const out = ctx.createGain();
    out.gain.setValueAtTime(0, ctx.currentTime);
    out.gain.linearRampToValueAtTime(1, ctx.currentTime + (name === "menu" ? 0.8 : 0.15));
    out.connect(bus);
    const nodes: AudioNode[] = [out];

    // Lead bus, optionally driven through a soft clipper.
    const lead = ctx.createGain();
    nodes.push(lead);
    if (th.drive > 0) {
      const shaper = ctx.createWaveShaper();
      const n = 1024;
      const curve = new Float32Array(n);
      const norm = Math.tanh(th.drive);
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        curve[i] = Math.tanh(x * th.drive) / norm;
      }
      shaper.curve = curve;
      shaper.oversample = "2x";
      const post = ctx.createGain();
      post.gain.value = 0.55;
      lead.connect(shaper).connect(post).connect(out);
      nodes.push(shaper, post);
    } else {
      lead.connect(out);
    }

    // Tempo-synced dotted-eighth echo.
    let fx: AudioNode | null = null;
    if (th.echo > 0) {
      const send = ctx.createGain();
      const delay = ctx.createDelay(2);
      delay.delayTime.value = (3 * 60) / th.bpm / 4;
      const fb = ctx.createGain();
      fb.gain.value = 0.32;
      const damp = ctx.createBiquadFilter();
      damp.type = "lowpass";
      damp.frequency.value = 3000;
      const wet = ctx.createGain();
      wet.gain.value = th.echo;
      send.connect(delay);
      delay.connect(damp).connect(fb).connect(delay);
      damp.connect(wet).connect(out);
      nodes.push(send, delay, fb, damp, wet);
      fx = send;
    }

    this.mOut = out;
    this.mLead = lead;
    this.mFx = fx;
    this.mNodes = nodes;
    this.step = 0;
    this.arpIdx = 0;
    this.nextTime = ctx.currentTime + 0.08;
    if (this.timer === null) this.timer = window.setInterval(() => this.tick(), 25);
  }

  private tick(): void {
    const ctx = this.ctx;
    const th = this.song;
    if (!ctx || !th) return;
    const now = ctx.currentTime;
    // Tab was throttled or the context was suspended: resync instead of bursting.
    if (this.nextTime < now - 0.2) this.nextTime = now + 0.05;
    const total = th.bars * 16;
    let guard = 0;
    while (this.nextTime < now + 0.12 && guard++ < 32) {
      try {
        this.scheduleStep(th, this.step, this.nextTime);
      } catch {
        // Never let a scheduling hiccup kill the loop.
      }
      this.nextTime += this.sixteenth(th);
      this.step = (this.step + 1) % total;
    }
  }

  private sixteenth(th: Theme): number {
    return 60 / (th.bpm * (this.finalLap ? 1.08 : 1)) / 4;
  }

  private scheduleStep(th: Theme, step: number, time: number): void {
    const ctx = this.ctx;
    const out = this.mOut;
    const lead = this.mLead;
    if (!ctx || !out || !lead || !this.enabled) return;
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const [rawRoot, quality] = th.chords[bar];
    const root = fold(rawRoot);
    const iv = QUALITY[quality];
    const six = this.sixteenth(th);
    const v: Voice = { ctx, out, t: time, p: 1 };
    const dg = th.drumGain;
    const intense = this.finalLap;

    // Drums.
    if (th.kick[s] === "x") this.mKick(v, 0.55 * dg, th.chip);
    const fill = th.fill && bar === th.bars - 1 && s >= 12;
    if (th.snare[s] === "x" || fill) this.mSnare(v, (fill ? 0.14 + (s - 12) * 0.05 : 0.26) * dg, th.chip);
    const h = th.hat[s];
    if (h === "x") this.mHat(v, (s % 4 === 0 ? 0.07 : 0.05) * dg, false);
    else if (h === "o") this.mHat(v, 0.06 * dg, true);
    else if (intense && s % 2 === 1) this.mHat(v, 0.035 * dg, false);
    if (step === 0) this.cymbal(v, 0, 1.2, 0.05 * dg);

    // Bass.
    const b = th.bassSteps[s];
    if (b !== null && b !== undefined) this.mBass(v, th, th.key + root + b, th.bassLen[s] * six * 0.9);

    // Pad.
    if (th.pad) {
      const gate = th.pad.gate;
      if (gate === 0 ? s === 0 : s % gate === 0) {
        const len = gate === 0 ? 16 * six : gate * six * 0.75;
        for (const i of iv) this.mPad(v, th, th.key + 24 + root + i, len);
      }
    }

    // Arpeggio.
    if (th.arp && s % th.arp.rate === 0) {
      const tones = [...iv.slice(0, 3), ...iv.slice(0, 3).map((x) => x + 12)];
      const idx = this.arpIdx++ % (tones.length * 2 - 2);
      const pick = idx < tones.length ? tones[idx] : tones[tones.length * 2 - 2 - idx];
      this.mArp(v, th, th.key + 12 + th.arp.oct * 12 + root + pick);
    }

    // Lead.
    if (s % 2 === 0) {
      const ev = th.mel[bar * 8 + s / 2];
      if (ev) this.mNote(lead, time, th.key + th.leadOct + ev.n, ev.len * 2 * six * th.lead.legato, th.lead);
    }

    // Final-lap counter melody: off-beat bell arpeggio an octave above the lead.
    if (intense && s % 4 === 2) {
      const tones = [iv[0], iv[1], iv[2], 12];
      const f = mtof(th.key + th.leadOct + 12 + root + tones[(s >> 2) % 4]);
      const cv: Voice = { ctx, out, t: time, p: 1 };
      this.tone(cv, { f, type: th.chip ? "square" : "triangle", dur: six * 1.8, g: th.chip ? 0.025 : 0.045, a: 0.003 });
      this.tone(cv, { f: f * 2, dur: six * 1.2, g: 0.015, a: 0.002 });
      if (this.mFx) this.tone({ ctx, out: this.mFx, t: time, p: 1 }, { f, type: "triangle", dur: six * 1.5, g: 0.02 });
    }
  }

  private mKick(v: Voice, g: number, chip: boolean): void {
    const { ctx } = v;
    const t = v.t;
    const o = ctx.createOscillator();
    o.type = chip ? "square" : "sine";
    o.frequency.setValueAtTime(chip ? 220 : 160, t);
    o.frequency.exponentialRampToValueAtTime(chip ? 50 : 52, t + (chip ? 0.05 : 0.07));
    o.frequency.exponentialRampToValueAtTime(40, t + 0.25);
    const env = ctx.createGain();
    const len = chip ? 0.09 : 0.24;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(chip ? g * 0.45 : g, t + 0.003);
    env.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(env).connect(v.out);
    o.start(t);
    o.stop(t + len + 0.02);
    if (!chip) this.tone(v, { f: 1200, to: 200, type: "triangle", dur: 0.012, g: g * 0.25, a: 0.001 });
  }

  private mSnare(v: Voice, g: number, chip: boolean): void {
    if (chip) {
      this.hiss(v, { from: 5000, to: 2500, dur: 0.08, g, type: "highpass", a: 0.001 });
      this.tone(v, { f: 240, to: 120, type: "square", dur: 0.04, g: g * 0.35 });
      return;
    }
    this.hiss(v, { from: 2400, to: 1400, dur: 0.17, g, q: 0.8, a: 0.001 });
    this.hiss(v, { from: 7000, to: 5000, dur: 0.09, g: g * 0.5, type: "highpass", a: 0.001 });
    this.tone(v, { f: 200, to: 140, type: "triangle", dur: 0.08, g: g * 0.7, a: 0.001 });
  }

  private mHat(v: Voice, g: number, open: boolean): void {
    this.hiss(v, { from: 8000, to: 9000, dur: open ? 0.16 : 0.035, g, type: "highpass", q: 0.7, a: 0.001 });
  }

  private mBass(v: Voice, th: Theme, midi: number, dur: number): void {
    const { ctx } = v;
    const t = v.t;
    const bv = th.bassVoice;
    const f = mtof(midi);
    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.Q.value = bv.q;
    filt.frequency.setValueAtTime(bv.cutoff * 3, t);
    filt.frequency.exponentialRampToValueAtTime(bv.cutoff, t + Math.min(0.12, dur));
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(bv.gain, t + 0.005);
    env.gain.linearRampToValueAtTime(bv.gain * 0.7, t + dur);
    env.gain.linearRampToValueAtTime(0, t + dur + 0.04);
    filt.connect(env).connect(v.out);
    const o = this.osc(ctx, bv.wave);
    o.frequency.value = f;
    o.connect(filt);
    o.start(t);
    o.stop(t + dur + 0.06);
    if (bv.sub > 0) {
      const sub = ctx.createOscillator();
      sub.frequency.value = f / 2;
      const sg = ctx.createGain();
      sg.gain.value = bv.sub;
      sub.connect(sg).connect(env);
      sub.start(t);
      sub.stop(t + dur + 0.06);
    }
  }

  private mPad(v: Voice, th: Theme, midi: number, dur: number): void {
    const pad = th.pad;
    if (!pad) return;
    const { ctx } = v;
    const t = v.t;
    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = pad.cutoff;
    const env = ctx.createGain();
    const atk = Math.min(pad.attack, dur * 0.5);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(pad.gain, t + atk + 0.003);
    env.gain.setValueAtTime(pad.gain, t + dur);
    env.gain.linearRampToValueAtTime(0, t + dur + Math.min(0.25, atk + 0.04));
    filt.connect(env).connect(v.out);
    const f = mtof(midi);
    const dets = pad.wave === "sawtooth" ? [-7, 7] : [0];
    for (const d of dets) {
      const o = this.osc(ctx, pad.wave);
      o.frequency.value = f;
      o.detune.value = d;
      o.connect(filt);
      o.start(t);
      o.stop(t + dur + 0.3);
    }
  }

  private mArp(v: Voice, th: Theme, midi: number): void {
    const arp = th.arp;
    if (!arp) return;
    const target = this.mFx;
    this.tone(v, { f: mtof(midi), type: arp.wave, dur: arp.decay, g: arp.gain, lp: [arp.cutoff, arp.cutoff * 0.4], a: 0.002 });
    if (target) this.tone({ ...v, out: target }, { f: mtof(midi), type: arp.wave, dur: arp.decay, g: arp.gain * 0.6, lp: [arp.cutoff, arp.cutoff * 0.4], a: 0.002 });
  }

  private mNote(dest: AudioNode, t: number, midi: number, dur: number, lv: VoiceDef): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const f = mtof(midi);
    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.Q.value = lv.q;
    filt.frequency.setValueAtTime(Math.min(18000, lv.cutoff * lv.pluck), t);
    filt.frequency.setTargetAtTime(lv.cutoff, t, 0.06);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(lv.gain, t + 0.008);
    env.gain.linearRampToValueAtTime(lv.gain * 0.65, t + Math.max(0.02, dur));
    env.gain.linearRampToValueAtTime(0, t + dur + 0.07);
    filt.connect(env).connect(dest);
    if (this.mFx) env.connect(this.mFx);
    const end = t + dur + 0.1;
    const dets = lv.detune > 0 ? [-lv.detune, lv.detune] : [0];
    const oscs: OscillatorNode[] = [];
    for (const d of dets) {
      const o = this.osc(ctx, lv.wave);
      o.frequency.value = f;
      o.detune.value = d;
      const g = ctx.createGain();
      g.gain.value = 1 / dets.length;
      o.connect(g).connect(filt);
      o.start(t);
      o.stop(end);
      oscs.push(o);
    }
    if (lv.vibrato > 0 && dur > 0.2) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5.8;
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(0, t);
      depth.gain.linearRampToValueAtTime(lv.vibrato, t + Math.min(dur, 0.35));
      lfo.connect(depth);
      for (const o of oscs) depth.connect(o.detune);
      lfo.start(t);
      lfo.stop(end);
    }
  }
}

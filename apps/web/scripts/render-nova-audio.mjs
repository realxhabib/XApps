// Builds Nova Rally's recorded audio from CC0 sample packs and music
// (see public/audio/nova-rally/CREDITS.md for every source and its license).
//
//   node scripts/render-nova-audio.mjs              (from apps/web)
//   node scripts/render-nova-audio.mjs --sfx-only   (keep the encoded music)
//
// Sources are downloaded once into node_modules/.cache/nova-rally-audio (or
// $NOVA_AUDIO_CACHE). Everything is decoded and processed in headless
// Chromium (Playwright): each effect is a recipe of layered samples (offset,
// pitch via playback rate, fades, filters, reverse) mixed in an
// OfflineAudioContext, trimmed, given a touch of reverb, and normalized to the
// loudness of the synth effect it replaces (RaceAudio.renderSound), so the mix
// keeps its balance. MP3 is encoded in Node (lamejs). Output in
// public/audio/nova-rally/:
//   sfx.mp3            one sprite: effects, announcer lines, engine loops
//   music-<theme>.mp3  one seamless loop per world (whole track)
//   music-<theme>-final.mp3  the final-lap ("climax") version
//   manifest.json      sprite offsets, engine loop regions and music loop
//                      points (seconds), corrected for the MP3 encoder delay
import { Mp3Encoder } from "@breezystack/lamejs";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, "..");
const outDir = resolve(web, "public/audio/nova-rally");
const cache = process.env.NOVA_AUDIO_CACHE ?? resolve(web, "../../node_modules/.cache/nova-rally-audio");
const sfxOnly = process.argv.includes("--sfx-only");
const RATE = 44100;
const SFX_KBPS = 112;
const MUSIC_KBPS = 96;
const GAP = 0.2;

/* ------------------------------------------------------------------------ */
/* Sources                                                                   */
/* ------------------------------------------------------------------------ */

const KENNEY = {
  "sci-fi-sounds": "https://kenney.nl/media/pages/assets/sci-fi-sounds/6b296f9ecf-1677589334/kenney_sci-fi-sounds.zip",
  "impact-sounds": "https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip",
  "interface-sounds": "https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip",
  "digital-audio": "https://kenney.nl/media/pages/assets/digital-audio/216eac4753-1677590265/kenney_digital-audio.zip",
  "voiceover-pack": "https://kenney.nl/media/pages/assets/voiceover-pack/3f7f168698-1677589897/kenney_voiceover-pack.zip",
  "music-jingles": "https://kenney.nl/media/pages/assets/music-jingles/f37e530b9e-1677590399/kenney_music-jingles.zip",
};
const OGA = "https://opengameart.org/sites/default/files/";
/** MintoDog's "For Racing Game" music (OpenGameArt, CC0): a normal and a faster "climax" take per track. */
const MUSIC = {
  mars: ["hot_roadway_remake_bpm160_0.ogg", "hot_roadway_climax_remake_bpm175_0.ogg"],
  belt: ["darkness_road_bpm165_0.ogg", "darkness_road_climax_bpm180_0.ogg"],
  saturn: ["pure_raceway_bpm160_0.ogg", "pure_raceway_climax_bpm175_0.ogg"],
  nebula: ["cool_highway_bpm140_0.ogg", "cool_highway_climax_bpm155_0.ogg"],
  luna: ["sky_blue_street_bpm165_0.ogg", "sky_blue_street_climax_bpm180_0.ogg"],
  sun: ["fever_stadium_bpm165_0.ogg", "fever_stadium_climax_bpm180_0.ogg"],
  europa: ["blossom_mountain_bpm140_0.ogg", "blossom_mountain_climax_bpm155.ogg"],
  menu: ["racing_game_menu_bpm165_0.ogg", null],
};
/** Target RMS of the music loops (what the synth soundtrack measured), menu a bit softer. */
const MUSIC_RMS = { menu: 0.15, default: 0.17 };
const FINISH_ZIP = "ogg_racing_game_finish_jingle.zip";

async function download(url, file) {
  console.log(`downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

async function fetchSources() {
  mkdirSync(resolve(cache, "music"), { recursive: true });
  for (const [pack, url] of Object.entries(KENNEY)) {
    const dir = resolve(cache, `kenney_${pack}`);
    if (existsSync(dir)) continue;
    const zip = `${dir}.zip`;
    if (!existsSync(zip)) await download(url, zip);
    execFileSync("unzip", ["-q", "-o", zip, "-d", dir]);
  }
  const files = Object.values(MUSIC).flat().filter(Boolean);
  if (!sfxOnly) for (const f of files) if (!existsSync(resolve(cache, "music", f))) await download(OGA + f, resolve(cache, "music", f));
  const finish = resolve(cache, "mintodog-finish");
  if (!existsSync(finish)) {
    const zip = resolve(cache, "music", FINISH_ZIP);
    if (!existsSync(zip)) await download(OGA + FINISH_ZIP, zip);
    execFileSync("unzip", ["-q", "-o", zip, "-d", finish]);
  }
}

/* ------------------------------------------------------------------------ */
/* Recipes                                                                   */
/* ------------------------------------------------------------------------ */

const SF = "kenney_sci-fi-sounds/Audio/";
const IM = "kenney_impact-sounds/Audio/";
const UI = "kenney_interface-sounds/Audio/";
const DG = "kenney_digital-audio/Audio/";
const VO = "kenney_voiceover-pack/Female/";
const JG = "kenney_music-jingles/Audio/";
const MD = "mintodog-finish/ogg_Racing Game Finish & Jingle/";

/**
 * A layer: [file, { at, rate, gain, off, dur, fadeIn, fadeOut, reverse, lp, hp, pan }].
 * `at` is when it starts in the mix, `off`/`dur` the slice of the source (seconds,
 * after its leading silence is trimmed), `rate` the playback rate (pitch).
 * Each sound: { layers, db } where db trims the loudness relative to the synth it replaces.
 */
const L = (file, o = {}) => [file, o];
const turbo = (n) => ({
  layers: [
    L(SF + "thrusterFire_001.ogg", { off: 0.4, dur: 0.45 + n * 0.08, fadeIn: 0.01, fadeOut: 0.3, rate: 0.9 + n * 0.08 }),
    L(DG + "powerUp4.ogg", { rate: [1, 1.12, 1.26][n - 1], gain: 0.7 }),
    ...(n >= 2 ? [L(UI + "glass_002.ogg", { at: 0.1, rate: 1.12, gain: 0.35 })] : []),
    ...(n >= 3 ? [L(UI + "glass_001.ogg", { at: 0.16, rate: 1.5, gain: 0.3 }), L(SF + "lowFrequency_explosion_001.ogg", { dur: 0.45, fadeOut: 0.3, gain: 0.45 })] : []),
  ],
});
const roulette = () => {
  const layers = [];
  for (let i = 0; i < 20; i++) {
    const r = Math.pow(2, (i / 20) * 1.2);
    layers.push(L(UI + "tick_002.ogg", { at: i * 0.055, rate: r, gain: i % 4 === 0 ? 0.9 : 0.6 }));
    layers.push(L(UI + "pluck_002.ogg", { at: i * 0.055, rate: r, gain: i % 4 === 0 ? 0.55 : 0.35, dur: 0.06, fadeOut: 0.03 }));
  }
  return { layers };
};

const SFX = {
  countdown: { layers: [L(UI + "glass_001.ogg", { rate: 0.5 }), L(UI + "glass_002.ogg", { rate: 0.5, gain: 0.5 }), L(UI + "bong_001.ogg", { gain: 0.5 })] },
  go: {
    layers: [
      L(UI + "glass_001.ogg"),
      L(UI + "glass_001.ogg", { rate: 0.5, gain: 0.7 }),
      L(UI + "glass_002.ogg", { at: 0.03, rate: 1.5, gain: 0.35 }),
      L(SF + "thrusterFire_000.ogg", { off: 0.3, dur: 0.6, fadeIn: 0.02, fadeOut: 0.4, gain: 0.6 }),
    ],
  },
  rocketStart: {
    layers: [
      L(SF + "thrusterFire_003.ogg", { off: 0.5, dur: 1.0, fadeIn: 0.02, fadeOut: 0.6 }),
      L(SF + "lowFrequency_explosion_001.ogg", { dur: 0.6, fadeOut: 0.3, gain: 0.6 }),
      L(DG + "phaserUp3.ogg", { rate: 0.8, gain: 0.5 }),
      L(UI + "glass_001.ogg", { at: 0.05, rate: 1.33, gain: 0.3 }),
    ],
  },
  stall: { layers: [L(DG + "lowDown.ogg"), L(SF + "impactMetal_001.ogg", { gain: 0.6 }), L(DG + "phaserDown3.ogg", { at: 0.3, rate: 0.6, gain: 0.45 })] },
  boost: {
    layers: [
      L(SF + "thrusterFire_003.ogg", { off: 1.2, dur: 0.8, fadeIn: 0.01, fadeOut: 0.5 }),
      L(SF + "lowFrequency_explosion_001.ogg", { dur: 0.5, fadeOut: 0.3, gain: 0.45 }),
      L(DG + "phaserUp3.ogg", { rate: 0.8, gain: 0.4 }),
    ],
  },
  boostPad: {
    layers: [L(SF + "thrusterFire_000.ogg", { off: 2, dur: 0.55, fadeIn: 0.01, fadeOut: 0.35 }), L(DG + "phaserUp7.ogg", { gain: 0.6 }), L(UI + "glass_002.ogg", { at: 0.06, rate: 1.33, gain: 0.25 })],
  },
  miniTurbo1: turbo(1),
  miniTurbo2: turbo(2),
  miniTurbo3: turbo(3),
  driftStart: { layers: [L(DG + "phaseJump3.ogg", { rate: 1.3, dur: 0.25, fadeOut: 0.1 }), L(UI + "scratch_001.ogg", { gain: 0.35 })] },
  itemBox: { layers: [L(IM + "impactGlass_light_000.ogg"), L(IM + "impactGlass_medium_001.ogg", { gain: 0.7 }), L(DG + "powerUp2.ogg", { at: 0.03, gain: 0.6 })] },
  roulette: roulette(),
  rouletteStop: { layers: [L(UI + "confirmation_002.ogg"), L(UI + "glass_001.ogg", { at: 0.05, rate: 0.75, gain: 0.5 })] },
  fire: { layers: [L(SF + "laserRetro_000.ogg"), L(SF + "laserLarge_000.ogg", { gain: 0.6 })] },
  missile: {
    layers: [
      L(UI + "glass_002.ogg", { rate: 0.9, gain: 0.35 }),
      L(UI + "glass_002.ogg", { at: 0.08, rate: 0.9, gain: 0.35 }),
      L(SF + "thrusterFire_002.ogg", { at: 0.1, off: 0.3, dur: 0.9, fadeIn: 0.03, fadeOut: 0.6 }),
      L(SF + "laserLarge_001.ogg", { at: 0.1, rate: 0.7, gain: 0.6 }),
      L(SF + "lowFrequency_explosion_001.ogg", { at: 0.1, dur: 0.5, fadeOut: 0.3, gain: 0.4 }),
    ],
  },
  mineDrop: { layers: [L(SF + "impactMetal_002.ogg"), L(UI + "tick_004.ogg", { at: 0.18, gain: 0.5 }), L(UI + "tick_004.ogg", { at: 0.32, gain: 0.5 })] },
  shieldUp: { layers: [L(SF + "forceField_000.ogg"), L(UI + "maximize_001.ogg", { gain: 0.4 })] },
  shieldPop: { layers: [L(IM + "impactGlass_heavy_000.ogg"), L(IM + "impactGlass_light_001.ogg", { at: 0.03, gain: 0.7 }), L(SF + "forceField_001.ogg", { rate: 1.6, dur: 0.3, fadeOut: 0.2, gain: 0.4 })] },
  explosion: { layers: [L(SF + "explosionCrunch_001.ogg"), L(SF + "lowFrequency_explosion_001.ogg", { gain: 0.9 })], db: 1 },
  spinout: { layers: [L(DG + "phaserDown1.ogg"), L(DG + "phaserDown1.ogg", { at: 0.22, rate: 0.8, gain: 0.6 }), L(UI + "scratch_002.ogg", { gain: 0.4 })] },
  empZap: { layers: [L(DG + "zap2.ogg"), L(SF + "computerNoise_000.ogg", { dur: 0.5, fadeOut: 0.35, gain: 0.45 }), L(SF + "laserRetro_002.ogg", { gain: 0.4 })] },
  singularity: {
    layers: [L(SF + "lowFrequency_explosion_000.ogg"), L(SF + "forceField_000.ogg", { rate: 0.5, gain: 0.8 }), L(DG + "phaserDown3.ogg", { rate: 0.5, gain: 0.4 })],
  },
  warp: {
    layers: [
      L(DG + "phaserUp1.ogg", { rate: 0.7 }),
      L(DG + "powerUp3.ogg", { gain: 0.5 }),
      L(SF + "thrusterFire_004.ogg", { dur: 0.7, fadeIn: 0.2, fadeOut: 0.3, gain: 0.5 }),
      L(SF + "lowFrequency_explosion_001.ogg", { at: 0.45, dur: 0.6, fadeOut: 0.3, gain: 0.5 }),
    ],
  },
  cloak: { layers: [L(SF + "forceField_002.ogg", { reverse: true, rate: 1.3, fadeIn: 0.05 }), L(DG + "phaserDown3.ogg", { at: 0.35, rate: 1.6, gain: 0.4 })] },
  wallHit: { layers: [L(IM + "impactMetal_heavy_000.ogg"), L(IM + "impactPlate_heavy_000.ogg", { gain: 0.8 }), L(IM + "impactPunch_heavy_000.ogg", { gain: 0.6 })] },
  bump: { layers: [L(IM + "impactPlate_medium_000.ogg"), L(IM + "impactSoft_heavy_000.ogg", { gain: 0.6 })] },
  land: { layers: [L(IM + "impactSoft_heavy_001.ogg"), L(SF + "impactMetal_001.ogg", { gain: 0.5 })] },
  trick: { layers: [L(DG + "pepSound3.ogg"), L(UI + "glass_002.ogg", { at: 0.15, rate: 1.33, gain: 0.35 }), L(SF + "doorOpen_001.ogg", { gain: 0.2 })] },
  coin: { layers: [L(UI + "glass_002.ogg"), L(UI + "glass_001.ogg", { at: 0.075, rate: 1.335 })] },
  jump: { layers: [L(DG + "phaseJump4.ogg")] },
  fall: { layers: [L(DG + "phaserDown3.ogg", { rate: 0.55 }), L(SF + "doorOpen_001.ogg", { rate: 0.6, gain: 0.3 })] },
  respawn: { layers: [L(DG + "powerUp3.ogg"), L(UI + "maximize_001.ogg", { at: 0.1, gain: 0.5 })] },
  lap: { layers: [L(UI + "confirmation_004.ogg"), L(UI + "glass_001.ogg", { at: 0.1, rate: 0.75, gain: 0.5 })] },
  finalLap: { layers: [L(MD + "Final Lap (Jingle).ogg")], db: -1 },
  finish: { layers: [L(JG + "Hit jingles/jingles_HIT03.ogg"), L(SF + "lowFrequency_explosion_001.ogg", { dur: 0.6, fadeOut: 0.3, gain: 0.4 })] },
  win: { layers: [L(JG + "8-Bit jingles/jingles_NES12.ogg")] },
  lose: { layers: [L(JG + "8-Bit jingles/jingles_NES07.ogg")], db: -2 },
  podium: { layers: [L(JG + "Steel jingles/jingles_STEEL02.ogg")] },
  positionUp: { layers: [L(UI + "maximize_001.ogg")] },
  positionDown: { layers: [L(UI + "minimize_001.ogg")] },
  select: { layers: [L(UI + "confirmation_001.ogg")] },
  click: { layers: [L(UI + "click_002.ogg")] },
  whoosh: { layers: [L(SF + "doorOpen_001.ogg"), L(SF + "thrusterFire_004.ogg", { dur: 0.4, fadeIn: 0.15, fadeOut: 0.25, gain: 0.5 })] },
};

/** Announcer: the Female voice from Kenney's Voiceover Pack. */
const VOICE = {
  three: "3",
  two: "2",
  one: "1",
  go: "go",
  finalLap: "final_round",
  finish: "mission_completed",
  first: "you_win",
  podium: "congratulations",
  lose: "you_lose",
  newRecord: "new_highscore",
  itemHit: "war_target_destroyed",
  rocketStart: "war_go_go_go",
  ultraTurbo: "power_up",
  lookOut: "war_look_out",
  out: "game_over",
  timeOver: "time_over",
  hurryUp: "hurry_up",
};
const VOICE_PUNCH = 0.3;

/** Engine loops (made seamless with a crossfade), normalized to ENGINE_RMS. */
const ENGINE = {
  core: { file: SF + "engineCircular_002.ogg", off: 0.4, len: 3, xf: 0.35 },
  rumble: { file: SF + "spaceEngineLow_003.ogg", off: 0.4, len: 3, xf: 0.35 },
  boost: { file: SF + "thrusterFire_003.ogg", off: 0.4, len: 2.5, xf: 0.35 },
};
const ENGINE_RMS = 0.25;

/* ------------------------------------------------------------------------ */
/* Browser side                                                              */
/* ------------------------------------------------------------------------ */

const entry = `
import { RACE_SOUNDS, RaceAudio, raceSoundReverb } from "./src/first-party/nova-rally/audio";
const SR = ${RATE};
const buffers = new Map();
const b64ToBytes = (b64) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};
const pack = (chans) => chans.map((d) => {
  const i16 = new Int16Array(d.length);
  for (let i = 0; i < d.length; i++) i16[i] = Math.max(-32768, Math.min(32767, Math.round(d[i] * 32767)));
  let bin = "";
  const bytes = new Uint8Array(i16.buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
});
const stereo = (buf) => [buf.getChannelData(0), buf.getChannelData(Math.min(1, buf.numberOfChannels - 1))];
const peakOf = (chans) => { let p = 0; for (const d of chans) for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > p) p = a; } return p; };
const rmsOf = (chans) => { let e = 0, n = 0; for (const d of chans) { for (let i = 0; i < d.length; i++) e += d[i] * d[i]; n += d.length; } return Math.sqrt(e / Math.max(1, n)); };
/** Short-term loudness: the loudest 50 ms RMS window. */
const punchOf = (chans) => {
  const w = Math.round(SR * 0.05), hop = Math.round(SR * 0.01);
  let best = 0;
  for (let a = 0; a + w <= chans[0].length; a += hop) {
    let e = 0;
    for (const d of chans) for (let i = a; i < a + w; i++) e += d[i] * d[i];
    best = Math.max(best, Math.sqrt(e / (w * chans.length)));
  }
  return best || rmsOf(chans);
};
/** Seconds of near-silence at the start of a buffer. */
const leadOf = (buf) => {
  const chans = stereo(buf);
  const thr = Math.max(0.003, peakOf(chans) * 0.03);
  const d = chans[0];
  for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > thr || Math.abs(chans[1][i]) > thr) return Math.max(0, i / SR - 0.003);
  return 0;
};
const reversed = (ctx, buf) => {
  const out = ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) out.getChannelData(c).set(buf.getChannelData(c).slice().reverse());
  return out;
};
/** Stereo exponentially decaying noise, darkening as it goes (the synth's hall). */
const impulse = (ctx, seconds, decay) => {
  const len = Math.floor(SR * seconds), pre = Math.floor(SR * 0.012);
  const buf = ctx.createBuffer(2, len, SR);
  for (let c = 0; c < 2; c++) {
    const data = buf.getChannelData(c);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const x = (i - pre) / (len - pre);
      lp += (Math.random() * 2 - 1 - lp) * (1 - (0.15 + 0.8 * x));
      data[i] = lp * Math.pow(1 - x, decay) * (i - pre < SR * 0.004 ? (i - pre) / (SR * 0.004) : 1);
    }
  }
  return buf;
};
/** Normalize, trim the tail ~50 dB under the peak, de-click the end. */
const finish = (chans, target, mode) => {
  const level = mode === "rms" ? rmsOf(chans) : punchOf(chans);
  const peak = peakOf(chans) || 1;
  const k = Math.min(target / (level || 1), 0.9 / peak);
  const thr = Math.max(0.0006 / k, peak * 0.003);
  let end = chans[0].length;
  while (end > 1 && Math.abs(chans[0][end - 1]) < thr && Math.abs(chans[1][end - 1]) < thr) end--;
  end = Math.min(chans[0].length, end + Math.round(SR * 0.02));
  const cut = chans.map((d) => d.slice(0, end));
  const fade = Math.min(end, Math.round(SR * 0.01));
  for (const d of cut) {
    for (let i = 0; i < end; i++) d[i] *= k;
    for (let i = 0; i < fade; i++) d[end - 1 - i] *= i / fade;
  }
  return { chans: cut, gain: k, level };
};
window.__render = {
  sounds: RACE_SOUNDS,
  async load(id, b64) {
    const ctx = new OfflineAudioContext(2, 1, SR);
    buffers.set(id, await ctx.decodeAudioData(b64ToBytes(b64).buffer));
    return buffers.get(id).duration;
  },
  /** Loudness of the synth version of an effect (with its reverb), the level its sample replacement matches. */
  async synthPunch(name) {
    return punchOf(stereo(await RaceAudio.renderSound(name, SR)));
  },
  async recipe(layers, target, verb) {
    let end = 0;
    const plan = layers.map(([id, o]) => {
      const buf = buffers.get(id);
      if (!buf) throw new Error("missing " + id);
      const rate = o.rate ?? 1;
      return { buf, o, rate };
    });
    for (const p of plan) {
      const lead = p.o.reverse ? 0 : leadOf(p.buf);
      p.off = lead + (p.o.off ?? 0);
      p.dur = Math.min(p.o.dur ?? Infinity, p.buf.duration - p.off);
      p.out = p.dur / p.rate;
      end = Math.max(end, (p.o.at ?? 0) + p.out);
    }
    const tail = verb > 0 ? 1.6 : 0.05;
    const ctx = new OfflineAudioContext(2, Math.ceil((end + tail) * SR), SR);
    const dry = ctx.createGain();
    dry.connect(ctx.destination);
    if (verb > 0) {
      const conv = ctx.createConvolver();
      conv.buffer = impulse(ctx, 1.6, 3.5);
      const wet = ctx.createGain();
      wet.gain.value = 0.5;
      const send = ctx.createGain();
      send.gain.value = verb;
      dry.connect(send).connect(conv).connect(wet).connect(ctx.destination);
    }
    for (const p of plan) {
      const { o } = p;
      let buf = p.buf;
      if (o.reverse) {
        buf = reversed(ctx, buf);
        p.off = leadOf(buf) + (o.off ?? 0);
        p.dur = Math.min(o.dur ?? Infinity, buf.duration - p.off);
        p.out = p.dur / p.rate;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = p.rate;
      let node = src;
      for (const [type, f] of [["highpass", o.hp], ["lowpass", o.lp]]) {
        if (!f) continue;
        const flt = ctx.createBiquadFilter();
        flt.type = type;
        flt.frequency.value = f;
        node.connect(flt);
        node = flt;
      }
      if (o.pan) {
        const pn = ctx.createStereoPanner();
        pn.pan.value = o.pan;
        node.connect(pn);
        node = pn;
      }
      const g = ctx.createGain();
      const t0 = o.at ?? 0;
      const gain = o.gain ?? 1;
      if (o.fadeIn) {
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(gain, t0 + o.fadeIn);
      } else g.gain.setValueAtTime(gain, t0);
      if (o.fadeOut) {
        g.gain.setValueAtTime(gain, Math.max(t0, t0 + p.out - o.fadeOut));
        g.gain.linearRampToValueAtTime(0, t0 + p.out);
      }
      node.connect(g).connect(dry);
      src.start(t0, p.off, p.dur);
    }
    const r = finish(stereo(await ctx.startRendering()), target, "punch");
    return { pcm: pack(r.chans), gain: r.gain };
  },
  /** A seamless loop of len seconds from the source: its next xf seconds crossfade (equal power) into the head. */
  loop(id, off, len, xf, target) {
    const buf = buffers.get(id);
    const a = Math.round(off * SR), n = Math.round(len * SR), x = Math.round(xf * SR);
    const chans = stereo(buf).map((d) => {
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = d[a + i];
      for (let i = 0; i < x; i++) {
        const t = i / x;
        out[i] = d[a + i] * Math.sin(t * Math.PI / 2) + d[a + n + i] * Math.cos(t * Math.PI / 2);
      }
      return out;
    });
    const k = target / (rmsOf(chans) || 1);
    for (const d of chans) for (let i = 0; i < n; i++) d[i] *= k;
    return pack(chans);
  },
  /** A whole track normalized to an RMS level (peaks capped), as PCM. */
  track(id, target) {
    const chans = stereo(buffers.get(id)).map((d) => d.slice());
    const k = Math.min(target / (rmsOf(chans) || 1), 0.98 / (peakOf(chans) || 1));
    for (const d of chans) for (let i = 0; i < d.length; i++) d[i] *= k;
    return { pcm: pack(chans), gain: k };
  },
  verb: (name) => raceSoundReverb(name),
  async decode(b64) {
    const ctx = new OfflineAudioContext(2, 1, SR);
    const buf = await ctx.decodeAudioData(b64ToBytes(b64).buffer);
    return { rate: buf.sampleRate, data: Array.from(buf.getChannelData(0).subarray(0, 20000)) };
  },
  free(id) { buffers.delete(id); },
};
`;

/* ------------------------------------------------------------------------ */
/* Node side                                                                 */
/* ------------------------------------------------------------------------ */

const unpack = (chans) =>
  chans.map((b64) => {
    const buf = Buffer.from(b64, "base64");
    return new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
  });

function encode([left, right], kbps) {
  const enc = new Mp3Encoder(2, RATE, kbps);
  const parts = [];
  const block = 1152;
  for (let i = 0; i < left.length; i += block) {
    const out = enc.encodeBuffer(left.subarray(i, i + block), right.subarray(i, i + block));
    if (out.length) parts.push(Buffer.from(out));
  }
  const end = enc.flush();
  if (end.length) parts.push(Buffer.from(end));
  return Buffer.concat(parts);
}

/**
 * How far the MP3 round trip (encoder + decoder delay) shifts audio at a bitrate, in seconds:
 * an impulse is encoded and found again after decoding (content-independent, sample accurate).
 */
const delays = new Map();
async function encoderDelay(page, kbps) {
  if (delays.has(kbps)) return delays.get(kbps);
  const at = 2000;
  const probe = [new Int16Array(RATE), new Int16Array(RATE)];
  probe[0][at] = probe[1][at] = 30000;
  const mp3 = encode(probe, kbps);
  const { rate, data } = await page.evaluate((b64) => window.__render.decode(b64), mp3.toString("base64"));
  let best = 0;
  for (let i = 1; i < data.length; i++) if (Math.abs(data[i]) > Math.abs(data[best])) best = i;
  const delay = best / rate - at / RATE;
  delays.set(kbps, delay);
  return delay;
}

const join = (arrs) => {
  const total = arrs.reduce((a, b) => a + b.length, 0);
  const out = new Int16Array(total);
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
};

await fetchSources();
const bundle = await build({
  stdin: { contents: entry, resolveDir: web, loader: "ts" },
  absWorkingDir: web,
  tsconfig: resolve(web, "tsconfig.json"),
  bundle: true,
  format: "iife",
  platform: "browser",
  write: false,
  logLevel: "silent",
});

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage();
await page.setContent("<!doctype html><html><body></body></html>");
await page.addScriptTag({ content: bundle.outputFiles[0].text });
const sounds = await page.evaluate(() => window.__render.sounds);

const loaded = new Set();
async function load(id) {
  if (loaded.has(id)) return;
  const file = resolve(cache, id);
  if (!existsSync(file)) throw new Error(`missing source ${file}`);
  await page.evaluate(([i, b]) => window.__render.load(i, b), [id, readFileSync(file).toString("base64")]);
  loaded.add(id);
}

// Effects, announcer lines and engine loops share one sprite.
const old = existsSync(resolve(outDir, "manifest.json")) ? JSON.parse(readFileSync(resolve(outDir, "manifest.json"), "utf8")) : null;
const manifest = { version: 1, sampleRate: RATE, sfx: {}, voice: {}, engine: {}, music: {} };
const left = [];
const right = [];
let cursor = 0;
const gap = new Int16Array(Math.round(GAP * RATE));
const add = (section, name, pcm) => {
  const dur = pcm[0].length / RATE;
  left.push(pcm[0], gap);
  right.push(pcm[1], gap);
  manifest[section][name] = { start: cursor, dur };
  cursor += dur + GAP;
};
/** A loop region, padded on both sides with its own continuation so a sample or two of misalignment never reaches the gap. */
const PAD = Math.round(0.05 * RATE);
const addLoop = (section, name, pcm) => {
  const n = pcm[0].length;
  const padded = pcm.map((d) => join([d.subarray(n - PAD), d, d.subarray(0, PAD)]));
  add(section, name, padded);
  const e = manifest[section][name];
  e.start += PAD / RATE;
  e.dur = n / RATE;
};

for (const name of sounds) {
  const recipe = SFX[name];
  if (!recipe) throw new Error(`no recipe for ${name}`);
  for (const [id] of recipe.layers) await load(id);
  const synth = await page.evaluate((n) => window.__render.synthPunch(n), name);
  const target = synth * Math.pow(10, (recipe.db ?? 0) / 20);
  const verb = await page.evaluate((n) => window.__render.verb(n), name);
  const { pcm, gain } = await page.evaluate(([l, t, v]) => window.__render.recipe(l, t, v), [recipe.layers, target, verb * 0.6]);
  const chans = unpack(pcm);
  add("sfx", name, chans);
  console.log(`  ${name.padEnd(13)} ${(chans[0].length / RATE).toFixed(2)} s  synth punch ${synth.toFixed(3)}  gain ${gain.toFixed(2)}`);
}
for (const [line, file] of Object.entries(VOICE)) {
  const id = `${VO}${file}.ogg`;
  await load(id);
  const { pcm } = await page.evaluate(([i, t]) => window.__render.recipe([[i, { hp: 110 }]], t, 0.12), [id, VOICE_PUNCH]);
  add("voice", line, unpack(pcm));
}
for (const [name, e] of Object.entries(ENGINE)) {
  await load(e.file);
  const pcm = await page.evaluate(([i, o, l, x, t]) => window.__render.loop(i, o, l, x, t), [e.file, e.off, e.len, e.xf, ENGINE_RMS]);
  addLoop("engine", name, unpack(pcm));
}
const sprite = [join(left), join(right)];
const spriteMp3 = encode(sprite, SFX_KBPS);
const sfxDelay = await encoderDelay(page, SFX_KBPS);
for (const section of ["sfx", "voice", "engine"]) {
  for (const k of Object.keys(manifest[section])) {
    const e = manifest[section][k];
    e.start = +(e.start + sfxDelay).toFixed(5);
    e.dur = +e.dur.toFixed(5);
  }
}
writeFileSync(resolve(outDir, "sfx.mp3"), spriteMp3);
console.log(
  `sfx.mp3 ${(spriteMp3.length / 1024).toFixed(0)} KB, ${(sprite[0].length / RATE).toFixed(1)} s: ${sounds.length} effects, ` +
    `${Object.keys(VOICE).length} voice lines, ${Object.keys(ENGINE).length} engine loops, delay ${(sfxDelay * 1000).toFixed(1)} ms`,
);

// Music: whole tracks loop seamlessly (each is a whole number of bars).
if (sfxOnly && old?.music) {
  manifest.music = old.music;
} else {
  for (const [theme, files] of Object.entries(MUSIC)) {
    manifest.music[theme] = {};
    for (const variant of ["normal", "final"]) {
      const src = variant === "normal" ? files[0] : files[1];
      const file = `music-${theme}${variant === "final" ? "-final" : ""}.mp3`;
      if (!src) {
        // No faster take: the final lap reuses the normal loop.
        manifest.music[theme].final = manifest.music[theme].normal;
        rmSync(resolve(outDir, file), { force: true });
        continue;
      }
      const id = `music/${src}`;
      await load(id);
      const { pcm, gain } = await page.evaluate(([i, t]) => window.__render.track(i, t), [id, MUSIC_RMS[theme] ?? MUSIC_RMS.default]);
      await page.evaluate((i) => window.__render.free(i), id);
      const chans = unpack(pcm);
      const mp3 = encode(chans, MUSIC_KBPS);
      const delay = await encoderDelay(page, MUSIC_KBPS);
      writeFileSync(resolve(outDir, file), mp3);
      manifest.music[theme][variant] = { file, loopStart: +delay.toFixed(5), loopEnd: +(delay + chans[0].length / RATE).toFixed(5) };
      console.log(`${file} ${(mp3.length / 1024).toFixed(0)} KB, loop ${(chans[0].length / RATE).toFixed(2)} s, gain ${gain.toFixed(2)}, delay ${(delay * 1000).toFixed(1)} ms  <- ${src}`);
    }
  }
}
writeFileSync(resolve(outDir, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");
await browser.close();
console.log(`wrote ${outDir}`);

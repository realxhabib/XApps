// Bakes Nova Rally's synthesized sound into MP3 files, so the game plays
// recordings instead of synthesizing music note by note at runtime.
//
//   node scripts/render-nova-audio.mjs        (from apps/web)
//
// It bundles src/first-party/nova-rally/audio.ts with esbuild, runs it in
// headless Chromium (Playwright) where every effect and every music loop is
// rendered with an OfflineAudioContext, then encodes MP3 in Node (lamejs) and
// writes public/audio/nova-rally/:
//   sfx.mp3                       all effects in one sprite
//   music-<theme>.mp3             seamless loop per world
//   music-<theme>-final.mp3       the final-lap variant (faster, a semitone up)
//   manifest.json                 sprite offsets and loop points (seconds),
//                                 corrected for the MP3 encoder's start delay
// Re-run it whenever the synth in audio.ts changes.
import { Mp3Encoder } from "@breezystack/lamejs";
import { build } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, "..");
const outDir = resolve(web, "public/audio/nova-rally");
const RATE = 44100;
const SFX_KBPS = 112;
const MUSIC_KBPS = 112;
const GAP = 0.25;

const entry = `
import { MUSIC_THEMES, RACE_SOUNDS, RaceAudio } from "./src/first-party/nova-rally/audio";
const pack = (buf) => {
  const chans = [];
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(Math.min(c, buf.numberOfChannels - 1));
    const i16 = new Int16Array(d.length);
    for (let i = 0; i < d.length; i++) i16[i] = Math.max(-32768, Math.min(32767, Math.round(d[i] * 32767)));
    let bin = "";
    const bytes = new Uint8Array(i16.buffer);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    chans.push(btoa(bin));
  }
  return chans;
};
window.__render = {
  sounds: RACE_SOUNDS,
  themes: MUSIC_THEMES,
  async sound(name) { return pack(await RaceAudio.renderSound(name, ${RATE})); },
  async music(name, final) {
    const r = await RaceAudio.renderMusic(name, final, ${RATE});
    const a = Math.round(r.loopStart * ${RATE});
    const b = Math.round(r.loopEnd * ${RATE});
    const ctx = new OfflineAudioContext(2, b - a, ${RATE});
    const cut = ctx.createBuffer(2, b - a, ${RATE});
    for (let c = 0; c < 2; c++) cut.getChannelData(c).set(r.buffer.getChannelData(c).subarray(a, b));
    return pack(cut);
  },
  async decode(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ctx = new OfflineAudioContext(2, 1, ${RATE});
    const buf = await ctx.decodeAudioData(bytes.buffer);
    return { rate: buf.sampleRate, data: Array.from(buf.getChannelData(0).subarray(0, 20000)) };
  },
};
`;

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
const code = bundle.outputFiles[0].text;

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

/** Last sample above the noise floor (seconds), so the sprite keeps only what's audible. */
function audibleLength([left, right]) {
  for (let i = left.length - 1; i >= 0; i--) if (Math.abs(left[i]) > 20 || Math.abs(right[i]) > 20) return (i + 1) / RATE;
  return 0.05;
}

/** How many samples the MP3 round trip shifted the audio (encoder + decoder delay). */
async function measureDelay(page, mp3, original) {
  const { rate, data } = await page.evaluate((b64) => window.__render.decode(b64), mp3.toString("base64"));
  const scale = rate / RATE;
  let best = 0;
  let bestScore = -Infinity;
  for (let lag = 0; lag < 3000; lag++) {
    let score = 0;
    for (let i = 0; i < 4096; i += 2) {
      const d = data[Math.round((i + lag) * scale)] ?? 0;
      score += d * (original[i] / 32767);
    }
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  return best / RATE;
}

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage();
await page.setContent("<!doctype html><html><body></body></html>");
await page.addScriptTag({ content: code });
const { sounds, themes } = await page.evaluate(() => ({ sounds: window.__render.sounds, themes: window.__render.themes }));

// Effects sprite.
const manifest = { version: 1, sampleRate: RATE, sfx: {}, music: {} };
const left = [];
const right = [];
let cursor = 0;
for (const name of sounds) {
  const pcm = unpack(await page.evaluate((n) => window.__render.sound(n), name));
  const dur = Math.min(pcm[0].length / RATE, audibleLength(pcm) + 0.02);
  const n = Math.round(dur * RATE);
  left.push(pcm[0].subarray(0, n), new Int16Array(Math.round(GAP * RATE)));
  right.push(pcm[1].subarray(0, n), new Int16Array(Math.round(GAP * RATE)));
  manifest.sfx[name] = { start: cursor, dur };
  cursor += dur + GAP;
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
const sprite = [join(left), join(right)];
const spriteMp3 = encode(sprite, SFX_KBPS);
const sfxDelay = await measureDelay(page, spriteMp3, sprite[0]);
for (const k of Object.keys(manifest.sfx)) manifest.sfx[k].start = +(manifest.sfx[k].start + sfxDelay).toFixed(5);
writeFileSync(resolve(outDir, "sfx.mp3"), spriteMp3);
console.log(`sfx.mp3 ${(spriteMp3.length / 1024).toFixed(0)} KB, ${sounds.length} effects, delay ${(sfxDelay * 1000).toFixed(1)} ms`);

// Music loops.
for (const theme of themes) {
  manifest.music[theme] = {};
  for (const final of [false, true]) {
    const pcm = unpack(await page.evaluate(([t, f]) => window.__render.music(t, f), [theme, final]));
    const mp3 = encode(pcm, MUSIC_KBPS);
    const delay = await measureDelay(page, mp3, pcm[0]);
    const file = `music-${theme}${final ? "-final" : ""}.mp3`;
    writeFileSync(resolve(outDir, file), mp3);
    manifest.music[theme][final ? "final" : "normal"] = {
      file,
      loopStart: +delay.toFixed(5),
      loopEnd: +(delay + pcm[0].length / RATE).toFixed(5),
    };
    console.log(`${file} ${(mp3.length / 1024).toFixed(0)} KB, loop ${(pcm[0].length / RATE).toFixed(2)} s, delay ${(delay * 1000).toFixed(1)} ms`);
  }
}
writeFileSync(resolve(outDir, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");
await browser.close();
console.log(`wrote ${outDir}`);

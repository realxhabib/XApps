// Scout (tiny viewport, no captures) or shoot (full res) a standalone Wedge Wars match.
// node ww-scout.mjs <seed> <mode: scout|shoot> [secondsOfFight] [dir] [fromFrame] [spectator]
import { launch, Recorder, BASE, sleep } from "./rec.mjs";
import { findRt, wwState, autopilot, applyKeys } from "./ww.mjs";
import fs from "node:fs";

const seed = Number(process.argv[2] ?? 7);
const mode = process.argv[3] ?? "scout";
const fightS = Number(process.argv[4] ?? 20);
const dir = process.argv[5] ?? `ww-${seed}`;
const from = Number(process.argv[6] ?? 0); // first fight frame to capture
const spectator = process.argv[7] === "spec";
const nohud = process.argv[8] === "nohud";
const shootScale = Number(process.argv[9] ?? 1.5);
const portrait = process.argv[10] === "portrait";
const FULL = portrait ? { width: 608, height: 1080 } : { width: 1280, height: 720 };
const shoot = mode === "shoot";
const preview = mode === "preview";
const size = shoot ? { ...FULL, scale: shootScale } : { width: preview ? 480 : 320, height: preview ? 270 : 180, scale: 1 };
let small = false;
const { browser, page } = await launch({ ...size, seed });
const q = `quality=high&xapps-players=4${spectator ? "&xapps-role=spectator" : ""}`;
await page.goto(`${BASE}/embed/wedge-wars?${q}`);
if (!spectator) await page.getByRole("button", { name: /Lock in/ }).waitFor({ timeout: 120000 });
await sleep(1500);
const rec = new Recorder(page, dir);
await rec.pause();
if (!spectator) {
  await page.getByRole("button", { name: /Lock in/ }).click();
}
// Step until the match runtime exists, then wait (real time, clock paused) for physics to come up.
let found = false;
for (let i = 0; i < 600 && !found; i++) {
  await rec.step();
  await rec.sync();
  found = await findRt(page.mainFrame());
}
if (!found) throw new Error("no runtime");
if (nohud) await page.addStyleTag({ content: "*{visibility:hidden!important} canvas{visibility:visible!important}" });
const t0 = Date.now();
while (true) {
  const s = await wwState(page.mainFrame());
  if (s && s.bodies >= s.trucks.length) break;
  if (Date.now() - t0 > 180000) throw new Error("physics never came up");
  await rec.step();
  await rec.sync();
  await sleep(150);
}
console.log("runtime ready at step", rec.k, "after", Date.now() - t0, "ms");
{ const s0 = await wwState(page.mainFrame()); console.log("startAt-now", s0.startAt - s0.now, "now", s0.now); }
const log = [];
const mem = {};
const held = new Set();
let fightFrame = -1;
let prevFeed = 0;
let preFight = null;
const total = 3 * 30 + fightS * 30;
for (let i = 0; i < 2000; i++) {
  const st = await wwState(page.mainFrame());
  if (st.phase === "fight" && fightFrame < 0) fightFrame = i;
  const f = fightFrame < 0 ? -1 : i - fightFrame;
  if (!spectator) await applyKeys(page, held, autopilot(st, mem));
  if (shoot) {
    const wantSmall = fightFrame < 0 || f + 1 < from - 20;
    if (wantSmall !== small) { small = wantSmall; await page.setViewportSize(small ? { width: 320, height: 180 } : FULL); }
  }
  await rec.step();
  if ((shoot || (preview && i % 2 === 0)) && f + 1 >= from && f + 1 < fightS * 30) await rec.capture();
  else await rec.sync();
  const me = st.trucks.find((t) => t.me);
  if (st.feed !== prevFeed) {
    const s2 = await page.evaluate(() => JSON.stringify(window.__rt.world.feed[0]));
    log.push(`f${f} KO ${s2}`);
    console.log(`f${f} KO ${s2}`);
    prevFeed = st.feed;
  }
  const flips = st.trucks.filter((t) => t.flipped).map((t) => t.id);
  if (flips.length && i % 5 === 0) log.push(`f${f} flipped ${flips}`);
  if (i % 30 === 0) {
    const line = `f${f} phase=${st.phase} ` + st.trucks.map((t) => `${t.id}:${t.alive ? Math.round(t.hp) : "KO"}@${t.x.toFixed(3)},${t.z.toFixed(3)}${t.flipped ? "F" : ""}`).join(" ");
    log.push(line);
    console.log(line, me ? `me ${me.speed.toFixed(1)}` : "");
  }
  if (fightFrame >= 0 && f >= fightS * 30) break;
  if (st.phase !== "fight" && fightFrame >= 0 && f > 30) { console.log("phase", st.phase); if (f > (from + 200)) break; }
}
fs.writeFileSync(`${rec.dir}/log.txt`, log.join("\n"));
await browser.close();

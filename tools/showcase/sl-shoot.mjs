// Starship League practice inside the XApps play room, keyboard autopilot.
// node sl-shoot.mjs <mode: preview|shoot> <dir> <maxSeconds> [seed]
import { launch, Recorder, BASE, sleep, signIn } from "./rec.mjs";
import { slFrame, slState, slPilot, applyKeys } from "./sl.mjs";
import fs from "node:fs";

const mode = process.argv[2] ?? "preview";
const dir = process.argv[3] ?? "sl";
const maxS = Number(process.argv[4] ?? 40);
const seed = Number(process.argv[5] ?? 11);
const shoot = mode === "shoot";
const size = shoot ? { width: 1280, height: 720, scale: 1.5 } : { width: 1280, height: 720, scale: 0.5 };
const { browser, page } = await launch({ ...size, seed });
page.on("console", (m) => { if (m.type() === "error") console.log("console", m.text().slice(0, 200)); });
await signIn(page, "realxhabib");
await page.goto(BASE + "/apps/starship-league");
await page.getByRole("button", { name: "Practice" }).click();
await page.waitForURL(/\/play\//);
const rec = new Recorder(page, dir);
// Let the iframe boot in real time, then freeze time.
for (let i = 0; i < 60 && !slFrame(page); i++) await sleep(500);
await sleep(3000);
await rec.pause();
const log = [];
const mem = {};
const held = new Set();
let focused = false;
let lastScore = "0-0";
let kick = -1;
let capFrom = -1, playAt = -1;
const afterPlay = Number(process.argv[6] ?? 300);
for (let i = 0; i < maxS * 30; i++) {
  const f = slFrame(page);
  const st = f ? await slState(f).catch(() => null) : null;
  if (st && st.inMatch && !focused) {
    await page.mouse.click(640 * (size.width / 1280), 420 * (size.height / 720));
    focused = true;
  }
  if (st && st.state === "play" && kick < 0) { kick = i; console.log("kickoff at", i); }
  await applyKeys(page, held, st && st.state === "play" ? slPilot(st, mem) : new Set());
  await rec.step();
  if (st && st.me && capFrom < 0) capFrom = i;
  if (st && st.me && st.state === "play" && playAt < 0) playAt = i;
  const inWin = capFrom >= 0 && (playAt < 0 || i < playAt + afterPlay);
  if (shoot ? inWin : i % 2 === 0) await rec.capture(); else await rec.sync();
  if (shoot && playAt >= 0 && i >= playAt + afterPlay) break;
  if (st) {
    const sc = st.score.join("-");
    if (sc !== lastScore) { console.log(`i${i} GOAL ${sc}`); log.push(`i${i} n${rec.n} GOAL ${sc}`); lastScore = sc; }
    if (i % 30 === 0) {
      const line = `i${i} n${rec.n} ${st.state} ball ${st.ball.x.toFixed(1)},${st.ball.y.toFixed(1)},${st.ball.z.toFixed(1)} me ${st.me ? `${st.me.x.toFixed(1)},${st.me.z.toFixed(1)} b${Math.round(st.me.boost)} t${st.me.team}` : "-"}`;
      console.log(line);
      log.push(line);
    }
  } else if (i % 30 === 0) console.log(`i${i} no state`);
}
fs.writeFileSync(`${rec.dir}/log.txt`, log.join("\n"));
await browser.close();

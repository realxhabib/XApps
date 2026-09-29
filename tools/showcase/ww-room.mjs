// Wedge Wars inside the XApps play room (host HUD): lock in from the garage, then the opening charge.
import { launch, Recorder, BASE, sleep, signIn, center, cursorAt } from "./rec.mjs";
import { findRt, wwState, autopilot, applyKeys } from "./ww.mjs";
import fs from "node:fs";
const scale = Number(process.argv[2] ?? 1.5);
const dir = process.argv[3] ?? "wwroom";
const fightFrames = Number(process.argv[4] ?? 150);
const { browser, page } = await launch({ width: 1280, height: 720, scale, seed: 9 });
await signIn(page, "realxhabib");
await page.goto(BASE + "/apps/wedge-wars");
await page.getByRole("button", { name: /^Practice/ }).waitFor();
const four = page.getByRole("radiogroup", { name: "Practice table size" }).getByRole("radio", { name: "4" });
if (await four.isVisible().catch(() => false)) await four.click();
await page.getByRole("button", { name: /^Practice/ }).click();
await page.waitForURL(/\/play\//);
const wwf = () => page.frames().find((f) => f.url().includes("/embed/wedge-wars"));
for (let i = 0; i < 120 && !wwf(); i++) await sleep(500);
await wwf().getByRole("button", { name: /Lock in/ }).waitFor({ timeout: 120000 });
await sleep(5000);
const rec = new Recorder(page, dir);
const marks = [];
const mark = (m) => { marks.push(`${rec.n} ${m}`); console.log(rec.n, m); };
await rec.pause();
rec.mouse = { x: 700, y: 600 };
await cursorAt(page, 700, 600);
await rec.frames(30);
const lock = wwf().getByRole("button", { name: /Lock in/ });
const p = await center(lock);
await rec.glide(p.x, p.y, 16, { click: true });
mark("locked in");
await rec.frames(8);
await cursorAt(page, -50, -50, false);
let found = false;
for (let i = 0; i < 900 && !found; i++) {
  await rec.frames(1);
  found = await findRt(wwf()).catch(() => false);
}
mark("runtime");
const mem = {};
const held = new Set();
let fight = -1;
for (let i = 0; i < 1200; i++) {
  const st = await wwState(wwf()).catch(() => null);
  if (st && st.bodies >= st.trucks.length && fight < 0 && st.phase === "fight") { fight = i; mark("fight"); }
  if (st) await applyKeys(page, held, autopilot(st, mem));
  await rec.frames(1);
  if (fight >= 0 && i - fight >= fightFrames) break;
}
fs.writeFileSync(`${rec.dir}/marks.txt`, marks.join("\n"));
await browser.close();

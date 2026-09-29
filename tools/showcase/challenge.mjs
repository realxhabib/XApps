// Challenge @quickdraw_mcgraw to Reflexes: sheet → VS intro → countdown → play (react at ~0.2 s) → Victory.
// node challenge.mjs <scale> <dir>
import { launch, Recorder, BASE, sleep, signIn, center, cursorAt } from "./rec.mjs";
import fs from "node:fs";
const scale = Number(process.argv[2] ?? 0.5);
const dir = process.argv[3] ?? "chal";
const { browser, page } = await launch({ width: 1280, height: 720, scale, seed: 5 });
await signIn(page, "realxhabib");
await page.goto(BASE + "/apps/quick-draw");
await page.getByRole("button", { name: "Challenge someone" }).waitFor();
await sleep(2500);
const rec = new Recorder(page, dir);
const marks = [];
const mark = (m) => { marks.push(`${rec.n} ${m}`); console.log(rec.n, m); };
await rec.pause();
rec.mouse = { x: 900, y: 560 };
await cursorAt(page, 900, 560);
await rec.frames(24, false);
mark("app page");
await rec.frames(10);
let p = await center(page.getByRole("button", { name: "Challenge someone" }));
await rec.glide(p.x, p.y, 20, { click: true });
mark("clicked challenge someone");
await rec.frames(14);
const search = page.getByLabel("Search players by handle");
p = await center(search);
await rec.glide(p.x - 60, p.y, 12, { click: true });
for (const ch of "quickdraw") { await page.keyboard.type(ch); await rec.frames(2); }
mark("typed");
let result = page.getByRole("button", { name: /@quickdraw_mcgraw/ }).first();
for (let i = 0; i < 90 && !(await result.isVisible().catch(() => false)); i++) await rec.frames(1);
await rec.frames(8);
p = await center(result);
await rec.glide(p.x, p.y, 16, { click: true });
mark("picked");
await rec.frames(10);
const go = page.getByRole("button", { name: /Challenge @quickdraw_mcgraw/ });
p = await center(go);
await rec.glide(p.x, p.y, 16, { click: true });
mark("challenge sent");
// Hide the cursor once we leave for the play room.
let hidden = false;
let goSeen = -1, rounds = 0, done = -1, tapAt = [];
for (let i = 0; i < 2400; i++) {
  const cap = !(tapAt[0] != null && i > tapAt[0] + 60 && (tapAt[1] == null || i < tapAt[1] + 150));
  await rec.frames(1, cap);
  if (!hidden && page.url().includes("/play/")) { await cursorAt(page, -50, -50, false); hidden = true; mark("play room"); }
  const app = page.frames().find((f) => f.url().includes("/embed/quick-draw"));
  if (app) {
    const btn = await app.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((e) => e.getAttribute("aria-label") === "Go! Tap now");
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }).catch(() => null);
    if (btn && goSeen < 0) { goSeen = i; mark("GO"); }
    if (btn && goSeen >= 0 && i - goSeen === 6) {
      const fe = await (await app.frameElement()).boundingBox();
      await page.mouse.click(fe.x + btn.x, fe.y + btn.y);
      rounds++;
      tapAt.push(i);
      mark(`tap ${rounds}`);
    }
    if (!btn) goSeen = -1;
  }
  const dlg = page.getByRole("dialog", { name: /Victory|Defeat/ });
  if (done < 0 && (await dlg.isVisible().catch(() => false))) { done = i; mark("results " + (await dlg.getAttribute("aria-label").catch(() => ""))); }
  if (done >= 0 && i - done > 150) break;
}
fs.writeFileSync(`${rec.dir}/marks.txt`, marks.join("\n"));
await browser.close();

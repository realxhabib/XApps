// Portrait, calmly paced challenge for the short launch clip: pick @neon_nomad straight from the list
// (no typing, so the sheet never resizes) → VS intro → countdown → every round played → Victory.
// node challenge-short.mjs <scale> <dir>
import { launch, Recorder, BASE, sleep, signIn, center, cursorAt } from "./rec.mjs";
import fs from "node:fs";
const scale = Number(process.argv[2] ?? 0.5);
const dir = process.argv[3] ?? "chals";
const { browser, page } = await launch({ width: 405, height: 720, scale, seed: 5 });
await signIn(page, "realxhabib");
await page.goto(BASE + "/apps/quick-draw");
await page.getByRole("button", { name: "Challenge someone" }).waitFor();
await sleep(2500);
const rec = new Recorder(page, dir);
const marks = [];
const mark = (m) => { marks.push(`${rec.n} ${m}`); console.log(rec.n, m); };
await rec.pause();
rec.mouse = { x: 330, y: 640 };
await cursorAt(page, 330, 640);
await rec.frames(20);
mark("app page");
let p = await center(page.getByRole("button", { name: "Challenge someone" }));
await rec.glide(p.x, p.y, 26, { click: true });
mark("clicked challenge someone");
await rec.frames(24);
const rival = page.getByRole("button", { name: /@neon_nomad/ }).first();
await rival.waitFor();
p = await center(rival);
await rec.glide(p.x, p.y, 26, { click: true });
mark("picked");
await rec.frames(16);
const go = page.getByRole("button", { name: /Challenge @neon_nomad/ });
p = await center(go);
await rec.glide(p.x, p.y, 24, { click: true });
mark("challenge sent");
let hidden = false;
let goSeen = -1, rounds = 0, done = -1;
for (let i = 0; i < 2400; i++) {
  await rec.frames(1);
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
      mark(`tap ${++rounds}`);
    }
    if (!btn) goSeen = -1;
  }
  const dlg = page.getByRole("dialog", { name: /Victory|Defeat/ });
  if (done < 0 && (await dlg.isVisible().catch(() => false))) { done = i; mark("results " + (await dlg.getAttribute("aria-label").catch(() => ""))); }
  if (done >= 0 && i - done > 180) break;
}
fs.writeFileSync(`${rec.dir}/marks.txt`, marks.join("\n"));
await browser.close();

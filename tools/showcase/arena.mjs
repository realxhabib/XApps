// Arena: Meme Duel contests, the crowd votes.
import { launch, Recorder, BASE, sleep, signIn, center, cursorAt } from "./rec.mjs";
import fs from "node:fs";
const scale = Number(process.argv[2] ?? 0.5);
const dir = process.argv[3] ?? "arenap";
const { browser, page } = await launch({ width: 1440, height: 810, scale, seed: 4 });
await signIn(page, "realxhabib");
await page.goto(BASE + "/arena");
await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Meme Duel")), null, { timeout: 120000 });
await page.goto(BASE + "/arena");
await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Meme Duel")), null, { timeout: 120000 });
await sleep(2000);
const rec = new Recorder(page, dir);
await rec.pause();
rec.mouse = { x: 1000, y: 700 };
await cursorAt(page, 1000, 700);
await rec.frames(20, false);
await rec.frames(8);
let p = await center(page.locator("button", { hasText: "Meme Duel" }).first());
await rec.glide(p.x, p.y, 14, { click: true });
await rec.frames(24);
{
  const top = await page.evaluate(() => Math.min(...[...document.querySelectorAll('[aria-label^="Vote for entry"]')].map((e) => e.getBoundingClientRect().top + scrollY)));
  const target = Math.max(0, top - 150);
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  console.log("scroll to", target);
  await rec.frames(26, true, async (i) => page.evaluate((v) => window.scrollTo({ top: v, behavior: "instant" }), target * ease((i + 1) / 26)));
  await rec.frames(6);
}
for (let round = 0; round < 3; round++) {
  const opts = await page.evaluate(() => [...document.querySelectorAll("[aria-label^=\"Vote for entry\"]")].filter((e) => e.getBoundingClientRect().width > 150).map((e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height * 0.45, label: e.getAttribute("aria-label") }; }));
  console.log("round", round, JSON.stringify(opts));
  if (!opts.length) { await rec.frames(20); continue; }
  const pick = opts[round % 2 === 0 ? 0 : opts.length - 1];
  await rec.glide(pick.x, pick.y, 16, { click: true });
  await rec.frames(45);
}
await browser.close();

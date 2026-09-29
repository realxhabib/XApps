// Home: guest hero entrance, rotating word, smooth scroll to Featured, hover tilt on the Starship card.
import { launch, Recorder, BASE, sleep } from "./rec.mjs";
const { browser, page } = await launch({ width: 1280, height: 720, scale: 1.5 });
// Warm up (compile route, fill caches), then reload paused.
await page.goto(BASE + "/");
await sleep(4000);
await page.goto("about:blank");
const rec = new Recorder(page, "home");
await rec.pause();
await page.goto(BASE + "/", { waitUntil: "commit" });
// Step (no capture) until the hero headline node exists, so we start on the first painted frame.
for (let i = 0; i < 400; i++) {
  await rec.step();
  await rec.sync();
  const ok = await page.evaluate(() => !!document.querySelector("h1") && document.fonts.status === "loaded").catch(() => false);
  if (ok) { console.log("hero at step", i); break; }
  await sleep(100);
}
await page.mouse.move(1100, 650);
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const featured = await page.evaluate(() => {
  const h = [...document.querySelectorAll("h2")].find((e) => e.textContent.includes("Pick your arena"));
  return h ? h.getBoundingClientRect().top + scrollY : 846;
});
const target = featured - 70;
console.log("featured", featured);
const HERO = 105, SCROLL = 45, HOLD = 75;
await rec.shoot(HERO);
await rec.shoot(SCROLL, async (i) => {
  const y = target * ease((i + 1) / SCROLL);
  await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), y);
});
// Glide the pointer onto the Starship League card for the tilt.
const card = await page.evaluate(() => {
  const a = [...document.querySelectorAll("a")].find((e) => e.textContent.includes("Starship League") && e.getBoundingClientRect().width > 300);
  if (!a) return null;
  const r = a.getBoundingClientRect();
  return { x: r.left + r.width * 0.62, y: r.top + r.height * 0.45 };
});
console.log("card", card);
await rec.shoot(HOLD, async (i) => {
  if (card && i >= 15 && i < 45) {
    const k = ease((i - 14) / 30);
    await page.mouse.move(1100 + (card.x - 1100) * k, 650 + (card.y - 650) * k);
  }
});
await browser.close();

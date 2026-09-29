// For developers: register an app (live preview card + images), console Versions, admin review queue.
import { launch, Recorder, BASE, sleep, signIn, center, cursorAt } from "./rec.mjs";
import fs from "node:fs";
const scale = Number(process.argv[2] ?? 1.5);
const dir = process.argv[3] ?? "dev";
const { browser, page } = await launch({ width: 1280, height: 720, scale, seed: 6 });
await signIn(page, "realxhabib");
await page.goto(BASE + "/developers/new");
await page.getByPlaceholder("Tap Race").waitFor({ timeout: 120000 });
await sleep(2500);
const rec = new Recorder(page, dir);
const marks = [];
const mark = (m) => { marks.push(`${rec.n} ${m}`); console.log(rec.n, m); };
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
async function scrollTo(y, n) {
  const from = await page.evaluate(() => scrollY);
  await rec.frames(n, true, async (i) => page.evaluate((v) => window.scrollTo({ top: v, behavior: "instant" }), from + (y - from) * ease((i + 1) / n)));
}
async function typeIn(text, per = 1) {
  for (const ch of text) { await page.keyboard.type(ch); await rec.frames(per); }
}
await rec.pause();
rec.mouse = { x: 700, y: 600 };
await cursorAt(page, 700, 600);
await rec.frames(20, false);
mark("register");
await rec.frames(6);
let p = await center(page.getByPlaceholder("Tap Race"));
await rec.glide(p.x, p.y, 12, { click: true });
await typeIn("Starship League");
p = await center(page.getByPlaceholder("Ten seconds. Fastest thumbs win."));
await rec.glide(p.x - 120, p.y, 10, { click: true });
await typeIn("Rocket League in orbit. Bonk the Doge.");
mark("typed");
// Down to the images; the preview card is sticky.
const iconTop = await page.evaluate(() => {
  const el = [...document.querySelectorAll("label, span, div, p, h3")].find((e) => e.textContent.trim() === "Icon");
  return el ? el.getBoundingClientRect().top + scrollY : 900;
});
await scrollTo(iconTop - 130, 18);
p = await center(page.getByText("Image", { exact: true }).first());
await rec.glide(p.x, p.y, 10, { click: true });
await rec.frames(4);
await page.getByLabel("Upload icon").setInputFiles(new URL("assets/starship-icon.png", import.meta.url).pathname);
for (let i = 0; i < 120 && !(await page.getByRole("button", { name: "Replace icon" }).isVisible().catch(() => false)); i++) { await rec.frames(1); await sleep(40); }
mark("icon");
await rec.frames(8);
const coverBox = await page.getByRole("button", { name: /Choose cover image/ }).boundingBox().catch(() => null);
if (coverBox) await rec.glide(coverBox.x + coverBox.width / 2, coverBox.y + coverBox.height / 2, 12);
await page.getByLabel("Upload cover").setInputFiles(new URL("assets/starship-cover.jpg", import.meta.url).pathname);
for (let i = 0; i < 120 && !(await page.getByRole("button", { name: "Replace cover" }).isVisible().catch(() => false)); i++) { await rec.frames(1); await sleep(40); }
mark("cover");
await rec.frames(40);
mark("register end");

// Console → Versions.
await rec.resume();
await page.goto(BASE + "/developers/apps/starship-league");
await page.getByRole("tab", { name: "Versions" }).or(page.getByRole("button", { name: "Versions" })).first().waitFor({ timeout: 120000 });
await sleep(2500);
await rec.pause();
await cursorAt(page, rec.mouse.x, rec.mouse.y);
await rec.frames(20, false);
mark("console");
await rec.frames(6);
p = await center(page.getByRole("tab", { name: "Versions" }).or(page.getByRole("button", { name: "Versions" })).first());
await rec.glide(p.x, p.y, 12, { click: true });
await rec.frames(45);
mark("console end");

// Admin review queue.
await rec.resume();
await page.goto(BASE + "/admin/review");
const become = page.getByRole("button", { name: "Become admin (demo)" });
if (await become.isVisible({ timeout: 8000 }).catch(() => false)) { await become.click(); await sleep(2500); }
await page.goto(BASE + "/admin/review");
await sleep(3500);
await rec.pause();
await cursorAt(page, rec.mouse.x, rec.mouse.y);
await rec.frames(20, false);
mark("review");
await rec.frames(50);
mark("review end");
fs.writeFileSync(`${rec.dir}/marks.txt`, marks.join("\n"));
await browser.close();

// Render card / caption sequences: node cards.mjs <outdir> <kind> <seconds> [query...] [--still t]
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
const HERE = fileURLToPath(new URL(".", import.meta.url));
import fs from "node:fs";
const [out, kind, secs, extra = ""] = process.argv.slice(2);
const still = process.argv.includes("--still");
const dir = `${HERE}frames/${out}`;
fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
const browser = await chromium.launch();
const vert = extra.includes("v=1");
const page = await browser.newPage({ viewport: vert ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 } });
await page.goto(`${new URL("cards/cards.html", import.meta.url).href}?kind=${kind}&${extra}`);
await page.waitForFunction(() => window.__ready);
const n = Math.round(Number(secs) * 30);
const cap = kind === "cap";
for (let i = 0; i < n; i++) {
  if (still && i % 10) continue;
  await page.evaluate((t) => window.render(t), i / 30);
  await page.screenshot({ path: `${dir}/${String(i).padStart(5, "0")}.${cap ? "png" : "jpg"}`, omitBackground: cap, type: cap ? "png" : "jpeg", quality: cap ? undefined : 95 });
}
await browser.close();
console.log("done", out, n);

// Deterministic frame recorder for the XApps promo.
// Fake clock (Playwright) + rAF on a 30 fps grid + WAAPI/CSS animations slaved to the fake clock.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** This folder; frames land in ./frames/<shot>. */
export const VID = path.dirname(fileURLToPath(import.meta.url));
export const BASE = "http://localhost:3000";
export const FPS = 30;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Optional local copy of three.js r128 for machines that can't reach cdnjs (SHOWCASE_THREE=/path/three.min.js). */
const three = process.env.SHOWCASE_THREE ? fs.readFileSync(process.env.SHOWCASE_THREE) : null;

// Default: the machine's GPU. SHOWCASE_SOFTWARE_GL=1 forces SwiftShader (GPU-less cloud containers; ~1–6 fps in 3D).
const GL_ARGS = [
  ...(process.env.SHOWCASE_SOFTWARE_GL ? ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : ["--enable-gpu"]),
  "--ignore-gpu-blocklist",
  "--disable-features=WebRtcHideLocalIpsWithMdns",
  "--autoplay-policy=no-user-gesture-required",
  "--hide-scrollbars",
];

// Runs in every frame after Playwright's clock script.
function initScript({ seed }) {
  try {
    localStorage.setItem("xapps:force-demo", "1");
    sessionStorage.setItem("xapps:demo-banner", "hidden");
    sessionStorage.setItem("xapps:demo-invited", "1");
    localStorage.setItem("wedge-wars:quality", "high");
  } catch {}
  // Seed Math.random only inside game iframes (site IDs must stay unique).
  const isGame = location.port === "4100" || location.hostname === "starshipleague.vercel.app" || location.pathname.startsWith("/embed/");
  if (isGame && seed != null) {
    let a = seed >>> 0;
    Math.random = function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  if (isGame && seed != null) {
    let b = (seed * 7919 + 13) >>> 0;
    const next = () => { b |= 0; b = (b + 0x6d2b79f5) | 0; let t = Math.imul(b ^ (b >>> 15), 1 | b); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0); };
    const orig = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = (arr) => {
      if (!(arr instanceof Uint8Array || arr instanceof Uint32Array || arr instanceof Uint16Array)) return orig(arr);
      for (let i = 0; i < arr.length; i++) arr[i] = next();
      return arr;
    };
  }
  // rAF on a 1000/30 ms grid, via the (fake) setTimeout, so every captured frame renders exactly once.
  const FR = 33;
  const st = window.setTimeout, ct = window.clearTimeout;
  const realRaf = window.__pwClock?.builtins?.requestAnimationFrame ?? window.requestAnimationFrame;
  window.__realRaf = realRaf;
  // Fake-timer fires on the 30 fps grid, then the callback runs in the next real rendering frame
  // (so heavy WebGL work stays throttled to what the GPU can present).
  let seq = 0;
  const live = new Map();
  let pending = [];
  window.__manualRaf = false;
  const raf = (cb) => {
    const now = performance.now();
    const at = (Math.floor(now / FR) + 1) * FR;
    const id = ++seq;
    live.set(id, st(() => {
      live.set(id, -1);
      const run = () => { if (live.get(id) === -1) { live.delete(id); cb(at); } };
      if (window.__manualRaf) pending.push(run);
      else realRaf(run);
    }, at - now));
    return id;
  };
  // Harness: run this step's animation-frame callbacks now (clock paused at the step end).
  window.__flushRaf = () => {
    window.__manualRaf = true;
    const list = pending;
    pending = [];
    for (const run of list) {
      try { run(); } catch (e) { console.error("raf error", e && e.message); }
    }
    return list.length;
  };
  const caf = (id) => { const t = live.get(id); if (t !== undefined && t !== -1) ct(t); live.delete(id); };
  Object.defineProperty(window, "requestAnimationFrame", { configurable: true, get: () => raf, set: () => {} });
  Object.defineProperty(window, "cancelAnimationFrame", { configurable: true, get: () => caf, set: () => {} });
  // WAAPI / CSS animations follow the fake clock.
  const seen = new WeakMap();
  window.__syncAnims = () => {
    const now = performance.now();
    for (const a of document.getAnimations()) {
      let s = seen.get(a);
      if (s === undefined) {
        s = now;
        seen.set(a, s);
      }
      if (s === -1) continue;
      const t = (now - s) * (a.playbackRate || 1);
      let end = Infinity;
      try { end = a.effect?.getComputedTiming().endTime ?? Infinity; } catch {}
      if (Number.isFinite(end) && t >= end) {
        seen.set(a, -1);
        try { a.finish(); } catch {}
        continue;
      }
      try {
        if (a.playState !== "paused") a.pause();
        a.currentTime = t;
      } catch {}
    }
  };
  const hide = () => {
    const s = document.createElement("style");
    s.textContent = "nextjs-portal{display:none!important} *{caret-color:transparent} ::-webkit-scrollbar{display:none}";
    (document.head || document.documentElement).appendChild(s);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hide);
  else hide();
}

export async function launch({ width = 1920, height = 1080, seed = 7, scale = 1 } = {}) {
  const browser = await chromium.launch({ args: GL_ARGS });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
  if (three) {
    await context.route(/cdnjs\.cloudflare\.com.*three/, (r) => r.fulfill({ body: three, contentType: "text/javascript" }));
    await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  }
  await context.route("https://starshipleague.vercel.app/**", async (r) => {
    const u = new URL(r.request().url());
    const response = await r.fetch({ url: "http://localhost:4100" + u.pathname + u.search });
    return r.fulfill({ response });
  });
  await context.clock.install({ time: new Date("2026-09-29T17:00:00Z") });
  await context.addInitScript(initScript, { seed });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 300)));
  return { browser, context, page };
}

export async function signIn(page, handle) {
  await page.goto(BASE + "/");
  await page.evaluate(() => localStorage.removeItem("xapps:demo-last-viewer"));
  await page.goto(BASE + "/login");
  await page.getByLabel("Demo handle").fill(handle);
  await page.getByRole("button", { name: "Go", exact: true }).click();
  await page.waitForURL(BASE + "/");
}

/** Frame recorder bound to a page. Call `pause()` once, then `shoot(n)` / `step()`. */
export class Recorder {
  constructor(page, dir) {
    this.page = page;
    this.dir = path.join(VID, "frames", dir);
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.dir, { recursive: true });
    this.k = 0; // frames on the grid since pause
    this.n = 0; // frames written
    this.t0 = 0;
    this.hooks = [];
  }
  async pause() {
    const nows = await Promise.all(this.page.frames().map((f) => f.evaluate(() => Date.now()).catch(() => 0)));
    const now = Math.max(...nows);
    if (nows.length > 1) console.log("frame clocks", nows.map((n) => n - now).join(","));
    this.t0 = Math.ceil(now + 3000);
    await this.page.clock.pauseAt(this.t0);
    await Promise.all(this.page.frames().map((f) => f.evaluate(() => { window.__manualRaf = true; }).catch(() => {})));
    this.k = 0;
    this.ms = 0;
  }
  /** Advance the fake clock one video frame without capturing. */
  async step(frames = 1) {
    for (let i = 0; i < frames; i++) {
      this.k++;
      await this.page.clock.runFor(33);
      await Promise.all(this.page.frames().map((f) => f.evaluate(() => window.__flushRaf?.()).catch(() => {})));
      for (const h of this.hooks) await h(this);
    }
  }
  /** Back to natural time (for setup between shots). */
  async resume() {
    await Promise.all(this.page.frames().map((f) => f.evaluate(() => { window.__manualRaf = false; window.__flushRaf?.(); window.__manualRaf = false; }).catch(() => {})));
    await this.page.clock.resume();
  }
  async sync() {
    // Throttle to real presentation (GPU backlog), then slave WAAPI animations to the fake clock.
    await Promise.all(this.page.frames().map((f) => f.evaluate(() => new Promise((r) => (window.__realRaf ?? requestAnimationFrame)(() => r()))).catch(() => {})));
    for (const f of this.page.frames()) await f.evaluate(() => window.__syncAnims?.()).catch(() => {});
  }
  async capture() {
    await this.sync();
    const file = path.join(this.dir, String(this.n).padStart(5, "0") + ".jpg");
    await this.page.screenshot({ path: file, type: "jpeg", quality: 94, timeout: 300000 });
    this.n++;
    return file;
  }
  async shoot(frames, each) {
    for (let i = 0; i < frames; i++) {
      if (each) await each(i, this);
      await this.step();
      await this.capture();
      if (this.n % 30 === 0) console.log(`  ${path.basename(this.dir)}: ${this.n} frames`);
    }
  }
}

// ---- Visible cursor (recording overlay in the top document) ----
const CURSOR_SVG = `<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2.5l15.5 9.2-6.8 1.6 3.9 7.3-2.9 1.5-3.9-7.3L4.9 19z" fill="#fff" stroke="#000" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
export async function cursorAt(page, x, y, show = true) {
  await page.evaluate(({ x, y, show, svg }) => {
    let c = document.getElementById("__cur");
    if (!c) {
      c = document.createElement("div");
      c.id = "__cur";
      c.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;filter:drop-shadow(0 2px 4px rgb(0 0 0 / .5));transition:none";
      c.innerHTML = svg;
      document.documentElement.appendChild(c);
    }
    c.style.transform = `translate(${x - 3}px, ${y - 2}px)`;
    c.style.opacity = show ? "1" : "0";
  }, { x, y, show, svg: CURSOR_SVG }).catch(() => {});
}
export async function ripple(page, x, y) {
  await page.evaluate(({ x, y }) => {
    const r = document.createElement("div");
    r.style.cssText = `position:fixed;left:${x - 22}px;top:${y - 22}px;width:44px;height:44px;border-radius:50%;border:2px solid rgb(255 255 255 / .85);background:rgb(255 255 255 / .15);z-index:2147483646;pointer-events:none`;
    document.documentElement.appendChild(r);
    const a = r.animate([{ transform: "scale(.3)", opacity: 1 }, { transform: "scale(1.4)", opacity: 0 }], { duration: 450, easing: "cubic-bezier(.16,1,.3,1)", fill: "forwards" });
    a.onfinish = () => r.remove();
  }, { x, y }).catch(() => {});
}
/** Glide the (visible) mouse to x,y over n captured frames, optionally click at the end. */
Recorder.prototype.glide = async function (x, y, n = 18, { click = false, capture = true } = {}) {
  const page = this.page;
  const from = this.mouse ?? { x: x + 160, y: y + 120 };
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  for (let i = 1; i <= n; i++) {
    const k = ease(i / n);
    const px = from.x + (x - from.x) * k, py = from.y + (y - from.y) * k;
    await page.mouse.move(px, py);
    await cursorAt(page, px, py);
    await this.step();
    if (capture) await this.capture(); else await this.sync();
  }
  this.mouse = { x, y };
  if (click) {
    await page.mouse.down();
    await ripple(page, x, y);
    await this.step();
    if (capture) await this.capture(); else await this.sync();
    await page.mouse.up();
  }
};
Recorder.prototype.frames = async function (n, capture = true, each) {
  for (let i = 0; i < n; i++) {
    if (each) await each(i);
    await this.step();
    if (capture) await this.capture(); else await this.sync();
  }
};
export async function center(locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("no box");
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

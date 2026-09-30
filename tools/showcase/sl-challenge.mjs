// Challenge a rival to Starship League: app page → challenge sheet → VS intro → the match (keyboard autopilot)
// → our goal → Victory, as one continuous take. Staging, harness-only (the game is untouched): the game's own
// All-Star AI flies our ship, the opponent flies at Rookie, the in-game kickoff countdown is shortened (XApps has
// just counted down), and our first goal ends the match (regulation is marked over, so the goal celebration
// leads straight into the results).
// node sl-challenge.mjs <width> <height> <scale> <dir> [rival handle] [seed]
import { launch, Recorder, BASE, sleep, signIn, center, cursorAt } from "./rec.mjs";
import { slFrame, slState } from "./sl.mjs";
import fs from "node:fs";
const [W, H, scale] = [Number(process.argv[2] ?? 405), Number(process.argv[3] ?? 720), Number(process.argv[4] ?? 0.5)];
const dir = process.argv[5] ?? "slc";
const rival = process.argv[6] ?? "neon_nomad";
const seed = Number(process.argv[7] ?? 11);
const { browser, page } = await launch({ width: W, height: H, scale, seed });
await signIn(page, "realxhabib");
await page.goto(BASE + "/apps/starship-league");
await page.getByRole("button", { name: "Challenge someone" }).waitFor();
// On a phone-sized viewport the button sits under the bottom nav: bring it up into the clear.
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((e) => e.textContent.includes("Challenge someone"));
  window.scrollBy(0, b.getBoundingClientRect().bottom - innerHeight * 0.62);
});
await sleep(2500);
const rec = new Recorder(page, dir);
const marks = [];
const mark = (m) => { marks.push(`${rec.n} ${m}`); console.log(rec.n, m); };
await rec.pause();
rec.mouse = { x: W - 70, y: H - 80 };
await cursorAt(page, rec.mouse.x, rec.mouse.y);
await rec.frames(20);
mark("app page");
let p = await center(page.getByRole("button", { name: "Challenge someone" }));
await rec.glide(p.x, p.y, 26, { click: true });
mark("clicked challenge someone");
await rec.frames(24);
const pickBtn = page.getByRole("button", { name: new RegExp(`@${rival}`) }).first();
await pickBtn.waitFor();
p = await center(pickBtn);
await rec.glide(p.x, p.y, 26, { click: true });
mark("picked");
await rec.frames(16);
// Team games get the table builder: its send button reads "Invite 1".
const go = page.getByRole("button", { name: new RegExp(`^(Challenge @${rival}|Invite 1)`) });
await go.scrollIntoViewIfNeeded();
await rec.frames(6);
p = await center(go);
await rec.glide(p.x, p.y, 24, { click: true });
mark("challenge sent");

let hidden = false, focused = false, eased = false, ended = false, kick = -1, done = -1;
let lastScore = "0-0";
for (let i = 0; i < 9000; i++) {
  if (!hidden && page.url().includes("/play/")) { await cursorAt(page, -50, -50, false); hidden = true; mark("play room"); }
  const f = slFrame(page);
  const st = f ? await slState(f).catch(() => null) : null;
  if (st && st.inMatch && !eased) {
    await f.evaluate(() => {
      const SL = window.SL, G = SL.Game;
      for (const b of G.bots) b.skill = SL.SKILLS[0];
      G.bots.push(new SL.Bot(G.humans[0], 2)); // runs after input is read each tick, so it owns our controls
      if (G.state === "countdown") G.countdown = Math.min(G.countdown, 0.99);
    }).catch(() => {});
    eased = true;
    mark("in match (autopilot on, rival eased, short countdown)");
  }
  if (st && st.inMatch && !focused) {
    const box = await (await f.frameElement()).boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.6);
    focused = true;
  }
  if (st && st.state === "play" && kick < 0) { kick = i; mark("kickoff"); }
  await rec.frames(1);
  if (st) {
    const sc = st.score.join("-");
    if (sc !== lastScore) { mark(`GOAL ${sc}`); lastScore = sc; }
    const mine = st.me ? st.score[st.me.team] : 0, theirs = st.me ? st.score[1 - st.me.team] : 0;
    if (!ended && mine > theirs) {
      // The clock stops where it is; after the celebration the game sees regulation over with a lead and ends.
      await f.evaluate(() => { window.SL.Game.zero = true; }).catch(() => {});
      ended = true;
      mark("match ends on this goal");
    }
    if (!ended && theirs > mine) { console.log("rival scored first: try another seed"); break; }
    if (i % 150 === 0) console.log(`i${i} n${rec.n} ${st.state} ${sc} clock ${st.time.toFixed(0)}`);
  }
  const dlg = page.getByRole("dialog", { name: /Victory|Defeat|Draw/ });
  if (done < 0 && i % 5 === 0 && (await dlg.isVisible().catch(() => false))) { done = i; mark("results " + (await dlg.getAttribute("aria-label").catch(() => ""))); }
  if (done >= 0 && i - done > 180) break;
}
fs.writeFileSync(`${rec.dir}/marks.txt`, marks.join("\n"));
await browser.close();

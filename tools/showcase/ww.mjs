// Wedge Wars helpers: read the match runtime (via React fiber, read-only) and a keyboard autopilot.

export async function findRt(frame) {
  return frame.evaluate(() => {
    if (window.__rt && window.__rt.world) return true;
    for (const el of document.querySelectorAll("*")) {
      const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
      if (!key) continue;
      let f = el[key];
      while (f) {
        const p = f.memoizedProps;
        if (p && p.rt && p.rt.world) {
          window.__rt = p.rt;
          return true;
        }
        f = f.return;
      }
    }
    return false;
  });
}

export async function wwState(frame) {
  return frame.evaluate(() => {
    const rt = window.__rt;
    if (!rt) return null;
    const w = rt.world;
    return {
      phase: w.phase,
      now: performance.now(),
      startAt: w.startAt,
      bodies: rt.bodies.size,
      watching: w.watching,
      feed: (w.feed || []).length,
      trucks: w.trucks.map((t) => ({
        id: t.id, me: t.isMe, alive: t.alive, x: t.pos.x, y: t.pos.y, z: t.pos.z, yaw: t.yaw, speed: t.speed,
        vx: t.vel.x, vz: t.vel.z, flipped: t.flipped, hp: t.hp, weapon: t.loadout.weapon, cooldown: t.cooldown, boost: t.boost,
        koCause: t.koCause, lastHitBy: t.lastHitBy,
      })),
    };
  });
}

const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a <= -Math.PI) a += 2 * Math.PI; return a; };
const ENGAGE = { spinner: { dist: 4.2, angle: 0.5 }, flipper: { dist: 3.1, angle: 0.32 }, hammer: { dist: 3.3, angle: 0.3 }, flamer: { dist: 5.8, angle: 0.3 } };

/** Decide which keys to hold. `mem` persists between frames. */
export function autopilot(st, mem, opts = {}) {
  const keys = new Set();
  const me = st.trucks.find((t) => t.me);
  if (!me || !me.alive || st.phase !== "fight") return keys;
  if (me.flipped) { keys.add("KeyR"); return keys; }
  const live = st.trucks.filter((t) => !t.me && t.alive);
  if (!live.length) return keys;
  let target = live.find((t) => t.id === (opts.targetId ?? mem.targetId));
  if (!target || (!opts.targetId && (mem.frame ?? 0) % 90 === 0)) {
    target = live.reduce((a, b) => (Math.hypot(a.x - me.x, a.z - me.z) < Math.hypot(b.x - me.x, b.z - me.z) ? a : b));
    mem.targetId = target.id;
  }
  mem.frame = (mem.frame ?? 0) + 1;
  const dist = Math.hypot(target.x - me.x, target.z - me.z);
  let tx = target.x + target.vx * 0.3, tz = target.z + target.vz * 0.3;
  // Line up so the pit is behind the target (shove them in).
  if (opts.shove !== false) {
    const pd = Math.hypot(target.x, target.z);
    if (pd < 10 && dist > 4) {
      tx += (target.x / (pd || 1)) * 2.5;
      tz += (target.z / (pd || 1)) * 2.5;
    }
  }
  let gx = tx - me.x, gz = tz - me.z;
  const gl = Math.hypot(gx, gz) || 1;
  gx = (gx / gl) * 4; gz = (gz / gl) * 4;
  // Avoid the pit and walls.
  const fx = Math.sin(me.yaw), fz = Math.cos(me.yaw);
  const look = 2.5 + Math.max(0, me.speed) * 0.35;
  const ax = me.x + fx * look, az = me.z + fz * look;
  const over = (x, z, m) => Math.abs(x) < 3 + m && Math.abs(z) < 3 + m;
  if (over(ax, az, 1.6) || over(me.x, me.z, 1.0)) {
    const d = Math.hypot(me.x, me.z) || 1;
    gx += (me.x / d) * 6; gz += (me.z / d) * 6;
  }
  const wall = 17.5;
  if (Math.abs(ax) > wall) gx -= Math.sign(ax) * 5;
  if (Math.abs(az) > wall) gz -= Math.sign(az) * 5;
  const want = Math.atan2(gx, gz);
  const err = wrap(want - me.yaw);
  if (err > 0.12) keys.add("KeyA");
  else if (err < -0.12) keys.add("KeyD");
  if (Math.abs(err) < 2.4) keys.add("KeyW");
  else keys.add("KeyS");
  // Stuck → reverse briefly.
  if (Math.abs(me.speed) < 0.5) mem.stuck = (mem.stuck ?? 0) + 1; else mem.stuck = 0;
  if (mem.stuck > 30) mem.reverse = 20;
  if (mem.reverse > 0) {
    mem.reverse--;
    keys.delete("KeyW"); keys.add("KeyS");
  }
  const aimOff = Math.abs(wrap(Math.atan2(target.x - me.x, target.z - me.z) - me.yaw));
  const eng = ENGAGE[me.weapon] ?? ENGAGE.spinner;
  if (dist < eng.dist + 0.4 && aimOff < eng.angle + 0.1 && me.cooldown <= 0) keys.add("Space");
  if (me.weapon === "spinner" && dist < 6) keys.add("Space");
  if (dist > 6 && Math.abs(err) < 0.3 && me.boost > 0.3 && opts.boost !== false) keys.add("ShiftLeft");
  return keys;
}

export async function applyKeys(page, held, want) {
  for (const k of [...held]) if (!want.has(k)) { await page.keyboard.up(k); held.delete(k); }
  for (const k of want) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
}

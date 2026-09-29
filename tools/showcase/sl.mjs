// Starship League: read game state (window.SL in the game frame) and a keyboard autopilot.

export const slFrame = (page) => page.frames().find((f) => /localhost:4100|starshipleague\.vercel\.app/.test(f.url()));

export async function slState(frame) {
  return frame.evaluate(() => {
    const SL = window.SL, G = SL && SL.Game;
    if (!G || !G.ball) return null;
    const me = G.humans && G.humans[0];
    const v = (p) => ({ x: p.x, y: p.y, z: p.z });
    return {
      state: G.state, score: [...G.score], inMatch: !!(SL.Online && SL.Online.inMatch), time: G.time,
      ball: { ...v(G.ball.pos), vx: G.ball.vel.x, vy: G.ball.vel.y, vz: G.ball.vel.z },
      me: me ? { ...v(me.pos), fwd: v(me.fwd), right: v(me.right), vel: v(me.vel), boost: me.boost, onGround: me.onGround, team: me.team, demolished: !!me.demolished } : null,
      attack: me ? -SL.ownGoalSign(me.team) : 0,
      cars: G.cars.map((c) => ({ name: c.name, team: c.team, x: c.pos.x, y: c.pos.y, z: c.pos.z })),
    };
  });
}

/** Keys to hold this frame. */
export function slPilot(st, mem) {
  const keys = new Set();
  if (!st || !st.me || st.me.demolished) return keys;
  const HZ = 51.2;
  const me = st.me, b = st.ball;
  const toBall0 = Math.hypot(b.x - me.x, b.z - me.z);
  // Kickoff (ball parked at centre): full boost straight in, then a front flip into it.
  const parked = Math.hypot(b.x, b.z) < 0.5 && Math.hypot(b.vx, b.vz) < 0.5 && b.y < 1.2;
  if (mem.dodge != null || (parked && toBall0 < 5.2 && me.onGround)) {
    mem.dodge = (mem.dodge ?? -1) + 1;
    keys.add("KeyW");
    if (mem.dodge < 3 || (mem.dodge >= 5 && mem.dodge < 8)) keys.add("Space");
    if (mem.dodge > 30) mem.dodge = null;
    return keys;
  }
  if (parked) {
    const vx = b.x - me.x, vz = b.z - me.z;
    const ang = Math.atan2(vx * me.right.x + vz * me.right.z, vx * me.fwd.x + vz * me.fwd.z);
    keys.add("KeyW"); keys.add("ShiftLeft");
    if (ang > 0.05) keys.add("KeyD"); else if (ang < -0.05) keys.add("KeyA");
    return keys;
  }
  const gz = st.attack * (HZ + 2);
  // Aim point: a little behind the ball on the goal line → ball.
  let dx = b.x - 0, dz = b.z - gz;
  const dl = Math.hypot(dx, dz) || 1;
  dx /= dl; dz /= dl;
  const toBall = Math.hypot(b.x - me.x, b.z - me.z);
  const lead = Math.min(0.6, toBall / 30);
  const bx = b.x + b.vx * lead, bz = b.z + b.vz * lead;
  const behind = toBall > 7 ? 3.2 : 0.4;
  const tx = bx + dx * behind, tz = bz + dz * behind;
  const vx = tx - me.x, vz = tz - me.z;
  const lf = vx * me.fwd.x + vz * me.fwd.z, lr = vx * me.right.x + vz * me.right.z;
  const ang = Math.atan2(lr, lf);
  const dist = Math.hypot(vx, vz);
  if (Math.abs(ang) > 2.3 && dist < 6) {
    keys.add("KeyS");
    if (ang > 0) keys.add("KeyA"); else keys.add("KeyD");
  } else {
    keys.add("KeyW");
    if (ang > 0.08) keys.add("KeyD");
    else if (ang < -0.08) keys.add("KeyA");
    if (Math.abs(ang) < 0.25 && me.onGround && me.boost > 5) keys.add("ShiftLeft");
  }
  // Jump for a ball in the air nearby.
  mem.jumpHold = Math.max(0, (mem.jumpHold ?? 0) - 1);
  if (me.onGround && toBall < 6 && b.y > 2.2 && Math.abs(ang) < 0.5 && !mem.jumpHold) mem.jumpHold = 8;
  if (mem.jumpHold > 0) keys.add("Space");
  return keys;
}

export async function applyKeys(page, held, want) {
  for (const k of [...held]) if (!want.has(k)) { await page.keyboard.up(k); held.delete(k); }
  for (const k of want) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
}

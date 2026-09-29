import { createRandom } from "@xapps/sdk";
import { describe, expect, it } from "vitest";
import {
  ARENA,
  ARMORS,
  DAMAGE_BONUS_CAP,
  DEFAULT_LOADOUT,
  EXTRAPOLATE_MS,
  HP_MAX,
  PACKED_LENGTH,
  ROUND_MS,
  SendBudget,
  applyDamage,
  botDecide,
  botLoadout,
  botSkill,
  decodeHit,
  decodeLoadout,
  encodeHit,
  encodeLoadout,
  formatClock,
  hazardLayout,
  inCone,
  loadoutStats,
  newBotMemory,
  overPit,
  packTruck,
  parseLoadout,
  placements,
  pulverizerJustLanded,
  pulverizerLevel,
  pushSnapshot,
  ramDamage,
  roundOver,
  sampleSnapshots,
  sawLevel,
  scoreFor,
  spawnFor,
  sphereHitsHull,
  spinnerDamage,
  topSpeed,
  unpackTruck,
  updateClockOffset,
  ventState,
  wrapAngle,
  emptyNetTruck,
  type BotSense,
  type Loadout,
  type NetTruck,
  type Snapshot,
  type Standing,
} from "./logic";

const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length]!;
};

describe("loadouts", () => {
  it("round-trips every weapon × armor × paint through the wire code", () => {
    for (const weapon of ["spinner", "flipper", "hammer", "flamer"] as const) {
      for (const armor of ["scout", "brawler", "tank"] as const) {
        for (let paint = 0; paint < 6; paint++) {
          const l: Loadout = { weapon, armor, paint };
          expect(decodeLoadout(encodeLoadout(l))).toEqual(l);
        }
      }
    }
  });

  it("falls back to the default for junk", () => {
    expect(decodeLoadout("nope")).toEqual(DEFAULT_LOADOUT);
    expect(decodeLoadout(-3)).toEqual(DEFAULT_LOADOUT);
    expect(parseLoadout({ weapon: "laser", armor: "tank", paint: 99 })).toEqual({ weapon: "spinner", armor: "tank", paint: 0 });
    expect(parseLoadout(null)).toEqual(DEFAULT_LOADOUT);
  });

  it("trades speed for armor", () => {
    const scout = loadoutStats({ weapon: "flamer", armor: "scout", paint: 0 });
    const tank = loadoutStats({ weapon: "flamer", armor: "tank", paint: 0 });
    expect(scout.speed).toBeGreaterThan(tank.speed);
    expect(tank.armor).toBeGreaterThan(scout.armor);
    for (const v of [...Object.values(scout), ...Object.values(tank)]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(topSpeed({ weapon: "flamer", armor: "scout", paint: 0 })).toBeGreaterThan(topSpeed({ weapon: "spinner", armor: "tank", paint: 0 }));
  });

  it("bot loadouts and skills are deterministic per seed and seat", () => {
    const a = createRandom("seed-1").fork("loadout:2");
    const b = createRandom("seed-1").fork("loadout:2");
    const la = botLoadout(() => a.next(), 2);
    expect(botLoadout(() => b.next(), 2)).toEqual(la);
    const s = botSkill(() => a.next(), 2);
    expect(s).toBeGreaterThanOrEqual(0.35);
    expect(s).toBeLessThanOrEqual(0.95);
  });
});

describe("damage model", () => {
  it("armor soaks 60% until it runs out", () => {
    expect(applyDamage({ hp: 100, armor: 40 }, 10)).toMatchObject({ hp: 96, armor: 34, hpLoss: 4, armorLoss: 6 });
    // Only 3 armor left: it soaks 3, the rest hits the hull.
    expect(applyDamage({ hp: 100, armor: 3 }, 10)).toMatchObject({ hp: 93, armor: 0 });
    expect(applyDamage({ hp: 5, armor: 0 }, 50)).toMatchObject({ hp: 0, armor: 0, hpLoss: 5 });
    expect(applyDamage({ hp: 50, armor: 10 }, -4)).toMatchObject({ hp: 50, armor: 10 });
    expect(applyDamage({ hp: 50, armor: 10 }, Number.NaN)).toMatchObject({ hp: 50, armor: 10 });
  });

  it("rams need speed and a nose-first angle", () => {
    expect(ramDamage(3, 1)).toBe(0);
    expect(ramDamage(10, 1)).toBeGreaterThan(0);
    expect(ramDamage(10, 0.2)).toBe(0); // side-swipe
    expect(ramDamage(10, -1)).toBe(0); // reversing into them
    expect(ramDamage(14, 1)).toBeGreaterThan(ramDamage(8, 1));
    expect(ramDamage(14, 1, 1.35)).toBeGreaterThan(ramDamage(14, 1));
    expect(ramDamage(100, 1, 2)).toBe(30);
  });

  it("spinner damage grows with spin", () => {
    expect(spinnerDamage(0)).toBe(4);
    expect(spinnerDamage(1)).toBe(28);
    expect(spinnerDamage(0.5)).toBeLessThan(spinnerDamage(0.8));
    expect(spinnerDamage(7)).toBe(28);
  });
});

describe("hit geometry", () => {
  it("sphere vs a truck's hull box respects its heading", () => {
    // Truck at origin facing +Z: hull is 1.35 long in z, 0.82 wide in x.
    expect(sphereHitsHull(0, 0, 1.9, 0.6, 0, 0, 0, 0)).toBe(true);
    expect(sphereHitsHull(0, 0, 2.1, 0.6, 0, 0, 0, 0)).toBe(false);
    // Same point, truck turned 90°: now it's off the side.
    expect(sphereHitsHull(0, 0, 1.9, 0.6, 0, 0, 0, Math.PI / 2)).toBe(false);
    expect(sphereHitsHull(1.9, 0, 0, 0.6, 0, 0, 0, Math.PI / 2)).toBe(true);
    // Above the roof doesn't count.
    expect(sphereHitsHull(0, 2, 0, 0.5, 0, 0, 0, 0)).toBe(false);
  });

  it("flame cone", () => {
    expect(inCone(0, 0, 0, 0, 4, 5.5, 0.3)).toBe(true);
    expect(inCone(0, 0, 0, 0, -4, 5.5, 0.3)).toBe(false);
    expect(inCone(0, 0, 0, 3, 3, 5.5, 0.3)).toBe(false);
    expect(inCone(0, 0, 0, 0, 7.5, 5.5, 0.3)).toBe(false);
    expect(inCone(0, 0, Math.PI / 2, 4, 0, 5.5, 0.3)).toBe(true);
  });

  it("pit + spawns", () => {
    expect(overPit(0, 0)).toBe(true);
    expect(overPit(ARENA.pit.half + 0.5, 0)).toBe(false);
    expect(overPit(ARENA.pit.half + 0.5, 0, 1)).toBe(true);
    for (let seat = 0; seat < 4; seat++) {
      const s = spawnFor(seat);
      expect(overPit(s.x, s.z, 3)).toBe(false);
      // Facing the middle.
      const fx = Math.sin(s.yaw);
      const fz = Math.cos(s.yaw);
      expect(fx * -s.x + fz * -s.z).toBeGreaterThan(0);
    }
    expect(new Set([0, 1, 2, 3].map((i) => JSON.stringify(spawnFor(i)))).size).toBe(4);
  });

  it("wraps angles", () => {
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI * 1.5)).toBeCloseTo(Math.PI / 2);
    expect(wrapAngle(0.2)).toBeCloseTo(0.2);
  });
});

describe("hazards", () => {
  it("layout comes from the seeded random", () => {
    const a = createRandom("m1");
    const b = createRandom("m1");
    expect(hazardLayout(() => a.next())).toEqual(hazardLayout(() => b.next()));
  });

  it("saws pop up and drop on a cycle", () => {
    const levels = Array.from({ length: 70 }, (_, i) => sawLevel(i / 10, 0));
    expect(Math.max(...levels)).toBe(1);
    expect(Math.min(...levels)).toBe(0);
    expect(sawLevel(1.2, 0)).toBe(1);
    expect(sawLevel(5, 0)).toBe(0);
  });

  it("vents warn before they fire", () => {
    expect(ventState(0.5, 0)).toBe("warn");
    expect(ventState(1.5, 0)).toBe("fire");
    expect(ventState(4, 0)).toBe("idle");
  });

  it("pulverizer lands once per period", () => {
    let landings = 0;
    for (let t = 0; t < 65; t += 0.05) if (pulverizerJustLanded(t, t + 0.05, 0.3)) landings++;
    expect(landings).toBe(10);
    // …and it's on the floor right after landing.
    for (let t = 0; t < 20; t += 0.01) {
      if (pulverizerJustLanded(t, t + 0.01, 0.3)) expect(pulverizerLevel(t + 0.02, 0.3)).toBeLessThan(0.05);
    }
  });
});

describe("placements and scoring", () => {
  const st = (id: string, seat: number, o: Partial<Standing> = {}): Standing => ({ id, seat, alive: true, hp: 100, armor: 0, koAt: null, dmg: 0, ...o });

  it("survivors first by hull left, KO'd by how long they lasted", () => {
    const ranks = placements([
      st("a", 0, { alive: false, koAt: 30_000 }),
      st("b", 1, { hp: 40 }),
      st("c", 2, { alive: false, koAt: 90_000 }),
      st("d", 3, { hp: 70 }),
    ]);
    expect(Object.fromEntries(ranks)).toEqual({ d: 1, b: 2, c: 3, a: 4 });
  });

  it("ties break by damage dealt, then seat", () => {
    const ranks = placements([st("a", 0, { hp: 50, dmg: 10 }), st("b", 1, { hp: 50, dmg: 30 }), st("c", 2, { hp: 50, dmg: 10 })]);
    expect(Object.fromEntries(ranks)).toEqual({ b: 1, a: 2, c: 3 });
    // Armor counts as hull.
    expect(placements([st("a", 0, { hp: 60 }), st("b", 1, { hp: 40, armor: 30 })]).get("b")).toBe(1);
  });

  it("score = 1000 × places beaten + capped damage + hull left", () => {
    expect(scoreFor(1, 4, 250.4, 81.6)).toBe(3000 + 250 + 82);
    expect(scoreFor(4, 4, 90, 0)).toBe(90);
    expect(scoreFor(2, 2, 9999, 0)).toBe(DAMAGE_BONUS_CAP);
    expect(scoreFor(1, 2, -5, 150)).toBe(1000 + HP_MAX);
  });

  it("the score order always matches the placement order", () => {
    const r = createRandom("scores");
    for (let n = 2; n <= 4; n++) {
      for (let trial = 0; trial < 200; trial++) {
        const rows = Array.from({ length: n }, (_, i) => ({ rank: i + 1, dmg: r.float(0, 2000), hp: r.float(0, 100) }));
        const scores = rows.map((x) => scoreFor(x.rank, n, x.dmg, x.hp));
        for (let i = 1; i < n; i++) expect(scores[i - 1]!).toBeGreaterThan(scores[i]!);
      }
    }
  });

  it("round ends on the last truck or the bell", () => {
    expect(roundOver(4, 4, 1000)).toBeNull();
    expect(roundOver(1, 4, 1000)).toBe("ko");
    expect(roundOver(0, 2, 1000)).toBe("ko");
    expect(roundOver(3, 4, ROUND_MS)).toBe("time");
    expect(formatClock(ROUND_MS)).toBe("2:30");
    expect(formatClock(59_001)).toBe("1:00");
    expect(formatClock(-5)).toBe("0:00");
  });
});

describe("netcode", () => {
  const state = (o: Partial<NetTruck> = {}): NetTruck => ({ ...emptyNetTruck(), ...o });

  it("packs a truck into small integers and back", () => {
    const s = state({ x: 3.14159, y: 0.63, z: -12.5, qx: 0, qy: 0.7071, qz: 0, qw: 0.7071, vx: 12.34, vy: -1.2, vz: 0.05, hp: 55.55, armor: 12.3, weapon: 0.77, flags: 5, loadout: 211, dmg: 123.4 });
    const packed = packTruck(2, s);
    expect(packed).toHaveLength(PACKED_LENGTH);
    expect(packed.every((v) => Number.isInteger(v))).toBe(true);
    expect(JSON.stringify({ t: 123456, k: [packed] }).length).toBeLessThan(110);
    const u = unpackTruck(packed)!;
    expect(u.seat).toBe(2);
    expect(u.state.x).toBeCloseTo(3.14, 2);
    expect(u.state.z).toBeCloseTo(-12.5, 2);
    expect(u.state.qy).toBeCloseTo(0.7071, 2);
    expect(u.state.vx).toBeCloseTo(12.3, 1);
    expect(u.state.hp).toBeCloseTo(55.6, 1);
    expect(u.state.weapon).toBeCloseTo(0.77, 2);
    expect(u.state.flags).toBe(5);
    expect(u.state.loadout).toBe(211);
  });

  it("normalizes q and -q to the same hemisphere", () => {
    const u = unpackTruck(packTruck(0, state({ qx: 0, qy: -0.6, qz: 0, qw: -0.8 })))!;
    expect(u.state.qw).toBeGreaterThan(0);
    expect(u.state.qy).toBeCloseTo(0.6, 2);
  });

  it("rejects malformed packets", () => {
    expect(unpackTruck([1, 2, 3])).toBeNull();
    expect(unpackTruck("x")).toBeNull();
    expect(unpackTruck(Array(PACKED_LENGTH).fill(Number.NaN))).toBeNull();
  });

  it("hits round-trip, and a peer can't claim absurd damage", () => {
    const msg = encodeHit({ attacker: 1, victim: 3, damage: 22, impulse: [1.5, 11.5, -2.25], point: [3.2, 0.4, -7.1], kind: "hammer" });
    expect(decodeHit(JSON.parse(JSON.stringify(msg)))).toEqual({ attacker: 1, victim: 3, damage: 22, impulse: [1.5, 11.5, -2.2], point: [3.2, 0.4, -7.1], kind: "hammer" });
    expect(decodeHit({ ...msg, d: 99999 })?.damage).toBe(40);
    expect(decodeHit({ ...msg, i: [1, 2] })).toBeNull();
    expect(decodeHit(null)).toBeNull();
  });

  it("keeps snapshots ordered, deduped and trimmed", () => {
    const buf: Snapshot[] = [];
    for (const t of [100, 300, 200, 200, 400]) pushSnapshot(buf, { t, s: state({ x: t }) }, 3);
    expect(buf.map((b) => b.t)).toEqual([200, 300, 400]);
  });

  it("interpolates between snapshots and extrapolates a little past the last", () => {
    const buf: Snapshot[] = [
      { t: 0, s: state({ x: 0, vx: 10, hp: 90 }) },
      { t: 100, s: state({ x: 1, vx: 10, hp: 80 }) },
    ];
    const out = emptyNetTruck();
    expect(sampleSnapshots(buf, 50, out)).toBe(true);
    expect(out.x).toBeCloseTo(0.5);
    expect(out.hp).toBe(80);
    sampleSnapshots(buf, 150, out);
    expect(out.x).toBeCloseTo(1.5);
    sampleSnapshots(buf, 5_000, out);
    expect(out.x).toBeCloseTo(1 + (10 * EXTRAPOLATE_MS) / 1000);
    sampleSnapshots(buf, -50, out);
    expect(out.x).toBe(0);
    expect(sampleSnapshots([], 0, out)).toBe(false);
  });

  it("interpolates rotation along the short arc", () => {
    const a = state({ qx: 0, qy: 0, qz: 0, qw: 1 });
    const b = state({ qx: 0, qy: -0.7071, qz: 0, qw: -0.7071 }); // == +90° about y, written as −q
    const out = emptyNetTruck();
    sampleSnapshots([{ t: 0, s: a }, { t: 100, s: b }], 50, out);
    expect(Math.abs(out.qy)).toBeCloseTo(0.3827, 2);
    expect(Math.hypot(out.qx, out.qy, out.qz, out.qw)).toBeCloseTo(1);
  });

  it("tracks the clock offset from the least-delayed packet", () => {
    let off = updateClockOffset(null, 520);
    off = updateClockOffset(off, 500);
    expect(off).toBe(500);
    off = updateClockOffset(off, 900);
    expect(off).toBeGreaterThan(500);
    expect(off).toBeLessThan(520);
  });

  it("the send budget stays under the SDK's 30 msg/s and keeps a reserve", () => {
    const b = new SendBudget(28, 0);
    let sent = 0;
    for (let ms = 0; ms < 1000; ms += 5) if (b.take(ms)) sent++;
    expect(sent).toBeLessThanOrEqual(30 + 28);
    const r = new SendBudget(10, 0);
    for (let i = 0; i < 10; i++) r.take(0, 0);
    expect(r.take(0, 4)).toBe(false);
  });
});

describe("bot brain", () => {
  const sense = (o: Partial<BotSense> = {}): BotSense => ({
    t: 1,
    x: -10,
    z: -10,
    yaw: 0,
    speed: 6,
    weapon: "hammer",
    ready: true,
    boost: 1,
    flipped: false,
    skill: 1,
    targets: [],
    dangers: [],
    ...o,
  });

  it("turns toward its target (+steer is right, which lowers the yaw)", () => {
    // Facing +Z, target off to +X (the truck's left).
    const left = botDecide(sense({ targets: [{ id: "a", x: -4, z: -4, vx: 0, vz: 0, alive: true }] }), newBotMemory(), seq(0.5));
    expect(left.steer).toBeLessThan(0);
    // Target to −X (its right).
    const right = botDecide(sense({ targets: [{ id: "a", x: -16, z: -4, vx: 0, vz: 0, alive: true }] }), newBotMemory(), seq(0.5));
    expect(right.steer).toBeGreaterThan(0);
    expect(right.throttle).toBeGreaterThan(0);
  });

  it("swings when the target is in range and in front", () => {
    const c = botDecide(sense({ targets: [{ id: "a", x: -10, z: -7.5, vx: 0, vz: 0, alive: true }] }), newBotMemory(), seq(0.1));
    expect(c.fire).toBe(true);
    const far = botDecide(sense({ targets: [{ id: "a", x: -10, z: 5, vx: 0, vz: 0, alive: true }] }), newBotMemory(), seq(0.1));
    expect(far.fire).toBe(false);
    const notReady = botDecide(sense({ ready: false, targets: [{ id: "a", x: -10, z: -7.5, vx: 0, vz: 0, alive: true }] }), newBotMemory(), seq(0.1));
    expect(notReady.fire).toBe(false);
  });

  it("ignores dead trucks and picks the nearest live one", () => {
    const mem = newBotMemory();
    botDecide(
      sense({
        targets: [
          { id: "dead", x: -9, z: -9, vx: 0, vz: 0, alive: false },
          { id: "far", x: 10, z: 10, vx: 0, vz: 0, alive: true },
          { id: "near", x: -2, z: -10, vx: 0, vz: 0, alive: true },
        ],
      }),
      mem,
      seq(0.5),
    );
    expect(mem.targetId).toBe("near");
  });

  it("steers away from the pit it's heading into", () => {
    // Facing the pit from its −Z side with a target straight across it.
    const c = botDecide(sense({ x: 0.5, z: -7, yaw: 0, speed: 10, targets: [{ id: "a", x: 0.5, z: 9, vx: 0, vz: 0, alive: true }] }), newBotMemory(), seq(0.5));
    expect(Math.abs(c.steer)).toBeGreaterThan(0.3);
  });

  it("backs out when stuck, and self-rights when flipped", () => {
    const mem = newBotMemory();
    const target = [{ id: "a", x: -10, z: 5, vx: 0, vz: 0, alive: true }];
    let c = botDecide(sense({ t: 1, speed: 0, targets: target }), mem, seq(0.5));
    for (let t = 1.2; t < 3; t += 0.2) c = botDecide(sense({ t, speed: 0, targets: target }), mem, seq(0.5));
    expect(c.throttle).toBeLessThan(0);
    const flipped = botDecide(sense({ flipped: true }), newBotMemory(), seq(0.5));
    expect(flipped.selfRight).toBe(true);
    expect(flipped.throttle).toBe(0);
  });

  it("circles with a flamethrower instead of ramming", () => {
    const c = botDecide(sense({ weapon: "flamer", targets: [{ id: "a", x: -10, z: -4, vx: 0, vz: 0, alive: true }] }), newBotMemory(), seq(0.1));
    expect(c.fire).toBe(false); // 6 m away: outside the burn range, lining up an orbit
    expect(Math.abs(c.steer)).toBeGreaterThan(0.1);
  });
});

describe("constants", () => {
  it("armor kits are ordered", () => {
    expect(ARMORS.tank.armor).toBeGreaterThan(ARMORS.brawler.armor);
    expect(ARMORS.brawler.armor).toBeGreaterThan(ARMORS.scout.armor);
  });
});

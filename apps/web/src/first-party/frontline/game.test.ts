import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Game, idleIntent, type GameTransport, type Intent, type SeatInfo } from "./game";
import { MAPS } from "./map";
import type { Packet } from "./net";
import { parseDoc, type MatchDoc } from "./rules";

/** A deterministic stand-in for `xapps.random.fork(label)`. */
function seeded(label: string) {
  let h = 2166136261;
  for (const c of label) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  let s = h >>> 0 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

let clock = 1_000_000;

class SharedState {
  state: unknown = null;
  version = 0;
  games: Game[] = [];
  writes = 0;
  update(fn: (raw: unknown) => MatchDoc | undefined): Promise<unknown> {
    // Compare-and-set with the version the writer saw; retries like the SDK.
    for (let i = 0; i < 6; i++) {
      const base = this.version;
      const next = fn(structuredClone(this.state));
      if (next === undefined) return Promise.resolve(this.state);
      if (base === this.version) {
        this.state = structuredClone(next);
        this.version++;
        this.writes++;
        const s = this.state;
        queueMicrotask(() => this.games.forEach((g) => g.onDoc(s)));
        return Promise.resolve(this.state);
      }
    }
    return Promise.reject(new Error("conflict"));
  }
}

interface Wire {
  to: Game;
  from: string;
  payload: Packet;
  at: number;
}

function table(seats: SeatInfo[], opts: { teams?: number; lim?: number; dur?: number; drop?: (w: Wire) => boolean } = {}) {
  const shared = new SharedState();
  const inFlight: Wire[] = [];
  const games = new Map<string, Game>();
  const humans = seats.filter((s) => !s.isBot);
  for (const me of humans) {
    const transport: GameTransport = {
      canWrite: true,
      send: (payload) => {
        for (const other of humans) {
          if (other.id === me.id) continue;
          inFlight.push({ to: games.get(other.id)!, from: me.id, payload: structuredClone(payload), at: clock + 40 });
        }
      },
      update: (fn) => shared.update(fn),
    };
    const g = new Game({
      map: MAPS.saltyard,
      seats,
      meId: me.id,
      spectator: false,
      simAll: false,
      teams: opts.teams ?? 0,
      practice: false,
      loadout: { primary: "ar", perk: "quick_hands" },
      seedRandom: seeded,
      transport,
      initialState: shared.state,
      docOverrides: { lim: opts.lim, dur: opts.dur },
    });
    games.set(me.id, g);
    shared.games.push(g);
  }
  const intents = new Map<string, Intent>();
  const gone = new Set<string>();
  const step = async (ms: number) => {
    for (let t = 0; t < ms; t += 16) {
      clock += 16;
      for (let i = inFlight.length - 1; i >= 0; i--) {
        const w = inFlight[i]!;
        if (w.at > clock) continue;
        inFlight.splice(i, 1);
        if (opts.drop?.(w) || gone.has(w.from)) continue;
        w.to.onPacket(w.payload, w.from, clock);
      }
      for (const [id, g] of games) if (!gone.has(id)) g.update(0.016, clock, intents.get(id) ?? idleIntent(), null);
      await Promise.resolve();
    }
  };
  return { games, shared, step, intents, gone };
}

const seat = (id: string, s: number, isBot = false): SeatInfo => ({ id, seat: s, name: id, handle: id, isBot, avatarUrl: null });

/** Aimed fire (hip fire at 12 m sprays past a body too often for a test). */
const AIM_FIRE: Intent = { ...idleIntent(), ads: true, fire: true };

/** Puts `shooter` 12 m from `target` in the open north-east yard, facing it. */
function faceOff(shooter: Game, target: Game) {
  const a = shooter.me!;
  const b = target.me!;
  Object.assign(a.body, { x: 20, y: 0, z: -27, vx: 0, vy: 0, vz: 0 });
  Object.assign(b.body, { x: 20, y: 0, z: -15, vx: 0, vy: 0, vz: 0 });
  a.yaw = Math.PI;
  a.pitch = -0.03;
  b.yaw = 0;
  a.swapUntil = b.swapUntil = 0;
  a.nextFireAt = b.nextFireAt = 0;
  // Aimed in already.
  a.ads = 1;
}

beforeEach(() => {
  clock = 1_000_000;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  vi.spyOn(Date, "now").mockImplementation(() => 1_700_000_000_000 + clock);
});
afterEach(() => vi.restoreAllMocks());

describe("two clients over the room", () => {
  it("sync movement, register a kill once on both sides, and agree on the ledger", async () => {
    const { games, shared, step, intents } = table([seat("alice", 0), seat("bob", 1)]);
    const alice = games.get("alice")!;
    const bob = games.get("bob")!;
    await step(200);
    expect(parseDoc(shared.state)).not.toBeNull();
    faceOff(alice, bob);
    await step(600);
    // Each sees the other where they are (interpolated ~100 ms behind).
    const bobOnAlice = alice.bySeat.get(1)!;
    expect(bobOnAlice.alive).toBe(true);
    expect(Math.hypot(bobOnAlice.body.x - 20, bobOnAlice.body.z + 15)).toBeLessThan(0.05);
    // Alice holds the trigger.
    intents.set("alice", AIM_FIRE);
    await step(1200);
    intents.set("alice", idleIntent());
    await step(400);
    const key = "1:0";
    expect(alice.kills.has(key)).toBe(true);
    expect(bob.kills.has(key)).toBe(true);
    expect(bob.me!.alive).toBe(false);
    expect(bob.me!.life).toBe(1);
    const doc = parseDoc(shared.state)!;
    expect(doc.k.filter((k) => k[0] === 1 && k[1] === 0)).toHaveLength(1);
    expect(alice.liveTally().kills.get(0)).toBe(1);
    expect(bob.liveTally().kills.get(0)).toBe(1);
    expect(alice.log.kills).toBe(1);
    expect(alice.log.firstBlood).toBe(true);
    expect(bob.log.deaths).toBe(1);
    // Bob respawns after 3 s somewhere Alice can't see, and Alice sees him alive again.
    await step(3400);
    expect(bob.me!.alive).toBe(true);
    await step(400);
    expect(alice.bySeat.get(1)!.alive).toBe(true);
  });

  it("survives a lossy room: the kill still lands exactly once", async () => {
    let n = 0;
    const { games, shared, step, intents } = table([seat("alice", 0), seat("bob", 1)], { drop: () => n++ % 3 === 0 });
    const alice = games.get("alice")!;
    const bob = games.get("bob")!;
    await step(200);
    faceOff(alice, bob);
    await step(600);
    intents.set("alice", AIM_FIRE);
    await step(1500);
    intents.set("alice", idleIntent());
    await step(1500);
    const doc = parseDoc(shared.state)!;
    expect(doc.k).toHaveLength(1);
    expect(alice.liveTally().kills.get(0)).toBe(1);
    expect(bob.liveTally().deaths.get(1)).toBe(1);
  });

  it("rejects hits through a wall (victim-side line of sight)", async () => {
    const { games, step, intents } = table([seat("alice", 0), seat("bob", 1)]);
    const alice = games.get("alice")!;
    const bob = games.get("bob")!;
    await step(200);
    faceOff(alice, bob);
    await step(600);
    // Bob steps behind the north trailer; Alice fires at where she saw him a moment ago.
    Object.assign(bob.me!.body, { x: 1, z: -18 });
    const hp = bob.me!.hp;
    // Fake a claim: Alice's client "hit" Bob through the trailer from the far side.
    Object.assign(alice.me!.body, { x: 1, z: -26 });
    alice.me!.yaw = Math.PI;
    alice.bySeat.get(1)!.buf.snaps.length = 0;
    await step(300);
    intents.set("alice", AIM_FIRE);
    await step(500);
    intents.set("alice", idleIntent());
    await step(300);
    expect(bob.me!.hp).toBe(hp);
  });

  it("ends the match once at the kill limit and settles from the shared ledger", async () => {
    const { games, shared, step, intents } = table([seat("alice", 0), seat("bob", 1)], { lim: 1 });
    const alice = games.get("alice")!;
    const bob = games.get("bob")!;
    const finals: string[] = [];
    alice.onFinal((rows) => finals.push(`alice:${rows.map((r) => `${r.seat}=${r.kills}`).join(",")}`));
    bob.onFinal((rows) => finals.push(`bob:${rows.map((r) => `${r.seat}=${r.kills}`).join(",")}`));
    await step(200);
    faceOff(alice, bob);
    await step(600);
    intents.set("alice", AIM_FIRE);
    await step(1200);
    intents.set("alice", idleIntent());
    await step(3200);
    const doc = parseDoc(shared.state)!;
    expect(doc.end?.r).toBe("limit");
    expect(alice.phase).toBe("over");
    expect(bob.phase).toBe("over");
    expect(finals.sort()).toEqual(["alice:0=1,1=0", "bob:0=1,1=0"]);
    expect(alice.log.won).toBe(true);
    expect(bob.log.won).toBe(false);
    // Nobody can add kills after the end.
    const writes = shared.writes;
    await step(500);
    expect(shared.writes).toBe(writes);
  });

  it("ends on the clock exactly once even when both clients race to write it", async () => {
    const { games, shared, step } = table([seat("alice", 0), seat("bob", 1)], { dur: 2000 });
    await step(2600);
    const doc = parseDoc(shared.state)!;
    expect(doc.end?.r).toBe("time");
    for (const g of games.values()) expect(g.phase).toBe("over");
    expect(shared.writes).toBe(2); // the init and one end
  });

  it("the lowest-seated human drives the bots; the other client sees them over the room", async () => {
    const { games, step, gone } = table([seat("alice", 0), seat("bob", 1), seat("bot", 2, true), seat("bot2", 3, true)]);
    const alice = games.get("alice")!;
    const bob = games.get("bob")!;
    expect(alice.driver).toBe("alice");
    expect(alice.bySeat.get(2)!.local).toBe(true);
    expect(bob.bySeat.get(2)!.local).toBe(false);
    await step(1500);
    const botA = alice.bySeat.get(2)!;
    const botB = bob.bySeat.get(2)!;
    expect(botB.alive).toBe(true);
    expect(Math.hypot(botA.body.x - botB.body.x, botA.body.z - botB.body.z)).toBeLessThan(1.5);
    // Alice leaves: presence drops her at once, but Bob waits until she's been silent a while.
    gone.add("alice");
    bob.setOnline(["bob"]);
    expect(bob.driver).toBe("alice");
    await step(4500);
    bob.setOnline(["bob"]);
    await step(100);
    expect(bob.driver).toBe("bob");
    expect(bob.bySeat.get(2)!.local).toBe(true);
    expect(bob.submitters().map((s) => s.id).sort()).toEqual(["bob", "bot", "bot2"]);
  });

  it("team play: no friendly fire", async () => {
    const { games, step, intents } = table([seat("alice", 0), seat("bob", 1), seat("cara", 2), seat("dan", 3)], { teams: 2 });
    const alice = games.get("alice")!;
    const cara = games.get("cara")!;
    await step(200);
    faceOff(alice, cara);
    await step(600);
    intents.set("alice", AIM_FIRE);
    await step(1200);
    expect(cara.me!.hp).toBe(100);
    expect(cara.me!.alive).toBe(true);
  });
});

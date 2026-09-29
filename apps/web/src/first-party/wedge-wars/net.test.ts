import type { XAppsClient } from "@xapps/sdk";
import { describe, expect, it } from "vitest";
import { DEFAULT_LOADOUT, HP_MAX, type Loadout } from "./logic";
import { NetLink } from "./net";
import { World, type SeatInfo } from "./world";

const seats: SeatInfo[] = [
  { id: "alice", seat: 0, name: "@alice", handle: "alice", isBot: false, avatarUrl: null },
  { id: "bob", seat: 1, name: "@bob", handle: "bob", isBot: false, avatarUrl: null },
  { id: "bot", seat: 2, name: "Bot", handle: "bot", isBot: true, avatarUrl: null },
];

type Handler = (type: string, payload: unknown, from: string) => void;

/** Two clients (alice drives the bot) joined by an in-memory room. */
function table() {
  const handlers = new Map<string, Handler>();
  const sent: { from: string; type: string }[] = [];
  const client = (me: string) => {
    const xapps = {
      room: {
        send: (type: string, payload: unknown) => {
          sent.push({ from: me, type });
          const copy = JSON.parse(JSON.stringify(payload));
          for (const [id, h] of handlers) if (id !== me) h(type, copy, me);
          return Promise.resolve(null);
        },
      },
    } as unknown as XAppsClient;
    const loadouts = new Map<string, Loadout>([
      ["alice", { weapon: "hammer", armor: "tank", paint: 1 }],
      ["bob", { ...DEFAULT_LOADOUT }],
      ["bot", { weapon: "flamer", armor: "scout", paint: 2 }],
    ]);
    const local = new Set(me === "alice" ? ["alice", "bot"] : [me]);
    const world = new World({ seats, meId: me, spectator: false, sim: false, reduceMotion: true, localIds: local, loadouts: me === "alice" ? loadouts : new Map([[me, loadouts.get(me)!]]), skills: new Map() });
    const net = new NetLink(xapps, world);
    world.hooks = {
      sendHit: (h) => net.hit(h, 1000),
      sendKo: (v, a, c, t) => net.ko(v, a, c, t, 1000),
    };
    handlers.set(me, (type, payload, from) => {
      if (type === "s") net.onState(payload, from, 1000);
      if (type === "h") net.onHit(payload, from, 1000);
      if (type === "k") net.onKo(payload, from);
      if (type === "f") net.onFin(payload, from, 1000);
    });
    world.start(0);
    return { world, net };
  };
  return { alice: client("alice"), bob: client("bob"), sent, handlers };
}

describe("netcode between two clients", () => {
  it("state packets replicate position, health and the loadout", () => {
    const { alice, bob } = table();
    const a = alice.world.byId.get("alice")!;
    a.pos.set(3, 0.63, -4);
    a.hp = 77;
    alice.net.tick(500);
    const seen = bob.world.byId.get("alice")!;
    expect(seen.hasNet).toBe(true);
    expect(seen.net.x).toBeCloseTo(3);
    expect(seen.hp).toBeCloseTo(77);
    expect(seen.loadout).toEqual({ weapon: "hammer", armor: "tank", paint: 1 });
    expect(seen.armorMax).toBe(70);
    // The bot rides along in alice's packet.
    expect(bob.world.byId.get("bot")!.hasNet).toBe(true);
    // Only one message for both trucks.
    alice.net.tick(510);
    expect(bob.world.byId.get("alice")!.snaps).toHaveLength(1);
  });

  it("the attacker reports a hit; only the victim's owner applies it", () => {
    const { alice, bob } = table();
    const a = alice.world.byId.get("alice")!;
    const bInAlice = alice.world.byId.get("bob")!;
    alice.world.dealHit(a, bInAlice, 20, [0, 5, 0], [0, 1, 0], "hammer", 1000);
    // Alice doesn't own bob: his health there only changes via his packets.
    expect(bInAlice.hp).toBe(HP_MAX);
    expect(a.dmgDealt).toBe(20);
    expect(a.hammerHits).toBe(1);
    const b = bob.world.byId.get("bob")!;
    // Default brawler kit: 40 armor soaks 60%.
    expect(b.armor).toBeCloseTo(40 - 12);
    expect(b.hp).toBeCloseTo(HP_MAX - 8);
    expect(b.lastHitBy).toBe("alice");
  });

  it("a KO is announced by the owner, with credit", () => {
    const { alice, bob } = table();
    const b = bob.world.byId.get("bob")!;
    b.hp = 3;
    b.armor = 0;
    bob.world.applyHit("alice", b, 10, [0, 0, 0], [0, 0, 0], "hammer", 1000);
    expect(b.alive).toBe(false);
    const seen = alice.world.byId.get("bob")!;
    expect(seen.alive).toBe(false);
    expect(seen.koBy).toBe("alice");
    expect(alice.world.byId.get("alice")!.kos).toBe(1);
    expect(alice.world.byId.get("alice")!.firstKo).toBe(true);
    expect(alice.world.feed[0]).toMatchObject({ victim: "bob", by: "alice", cause: "wreck" });
  });

  it("rejects messages spoofed for someone else's truck", () => {
    const { alice, handlers } = table();
    const deliver = handlers.get("alice")!;
    // "mallory" isn't seated; bob can't speak for alice.
    deliver("k", { v: 1, a: 0, c: 0, t: 5 }, "mallory");
    deliver("k", { v: 0, a: 1, c: 0, t: 5 }, "bob");
    expect(alice.world.byId.get("bob")!.alive).toBe(true);
    expect(alice.world.byId.get("alice")!.alive).toBe(true);
    // A hit claiming alice attacked her own bot, sent by bob, is ignored.
    deliver("h", { a: 0, v: 2, d: 300, i: [0, 0, 0], p: [0, 0, 0], w: 3 }, "bob");
    expect(alice.world.byId.get("bot")!.hp).toBe(HP_MAX);
  });

  it("the first client to call time ends the round everywhere", () => {
    const { alice, bob } = table();
    const b = bob.world.byId.get("bob")!;
    b.hp = 64;
    bob.world.end("time", 1000);
    bob.net.fin("time", 1000);
    expect(alice.world.phase).toBe("outro");
    expect(alice.world.endReason).toBe("time");
    expect(alice.world.byId.get("bob")!.hp).toBeCloseTo(64);
    // Alice answered with her own fin (her + the bot).
    expect(bob.world.phase).toBe("outro");
    const rows = alice.world.finalize();
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(rows[0]!.score).toBeGreaterThan(rows[1]!.score);
  });

  it("wrecks keep their KO when a late packet says they're dead", () => {
    const { alice, bob } = table();
    const a = alice.world.byId.get("alice")!;
    a.alive = false;
    a.koAt = 900;
    alice.net.tick(2000);
    expect(bob.world.byId.get("alice")!.alive).toBe(false);
  });
});

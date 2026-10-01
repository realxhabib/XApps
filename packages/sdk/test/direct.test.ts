import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connect, resetConnection } from "../src/client";
import { DIRECT_EVENT, createDirectMesh, type DirectClient, type DirectMesh, type DirectOptions } from "../src/direct";
import type { Json } from "../src/protocol";

/* -------------------------------------------------------------------- */
/* Fakes: a WebRTC stack that links peer connections in memory, and a   */
/* room that broadcasts to everyone else (like the XApps room).         */
/* -------------------------------------------------------------------- */

const network = { reachable: true };

class FakeChannel {
  readyState: RTCDataChannelState = "connecting";
  bufferedAmount = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  remote: FakeChannel | null = null;
  readonly sent: string[] = [];
  constructor(
    readonly label: string,
    readonly init?: RTCDataChannelInit,
  ) {}
  send(data: string) {
    if (this.readyState !== "open") throw new Error("InvalidStateError");
    this.sent.push(data);
    const r = this.remote;
    if (r) queueMicrotask(() => r.readyState === "open" && r.onmessage?.({ data }));
  }
  open() {
    this.readyState = "open";
    this.onopen?.();
  }
  close() {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    this.onclose?.();
    const r = this.remote;
    if (r) queueMicrotask(() => r.close());
  }
}

let pcSeq = 0;
class FakePC {
  static made: FakePC[] = [];
  readonly id = ++pcSeq;
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  signalingState: RTCSignalingState = "stable";
  iceConnectionState: RTCIceConnectionState = "new";
  onicecandidate: ((e: { candidate: { toJSON(): RTCIceCandidateInit } | null }) => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((e: { channel: FakeChannel }) => void) | null = null;
  readonly channels: FakeChannel[] = [];
  readonly added: RTCIceCandidateInit[] = [];
  closed = false;
  constructor(readonly config: RTCConfiguration) {
    FakePC.made.push(this);
  }
  createDataChannel(label: string, init?: RTCDataChannelInit) {
    const ch = new FakeChannel(label, init);
    this.channels.push(ch);
    return ch;
  }
  async createOffer() {
    return { type: "offer" as const, sdp: `offer:${this.id}` };
  }
  async createAnswer() {
    return { type: "answer" as const, sdp: `answer:${this.id}` };
  }
  async setLocalDescription(d: RTCSessionDescriptionInit) {
    this.localDescription = d;
    this.signalingState = d.type === "offer" ? "have-local-offer" : "stable";
    queueMicrotask(() => {
      if (this.closed) return;
      this.onicecandidate?.({ candidate: { toJSON: () => ({ candidate: `cand:${this.id}`, sdpMid: "0" }) } });
      this.onicecandidate?.({ candidate: null });
    });
  }
  async setRemoteDescription(d: RTCSessionDescriptionInit) {
    this.remoteDescription = d;
    this.signalingState = d.type === "offer" ? "have-remote-offer" : "stable";
    if (d.type === "answer") {
      const other = FakePC.made.find((p) => p.id === Number(d.sdp!.split(":")[1]));
      queueMicrotask(() => other && link(this, other));
    }
  }
  async addIceCandidate(c: RTCIceCandidateInit) {
    this.added.push(c);
  }
  close() {
    this.closed = true;
    this.iceConnectionState = "closed";
    this.signalingState = "closed";
    for (const ch of this.channels) ch.close();
  }
  setIce(state: RTCIceConnectionState) {
    this.iceConnectionState = state;
    this.oniceconnectionstatechange?.();
  }
}

function link(offerer: FakePC, answerer: FakePC) {
  if (offerer.closed || answerer.closed) return;
  if (!network.reachable) {
    offerer.setIce("checking");
    answerer.setIce("checking");
    return;
  }
  offerer.setIce("connected");
  answerer.setIce("connected");
  for (const ch of offerer.channels) {
    const remote = new FakeChannel(ch.label, ch.init);
    remote.remote = ch;
    ch.remote = remote;
    answerer.channels.push(remote);
    answerer.ondatachannel?.({ channel: remote });
    remote.open();
    ch.open();
  }
}

const Rtc = FakePC as unknown as new (config: RTCConfiguration) => RTCPeerConnection;

interface Sent {
  from: string;
  type: string;
  payload: Record<string, unknown>;
}

function createHub(players: { id: string; isBot: boolean }[]) {
  const entries: { id: string; handlers: Set<(p: Json, from: string) => void>; presence: Set<(ids: string[]) => void> }[] = [];
  let online: string[] = [];
  const hub = {
    sent: [] as Sent[],
    /** Return true to lose a room message. */
    drop: null as null | ((m: Sent) => boolean),
    client(id: string, opts: { spectator?: boolean; purpose?: string } = {}): DirectClient {
      const entry = { id, handlers: new Set<(p: Json, from: string) => void>(), presence: new Set<(ids: string[]) => void>() };
      entries.push(entry);
      return {
        purpose: opts.purpose ?? "match",
        isSpectator: !!opts.spectator,
        me: { id },
        players,
        room: {
          send: (type, payload) => {
            if (opts.spectator) return Promise.reject(new Error("forbidden"));
            const copy = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
            const m = { from: id, type, payload: copy };
            hub.sent.push(m);
            if (hub.drop?.(m)) return Promise.resolve(null);
            for (const e of entries) {
              if (e.id === id) continue;
              queueMicrotask(() => e.handlers.forEach((h) => h(copy as Json, id)));
            }
            return Promise.resolve(null);
          },
          on: (type, handler) => {
            if (type !== DIRECT_EVENT) return () => {};
            entry.handlers.add(handler);
            return () => entry.handlers.delete(handler);
          },
          onPresence: (handler) => {
            entry.presence.add(handler);
            return () => entry.presence.delete(handler);
          },
          online: () => online.slice(),
        },
      };
    },
    setOnline(ids: string[]) {
      online = ids.slice();
      for (const e of entries) e.presence.forEach((h) => h(ids.slice()));
    },
    kinds(from?: string) {
      return hub.sent.filter((m) => !from || m.from === from).map((m) => m.payload.k);
    },
  };
  return hub;
}

async function settle(ms = 400) {
  for (let t = 0; t < ms; t += 50) await vi.advanceTimersByTimeAsync(50);
}

const PLAYERS = [
  { id: "a", isBot: false },
  { id: "b", isBot: false },
  { id: "bot", isBot: true },
];

function received(mesh: DirectMesh) {
  const got: { data: Json; from: string; via: string }[] = [];
  mesh.onMessage((data, from, via) => got.push({ data, from, via }));
  return got;
}

beforeEach(() => {
  vi.useFakeTimers();
  network.reachable = true;
  FakePC.made = [];
});

afterEach(() => {
  vi.useRealTimers();
  resetConnection();
});

function pair(options: DirectOptions = {}) {
  const hub = createHub(PLAYERS);
  hub.setOnline(["a", "b", "bot"]);
  const a = createDirectMesh(hub.client("a"), { rtc: Rtc, ...options });
  const b = createDirectMesh(hub.client("b"), { rtc: Rtc, ...options });
  return { hub, a, b };
}

describe("direct mesh: signaling", () => {
  it("the lower id offers; offer, answer and ICE go through the room addressed to the peer", async () => {
    const { hub, a, b } = pair();
    expect(a.status("b")).toBe("connecting");
    await settle();
    expect(a.status("b")).toBe("direct");
    expect(b.status("a")).toBe("direct");
    expect(a.peers()).toEqual([{ id: "b", status: "direct", rtt: expect.any(Number) }]);

    // Only "a" offers (no glare), "b" answers; bots get nothing.
    expect(hub.kinds("a")).toContain("offer");
    expect(hub.kinds("b")).not.toContain("offer");
    expect(hub.kinds("b")).toContain("answer");
    // Started together: the offer beat b's hello, so no hello and no second offer.
    expect(hub.kinds("a").filter((k) => k === "offer")).toHaveLength(1);
    expect(hub.kinds("b")).not.toContain("hello");
    expect(hub.sent.every((m) => m.type === DIRECT_EVENT)).toBe(true);
    expect(hub.sent.every((m) => m.payload.to === (m.from === "a" ? "b" : "a"))).toBe(true);
    // Trickled candidates reached the other side.
    const [pcA, pcB] = FakePC.made.filter((p) => !p.closed);
    expect(pcA!.added.length + pcB!.added.length).toBeGreaterThan(0);
    // A handful of messages, then nothing while the direct path is up.
    expect(hub.sent.length).toBeLessThanOrEqual(6);
    const before = hub.sent.length;
    for (let i = 0; i < 30; i++) a.send({ i });
    await settle(4000);
    expect(hub.sent.length).toBe(before);
    expect(FakePC.made[0]!.config.iceServers).toEqual([{ urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }]);
  });

  it("uses the fast (unordered, no retransmits) and reliable channels", async () => {
    const { a, b } = pair();
    const got = received(b);
    await settle();
    a.send({ pos: 1 });
    a.send({ hit: 2 }, { reliable: true });
    await settle(50);
    expect(got).toEqual([
      { data: { pos: 1 }, from: "a", via: "direct" },
      { data: { hit: 2 }, from: "a", via: "direct" },
    ]);
    const offerer = FakePC.made[0]!;
    const fast = offerer.channels.find((c) => c.label === "fast")!;
    expect(fast.init).toEqual({ ordered: false, maxRetransmits: 0 });
    expect(fast.sent.some((s) => s.includes('"pos"'))).toBe(true);
    expect(offerer.channels.find((c) => c.label === "reliable")!.sent.some((s) => s.includes('"hit"'))).toBe(true);
  });

  it("resends an offer the room lost", async () => {
    const hub = createHub(PLAYERS);
    hub.setOnline(["a", "b"]);
    let lost = 0;
    // (b's hello would also get it resent at once: this checks the timer.)
    hub.drop = (m) => m.payload.k === "hello" || (m.payload.k === "offer" && lost++ === 0);
    const a = createDirectMesh(hub.client("a"), { rtc: Rtc });
    createDirectMesh(hub.client("b"), { rtc: Rtc });
    await settle();
    expect(a.status("b")).not.toBe("direct");
    await settle(3000);
    expect(a.status("b")).toBe("direct");
    expect(hub.kinds("a").filter((k) => k === "offer").length).toBeGreaterThanOrEqual(2);
  });

  it("is refused outside matches", () => {
    const hub = createHub(PLAYERS);
    expect(() => createDirectMesh(hub.client("a", { purpose: "app" }))).toThrow(/no match room/);
  });

  it("works on the mock host (no human opponents: nothing to connect)", async () => {
    vi.useRealTimers();
    const client = await connect({ mock: { quiet: true, startDelayMs: 0 } });
    const mesh = client.room.direct({ rtc: Rtc });
    expect(mesh.peers()).toEqual([]);
    expect(mesh.status("bot")).toBe("closed");
    expect(() => mesh.send({ x: 1 })).not.toThrow();
    mesh.close();
  });
});

describe("direct mesh: fallback to the room", () => {
  it("relays while connecting, addressed to the peers that aren't direct", async () => {
    const players = [...PLAYERS, { id: "c", isBot: false }];
    const hub = createHub(players);
    hub.setOnline(["a", "b", "c"]);
    const a = createDirectMesh(hub.client("a"), { rtc: null });
    const b = createDirectMesh(hub.client("b"), { rtc: null });
    const c = createDirectMesh(hub.client("c"), { rtc: null });
    const gotB = received(b);
    const gotC = received(c);
    expect(a.status("b")).toBe("relay");
    a.send({ all: 1 });
    await settle(200);
    a.send({ onlyB: 1 }, { to: "b", reliable: true });
    await settle(50);
    expect(gotB.map((g) => g.data)).toEqual([{ all: 1 }, { onlyB: 1 }]);
    expect(gotC.map((g) => g.data)).toEqual([{ all: 1 }]);
    expect(gotB[0]!.via).toBe("relay");
    const relayed = hub.sent.filter((m) => m.payload.k === "m");
    expect(relayed.map((m) => m.payload.to)).toEqual([["b", "c"], ["b"]]);
  });

  it("throttles fast messages over the room to relayHz; reliable ones always go", async () => {
    const hub = createHub(PLAYERS);
    hub.setOnline(["a", "b"]);
    const a = createDirectMesh(hub.client("a"), { rtc: null, relayHz: 8 });
    const got = received(createDirectMesh(hub.client("b"), { rtc: null }));
    // 15 Hz for one second.
    for (let i = 0; i < 15; i++) {
      a.send({ i });
      await vi.advanceTimersByTimeAsync(1000 / 15);
    }
    expect(got.length).toBeGreaterThanOrEqual(7);
    expect(got.length).toBeLessThanOrEqual(8);
    a.send({ e: 1 }, { reliable: true });
    a.send({ e: 2 }, { reliable: true });
    await settle(50);
    expect(got.slice(-2).map((g) => g.data)).toEqual([{ e: 1 }, { e: 2 }]);
  });

  it("falls back when ICE can't connect (strict NAT, no TURN) and keeps retrying with backoff", async () => {
    network.reachable = false;
    const { hub, a, b } = pair({ connectTimeoutMs: 5000 });
    const got = received(b);
    await settle();
    expect(a.status("b")).toBe("connecting");
    a.send({ early: 1 });
    await settle(5000);
    expect(a.status("b")).toBe("relay");
    await settle(200);
    a.send({ late: 1 });
    await settle(50);
    expect(got.map((g) => [g.data, g.via])).toEqual([
      [{ early: 1 }, "relay"],
      [{ late: 1 }, "relay"],
    ]);
    // The network heals: a later retry goes direct.
    network.reachable = true;
    const offers = hub.kinds("a").filter((k) => k === "offer").length;
    await settle(8000);
    expect(hub.kinds("a").filter((k) => k === "offer").length).toBeGreaterThan(offers);
    expect(a.status("b")).toBe("direct");
    expect(b.status("a")).toBe("direct");
  });

  it("rebuilds after the connection fails, relaying meanwhile", async () => {
    const { hub, a, b } = pair();
    const got = received(b);
    await settle();
    const first = FakePC.made.find((p) => p.localDescription?.type === "offer")!;
    first.setIce("failed");
    expect(a.status("b")).toBe("relay");
    await settle(50);
    expect(b.status("a")).toBe("relay"); // its channels closed too
    a.send({ during: 1 });
    await settle(50);
    expect(got.at(-1)).toEqual({ data: { during: 1 }, from: "a", via: "relay" });
    await settle(3000);
    expect(a.status("b")).toBe("direct");
    expect(b.status("a")).toBe("direct");
    expect(first.closed).toBe(true);
    a.send({ after: 1 });
    await settle(50);
    expect(got.at(-1)).toEqual({ data: { after: 1 }, from: "a", via: "direct" });
    expect(hub.kinds("a").filter((k) => k === "offer").length).toBe(2);
  });

  it("notices channels that closed without an event (the connection was closed locally)", async () => {
    const { a, b } = pair({ pingMs: 1000 });
    const got = received(b);
    await settle();
    const pc = FakePC.made.find((p) => p.localDescription?.type === "offer")!;
    for (const ch of pc.channels) ch.readyState = "closed";
    a.send({ still: 1 });
    await settle(50);
    expect(got.at(-1)).toEqual({ data: { still: 1 }, from: "a", via: "relay" });
    await settle(1000);
    expect(a.status("b")).not.toBe("direct");
    await settle(4000);
    expect(a.status("b")).toBe("direct");
  });

  it("gives a disconnected connection a grace period before rebuilding", async () => {
    const { a } = pair();
    await settle();
    const pc = FakePC.made.find((p) => p.localDescription?.type === "offer")!;
    pc.setIce("disconnected");
    await settle(2000);
    expect(a.status("b")).toBe("direct");
    pc.setIce("connected");
    await settle(4000);
    expect(a.status("b")).toBe("direct");
    pc.setIce("disconnected");
    await settle(4500);
    expect(a.status("b")).not.toBe("direct");
  });

  it("delivers a message that arrives both ways only once", async () => {
    const { hub, a, b } = pair();
    const got = received(b);
    await settle();
    a.send({ once: 1 });
    await settle(50);
    const frame = JSON.parse(FakePC.made[0]!.channels.find((c) => c.label === "fast")!.sent.at(-1)!) as { n: number };
    // The same message relayed through the room (say, sent while switching paths).
    const aClient = hub.client("a");
    await aClient.room.send(DIRECT_EVENT, { k: "m", to: ["b"], s: a.session, n: frame.n, d: { once: 1 } });
    await settle(50);
    expect(got.filter((g) => JSON.stringify(g.data) === '{"once":1}')).toHaveLength(1);
  });

  it("drops fast messages under backpressure instead of queueing or relaying them", async () => {
    const { hub, a, b } = pair();
    const got = received(b);
    await settle();
    const fast = FakePC.made[0]!.channels.find((c) => c.label === "fast")!;
    fast.bufferedAmount = 1 << 20;
    const before = hub.sent.length;
    a.send({ stale: 1 });
    a.send({ important: 1 }, { reliable: true });
    await settle(50);
    expect(got.map((g) => g.data)).toEqual([{ important: 1 }]);
    expect(hub.sent.length).toBe(before);
  });
});

describe("direct mesh: presence and sessions", () => {
  it("ignores room traffic addressed to someone else", async () => {
    const players = [...PLAYERS, { id: "c", isBot: false }];
    const hub = createHub(players);
    hub.setOnline(["a", "b", "c"]);
    createDirectMesh(hub.client("a"), { rtc: Rtc });
    createDirectMesh(hub.client("b"), { rtc: Rtc });
    const c = createDirectMesh(hub.client("c"), { rtc: Rtc });
    const got = received(c);
    await settle();
    // c saw a⇄b's offer/answer/ICE go by but never acted on them: one pc per pair.
    expect(FakePC.made.filter((p) => !p.closed)).toHaveLength(6);
    expect(c.peers().map((p) => p.status)).toEqual(["direct", "direct"]);
    expect(got).toEqual([]);
  });

  it("connects when a player shows up, closes when they leave", async () => {
    const hub = createHub(PLAYERS);
    hub.setOnline(["a"]);
    const a = createDirectMesh(hub.client("a"), { rtc: null });
    expect(a.status("b")).toBe("closed");
    a.send({ nobody: 1 });
    expect(hub.sent).toHaveLength(0);
    hub.setOnline(["a", "b"]);
    expect(a.status("b")).toBe("relay");
    await settle(11_000);
    hub.setOnline(["a"]);
    expect(a.status("b")).toBe("closed");
  });

  it("reconnects at once when the other player reloads (new session)", async () => {
    const hub = createHub(PLAYERS);
    hub.setOnline(["a", "b"]);
    const a = createDirectMesh(hub.client("a"), { rtc: Rtc });
    const b1 = createDirectMesh(hub.client("b"), { rtc: Rtc });
    await settle();
    expect(a.status("b")).toBe("direct");
    b1.close();
    await settle(50);
    expect(a.status("b")).toBe("closed");
    // Closed: nothing goes to b over the room.
    const before = hub.sent.length;
    a.send({ x: 1 });
    expect(hub.sent.length).toBe(before);
    const b2 = createDirectMesh(hub.client("b"), { rtc: Rtc });
    const got = received(b2);
    await settle();
    expect(a.status("b")).toBe("direct");
    expect(b2.status("a")).toBe("direct");
    a.send({ again: 1 });
    await settle(50);
    expect(got).toEqual([{ data: { again: 1 }, from: "a", via: "direct" }]);
  });

  it("answers pings (round trip) and treats a silent peer as lost", async () => {
    const { a, b } = pair({ pingMs: 1000 });
    await settle(2500);
    expect(a.rtt("b")).not.toBeNull();
    // b's side stops reading: channels stay "open" but nothing comes back.
    const answerer = FakePC.made.find((p) => p.localDescription?.type === "answer")!;
    for (const ch of answerer.channels) ch.onmessage = null;
    await settle(8000);
    expect(a.status("b")).not.toBe("direct");
    b.close();
  });

  it("spectators never signal but get relayed copies with `spectators: true`", async () => {
    const hub = createHub(PLAYERS);
    hub.setOnline(["a", "b", "watcher"]);
    const a = createDirectMesh(hub.client("a"), { rtc: Rtc, spectators: true, relayHz: 5 });
    createDirectMesh(hub.client("b"), { rtc: Rtc, spectators: true });
    const w = createDirectMesh(hub.client("watcher", { spectator: true }), { rtc: Rtc });
    const got = received(w);
    await settle();
    expect(hub.kinds("watcher")).toEqual([]);
    expect(w.peers()).toEqual([]);
    a.send({ s: 1 });
    await settle(50);
    expect(got).toEqual([{ data: { s: 1 }, from: "a", via: "relay" }]);
    expect(hub.sent.filter((m) => m.payload.k === "m").map((m) => m.payload.to)).toEqual([["watcher"]]);
  });

  it("close() says goodbye, closes connections and reports every peer closed", async () => {
    const { hub, a, b } = pair();
    await settle();
    const statuses: string[] = [];
    b.onStatus((id, s) => statuses.push(`${id}:${s}`));
    a.close();
    await settle(50);
    expect(hub.kinds("a").at(-1)).toBe("bye");
    expect(FakePC.made.every((p) => p.closed)).toBe(true);
    expect(statuses).toContain("a:closed");
    expect(a.status("b")).toBe("closed");
  });
});

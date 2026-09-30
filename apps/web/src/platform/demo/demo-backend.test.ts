import { fakeLocalStorage, fakeSessionStorage, resetFakeBrowser } from "./fake-browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackendError } from "../backend";
import { XP, placementXp } from "../scoring";
import type { Match, Profile, RegisterAppInput } from "../types";
import { DemoBackend, LOST_WRITE_CHECKS_MS, TURN_TIMEOUT_MS } from "./demo-backend";
import { PRACTICE_BOTS } from "./seed";
import { DB_KEY, load } from "./store";

let backend: DemoBackend;
const people: Record<string, Profile> = {};

async function as(handle: string): Promise<Profile> {
  const profile = people[handle] ?? (await backend.demo.signInAs({ handle }));
  people[handle] = profile;
  await backend.demo.switchTo(profile.id);
  return profile;
}

async function signUp(...handles: string[]): Promise<void> {
  for (const handle of handles) await as(handle);
}

function appInput(slug: string, extra: Partial<RegisterAppInput> = {}): RegisterAppInput {
  return {
    slug,
    name: slug,
    tagline: "t",
    description: "d",
    category: "games",
    icon: "🎲",
    accent: ["#000", "#fff"],
    url: "https://example.com",
    modes: ["live", "async", "practice"],
    scoring: "high",
    howTo: [],
    ...extra,
  };
}

async function expectCode(promise: Promise<unknown>, code: BackendError["code"]): Promise<void> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(BackendError);
  expect((error as BackendError).code).toBe(code);
}

const seat = (match: Match, handle: string) => match.players.find((p) => p.userId === people[handle]!.id);

/** alice registers a 2–4 player app and invites bob, carol and dave to a full live table. */
async function fourPlayerLive(slug = "royale", extra: Partial<RegisterAppInput> = {}): Promise<Match> {
  await signUp("bob", "carol", "dave");
  await as("alice");
  await backend.registerApp(appInput(slug, { players: { min: 2, max: 4 }, ...extra }));
  const match = await backend.createChallenge({ appSlug: slug, mode: "live", opponentHandles: ["bob", "@Carol", "dave"] });
  for (const handle of ["bob", "carol", "dave"]) {
    await as(handle);
    await backend.joinMatch(match.id);
  }
  await as("alice");
  return (await backend.getMatch(match.id))!;
}

beforeEach(() => {
  resetFakeBrowser();
  for (const key of Object.keys(people)) delete people[key];
  // Keep the "a persona challenges the newcomer" nudge out of these tests.
  fakeSessionStorage.setItem("xapps:demo-invited", "1");
  backend = new DemoBackend();
});

afterEach(() => {
  backend.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("demo backend: N-player lobbies", () => {
  it("invites several people and starts a live table once every seat is filled", async () => {
    await signUp("bob", "carol", "dave");
    await as("alice");
    await backend.registerApp(appInput("royale", { players: { min: 2, max: 4 } }));
    const created = await backend.createChallenge({ appSlug: "royale", mode: "live", opponentHandles: ["bob", "carol", "dave"] });
    expect(created.status).toBe("pending");
    expect(created.maxPlayers).toBe(4);
    expect(created.minPlayers).toBe(2);
    expect(created.isOpen).toBe(false);
    expect(created.players.map((p) => [p.seat, p.state])).toEqual([
      [0, "joined"],
      [1, "invited"],
      [2, "invited"],
      [3, "invited"],
    ]);

    await as("bob");
    expect((await backend.joinMatch(created.id)).status).toBe("pending");
    await as("carol");
    await backend.joinMatch(created.id);
    await as("dave");
    const full = await backend.joinMatch(created.id);
    expect(full.status).toBe("active");
    expect(seat(full, "dave")?.seat).toBe(3);
  });

  it("rejects more invites than seats and table sizes outside the app's range", async () => {
    await signUp("bob", "carol");
    await as("alice");
    await expectCode(backend.createChallenge({ appSlug: "quick-draw", mode: "live", opponentHandles: ["bob", "carol"] }), "invalid");
    await backend.registerApp(appInput("royale", { players: { min: 2, max: 4 } }));
    await expectCode(backend.createChallenge({ appSlug: "royale", mode: "live", maxPlayers: 6 }), "invalid");
    await expectCode(backend.createChallenge({ appSlug: "royale", mode: "live", opponentHandles: ["bob", "carol"], maxPlayers: 2 }), "invalid");
  });

  it("lets the creator start an open table early and withdraws unanswered invites", async () => {
    await signUp("bob", "carol", "dave", "erin");
    await as("alice");
    await backend.registerApp(appInput("royale", { players: { min: 2, max: 4 } }));
    const open = await backend.createChallenge({ appSlug: "royale", mode: "live", opponentHandles: ["erin"], maxPlayers: 4 });
    expect(open.status).toBe("open");
    expect(open.isOpen).toBe(true);

    await expectCode(backend.startMatch(open.id), "conflict"); // only alice is seated

    await as("bob");
    const joined = await backend.joinMatch(open.id);
    expect(joined.status).toBe("open");
    expect(seat(joined, "bob")?.seat).toBe(2); // seat 1 is held for erin
    await expectCode(backend.startMatch(open.id), "forbidden");

    await as("alice");
    const started = await backend.startMatch(open.id);
    expect(started.status).toBe("active");
    expect(started.isOpen).toBe(false);
    expect(seat(started, "erin")).toBeUndefined();

    await as("dave");
    await expectCode(backend.joinMatch(open.id), "conflict");
  });

  it("starts async tables as soon as the minimum is seated, and late invitees can still join", async () => {
    await signUp("bob", "carol");
    await as("alice");
    await backend.registerApp(appInput("royale", { players: { min: 2, max: 4 } }));
    const match = await backend.createChallenge({ appSlug: "royale", mode: "async", opponentHandles: ["bob", "carol"] });
    expect(match.maxPlayers).toBe(3);
    await as("bob");
    expect((await backend.joinMatch(match.id)).status).toBe("active");
    await as("carol");
    const all = await backend.joinMatch(match.id);
    expect(all.status).toBe("active");
    expect(seat(all, "carol")?.state).toBe("joined");
  });

  it("declines a table that can no longer reach its minimum, like a v1 1v1", async () => {
    await signUp("bob");
    await as("alice");
    const match = await backend.createChallenge({ appSlug: "quick-draw", mode: "live", opponentHandle: "bob" });
    expect(match.status).toBe("pending");
    await as("bob");
    expect((await backend.declineMatch(match.id)).status).toBe("declined");
  });

  it("starts a live table when the remaining invites resolve after a decline", async () => {
    const match = await (async () => {
      await signUp("bob", "carol", "dave");
      await as("alice");
      await backend.registerApp(appInput("royale", { players: { min: 2, max: 4 } }));
      return backend.createChallenge({ appSlug: "royale", mode: "live", opponentHandles: ["bob", "carol", "dave"] });
    })();
    await as("bob");
    await backend.declineMatch(match.id);
    await as("carol");
    await backend.joinMatch(match.id);
    await as("dave");
    expect((await backend.joinMatch(match.id)).status).toBe("active");
  });

  it("fills quick-match lobbies with people and personas; the first joiner can start early", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await signUp("bob");
    await as("alice");
    await backend.registerApp(appInput("royale", { players: { min: 2, max: 4 } }));
    const lobby = await backend.quickMatch("royale");
    expect(lobby.status).toBe("open");
    expect(lobby.maxPlayers).toBe(4);

    await as("bob");
    const same = await backend.quickMatch("royale");
    expect(same.id).toBe(lobby.id);
    expect(same.players).toHaveLength(2);

    vi.setSystemTime(Date.now() + 6_000);
    await as("alice");
    for (let i = 0; i < 40 && !(await backend.getMatch(lobby.id))!.players.some((p) => p.isBot); i++) backend.tick();
    const withPersona = (await backend.getMatch(lobby.id))!;
    expect(withPersona.players.filter((p) => p.isBot)).toHaveLength(1);

    const started = await backend.startMatch(lobby.id);
    expect(started.status).toBe("active");
    expect(started.players.length).toBeGreaterThanOrEqual(3);
  });
});

describe("demo backend: invites, teams and declines", () => {
  it("invites more people into free seats", async () => {
    await signUp("bob", "carol", "dave", "erin");
    await as("alice");
    await backend.registerApp(appInput("royale", { players: { min: 2, max: 4 } }));
    const open = await backend.createChallenge({ appSlug: "royale", mode: "live" });
    expect(open.maxPlayers).toBe(4);
    const invited = await backend.inviteToMatch(open.id, ["@bob", "carol"]);
    expect(invited.players.map((p) => p.state)).toEqual(["joined", "invited", "invited"]);
    expect(invited.status).toBe("open");
    await expectCode(backend.inviteToMatch(open.id, ["dave", "erin"]), "invalid"); // one seat left
    const full = await backend.inviteToMatch(open.id, ["dave"]);
    expect(full.status).toBe("pending");
    expect(full.isOpen).toBe(false);
    await as("erin");
    await expectCode(backend.joinMatch(open.id), "conflict");
  });

  it("withdraws a declined multiplayer invite and reopens its seat", async () => {
    await signUp("bob", "carol");
    await as("alice");
    await backend.registerApp(appInput("royale", { players: { min: 2, max: 4 } }));
    const match = await backend.createChallenge({ appSlug: "royale", mode: "live", opponentHandles: ["bob", "carol"], maxPlayers: 4 });
    await as("bob");
    const after = await backend.declineMatch(match.id);
    expect(after.players.some((p) => p.userId === people.bob!.id)).toBe(false);
    expect(after.status).toBe("open");
    await as("dave");
    const joined = await backend.joinMatch(match.id);
    expect(seat(joined, "dave")?.seat).toBe(1); // the freed seat
  });

  it("sizes team tables in whole teams and won't start until every team has a player", async () => {
    await signUp("bob", "erin");
    await as("alice");
    await backend.registerApp(appInput("duo", { players: { min: 2, max: 4 }, teams: 2 }));
    await expectCode(backend.createChallenge({ appSlug: "duo", mode: "live", maxPlayers: 3 }), "invalid");
    const table = await backend.createChallenge({ appSlug: "duo", mode: "live", opponentHandles: ["erin", "bob"] });
    expect(table.maxPlayers).toBe(4); // 3 rounded up to whole teams
    expect(table.minPlayers).toBe(2);
    expect(table.players.map((p) => p.team)).toEqual([0, 1, 0]);
    await as("bob");
    await backend.joinMatch(table.id); // seat 2, team 0 — same team as alice
    await as("alice");
    await expectCode(backend.startMatch(table.id), "conflict");
    await as("erin");
    await backend.joinMatch(table.id);
    await as("alice");
    expect((await backend.startMatch(table.id)).status).toBe("active");
  });
});

describe("demo backend: settlement", () => {
  it("ranks N players with shared ranks and placement XP", async () => {
    const match = await fourPlayerLive();
    const scores: Record<string, number> = { alice: 10, bob: 30, carol: 30, dave: 5 };
    for (const handle of ["alice", "bob", "carol", "dave"]) {
      await as(handle);
      await backend.submit(match.id, { score: scores[handle] });
    }
    const done = (await backend.getMatch(match.id))!;
    expect(done.status).toBe("completed");
    expect(done.winnerId).toBeNull();
    expect(done.players.map((p) => [p.profile.handle, p.rank, p.result, p.xpDelta])).toEqual([
      ["alice", 3, "loss", placementXp(3, 4)],
      ["bob", 1, "draw", XP.win],
      ["carol", 1, "draw", XP.win],
      ["dave", 4, "loss", XP.loss],
    ]);
    const bob = await backend.getProfile("bob");
    expect(bob?.draws).toBe(1);
    const dave = await backend.getProfile("dave");
    expect(dave?.losses).toBe(1);
  });

  it("plays teams: seat % teams, summed scores, winnerTeam", async () => {
    const match = await fourPlayerLive("teamup", { players: { min: 4, max: 4 }, teams: 2 });
    expect(match.teams).toBe(2);
    expect(match.players.map((p) => p.team)).toEqual([0, 1, 0, 1]);
    const scores: Record<string, number> = { alice: 5, bob: 10, carol: 5, dave: 1 };
    for (const handle of ["alice", "bob", "carol", "dave"]) {
      await as(handle);
      await backend.submit(match.id, { score: scores[handle] });
    }
    const done = (await backend.getMatch(match.id))!;
    expect(done.winnerTeam).toBe(1);
    expect(done.winnerId).toBeNull();
    expect(done.players.map((p) => [p.rank, p.result, p.xpDelta])).toEqual([
      [2, "loss", XP.loss],
      [1, "win", XP.win],
      [2, "loss", XP.loss],
      [1, "win", XP.win],
    ]);
  });

  it("re-applies a submission another tab's stale write erased", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      await signUp("bob");
      await as("alice");
      const match = await backend.createChallenge({ appSlug: "quick-draw", mode: "live", opponentHandle: "bob" });
      await as("bob");
      await backend.joinMatch(match.id);
      await as("alice");
      const before = fakeLocalStorage.getItem(DB_KEY)!;
      await backend.submit(match.id, { score: 900 });
      // Bob's tab writes a copy it read before Alice's entry arrived.
      fakeLocalStorage.setItem(DB_KEY, before);
      expect(seat((await backend.getMatch(match.id))!, "alice")?.state).toBe("joined");
      vi.advanceTimersByTime(LOST_WRITE_CHECKS_MS[0]!);
      const repaired = seat((await backend.getMatch(match.id))!, "alice");
      expect([repaired?.state, repaired?.score]).toEqual(["submitted", 900]);
      await as("bob");
      const done = await backend.submit(match.id, { score: 300 });
      expect(done.winnerId).toBe(people.alice!.id);
      // Later checks find nothing to repair.
      vi.advanceTimersByTime(5_000);
      expect((await backend.getMatch(match.id))?.status).toBe("completed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a 1v1 settling exactly like v1", async () => {
    await signUp("bob");
    await as("alice");
    const match = await backend.createChallenge({ appSlug: "quick-draw", mode: "live", opponentHandle: "bob" });
    await as("bob");
    await backend.joinMatch(match.id);
    await backend.submit(match.id, { score: 300 });
    await as("alice");
    const done = await backend.submit(match.id, { score: 900 });
    expect(done.winnerId).toBe(people.alice!.id);
    expect(done.players.map((p) => [p.rank, p.xpDelta])).toEqual([
      [1, XP.win],
      [2, XP.loss],
    ]);
  });

  it("runs practice with a distinct bot per seat and no rank change", async () => {
    const alice = await as("alice");
    await backend.registerApp(appInput("royale", { players: { min: 2, max: 4 } }));
    await expectCode(backend.startPractice("royale", 5), "invalid");
    expect((await backend.startPractice("royale")).players).toHaveLength(2);
    const match = await backend.startPractice("royale", 4);
    expect(match.status).toBe("active");
    const bots = match.players.filter((p) => p.isBot);
    expect(bots.map((b) => b.userId)).toEqual(PRACTICE_BOTS.slice(0, 3).map((b) => b.id));
    for (const bot of bots) await backend.submit(match.id, { playerId: bot.userId, score: 1 });
    const done = await backend.submit(match.id, { score: 5 });
    expect(done.status).toBe("completed");
    expect(done.winnerId).toBe(alice.id);
    expect(seat(done, "alice")?.xpDelta).toBe(XP.practice);
    const after = await backend.getProfile("alice");
    expect(after?.wins).toBe(0);
    expect(after?.xp).toBe(alice.xp + XP.practice);
  });

  it("sends N entries to the crowd and settles on votes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await signUp("bob", "carol", "vic");
    await as("alice");
    await backend.registerApp(appInput("memes", { players: { min: 2, max: 4 }, scoring: "votes", modes: ["async"] }));
    const match = await backend.createChallenge({ appSlug: "memes", mode: "async", opponentHandles: ["bob", "carol"] });
    for (const handle of ["bob", "carol"]) {
      await as(handle);
      await backend.joinMatch(match.id);
    }
    for (const handle of ["alice", "bob", "carol"]) {
      await as(handle);
      await backend.submit(match.id, { data: handle });
    }
    expect((await backend.getMatch(match.id))!.status).toBe("voting");
    await expectCode(backend.vote(match.id, people.bob!.id), "forbidden"); // carol is playing
    await as("vic");
    await backend.spectate(match.id);
    const voted = await backend.vote(match.id, people.carol!.id);
    expect(voted.votes[people.carol!.id]).toBe(1);

    // The simulated crowd only votes for real entries; the deadline decides a split vote.
    for (let i = 0; i < 400 && (await backend.getMatch(match.id))!.status === "voting"; i++) {
      if (i === 300) vi.setSystemTime(Date.now() + 10 * 60_000);
      backend.tick();
    }
    const done = (await backend.getMatch(match.id))!;
    expect(done.status).toBe("completed");
    const entryIds = new Set(done.players.map((p) => p.userId));
    expect(Object.keys(done.votes).every((id) => entryIds.has(id))).toBe(true);
    expect(done.players.filter((p) => p.rank === 1).length).toBeGreaterThanOrEqual(1);
  });
});

describe("demo backend: spectators", () => {
  it("adds spectators without a seat and refuses them everything a player does", async () => {
    const match = await fourPlayerLive();
    await signUp("sam");
    await as("sam");
    const watching = await backend.spectate(match.id);
    const me = seat(watching, "sam")!;
    expect(me.role).toBe("spectator");
    expect(me.seat).toBeNull();
    expect(watching.spectatorCount).toBe(1);

    await expectCode(backend.submit(match.id, { score: 1 }), "forbidden");
    await expectCode(backend.updateState(match.id, { x: 1 }, 0), "forbidden");
    await expectCode(backend.endTurn(match.id), "forbidden");
    await expectCode(backend.setRound(match.id, 1), "forbidden");
    expect((await backend.listMyMatches()).some((m) => m.id === match.id)).toBe(false);

    await as("alice");
    const forAlice = (await backend.getMatch(match.id))!;
    expect(forAlice.players.some((p) => p.role === "spectator")).toBe(false);
    expect(forAlice.spectatorCount).toBe(1);
  });

  it("refuses to spectate practice matches and lets spectators leave", async () => {
    const match = await fourPlayerLive();
    await as("alice");
    const practice = await backend.startPractice("royale");
    await as("sam");
    await expectCode(backend.spectate(practice.id), "not_found"); // someone else's practice is invisible
    await backend.spectate(match.id);
    const left = await backend.forfeit(match.id);
    expect(left.spectatorCount).toBe(0);
    expect(left.status).toBe("active");
  });

  it("respects apps that turn spectators off", async () => {
    await as("alice");
    await backend.registerApp(appInput("secret", { spectators: false }));
    const match = await backend.createChallenge({ appSlug: "secret", mode: "live" });
    await as("sam");
    await expectCode(backend.spectate(match.id), "forbidden");
  });
});

describe("demo backend: shared state, turns and rounds", () => {
  it("compare-and-sets the match state", async () => {
    const match = await fourPlayerLive();
    const first = await backend.updateState(match.id, { board: [1] }, 0);
    expect(first.version).toBe(1);
    expect(first.match.state).toEqual({ board: [1] });
    await as("bob");
    await expectCode(backend.updateState(match.id, { board: [2] }, 0), "conflict");
    const second = await backend.updateState(match.id, { board: [1, 2] }, 1);
    expect(second.version).toBe(2);
    await expectCode(backend.updateState(match.id, { blob: "x".repeat(70_000) }, 2), "invalid");
  });

  it("rotates turns through seated players, skipping anyone who left", async () => {
    const match = await fourPlayerLive("turns", { turnBased: true });
    const ids = ["alice", "bob", "carol", "dave"].map((h) => people[h]!.id);
    expect(match.turnUserId).toBe(ids[0]); // activation hands the lowest seat the first turn
    expect(match.turnDeadline).toBeNull(); // live turns have no deadline
    let m = await backend.endTurn(match.id);
    expect(m.turnUserId).toBe(ids[1]);
    await expectCode(backend.endTurn(match.id), "forbidden"); // it's bob's turn now
    await as("bob");
    await expectCode(backend.endTurn(match.id, "nobody"), "invalid");
    m = await backend.endTurn(match.id, ids[3]);
    expect(m.turnUserId).toBe(ids[3]);
    await as("carol");
    await backend.forfeit(match.id);
    await as("dave");
    m = await backend.endTurn(match.id);
    expect(m.turnUserId).toBe(ids[0]); // wraps around
    await as("alice");
    m = await backend.endTurn(match.id);
    expect(m.turnUserId).toBe(ids[1]); // carol left, bob is next after alice anyway
    await as("bob");
    m = await backend.endTurn(match.id);
    expect(m.turnUserId).toBe(ids[3]); // skips carol
  });

  it("forfeits async turn holders past their deadline and settles when too few remain", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await signUp("bob", "carol");
    await as("alice");
    await backend.registerApp(appInput("chess3", { players: { min: 2, max: 3 }, turnBased: true }));
    const match = await backend.createChallenge({ appSlug: "chess3", mode: "async", opponentHandles: ["bob", "carol"] });
    for (const handle of ["bob", "carol"]) {
      await as(handle);
      await backend.joinMatch(match.id);
    }
    await as("alice");
    const active = (await backend.getMatch(match.id))!;
    expect(active.turnUserId).toBe(people.alice!.id);
    expect(active.turnDeadline).not.toBeNull();
    const m = await backend.endTurn(match.id);
    expect(m.turnUserId).toBe(people.bob!.id);
    expect(Date.parse(m.turnDeadline!) - Date.now()).toBe(TURN_TIMEOUT_MS);

    vi.setSystemTime(Date.now() + TURN_TIMEOUT_MS + 1_000);
    backend.tick();
    let now = (await backend.getMatch(match.id))!;
    expect(now.status).toBe("active");
    expect(seat(now, "bob")?.state).toBe("left");
    expect(now.turnUserId).toBe(people.carol!.id);

    vi.setSystemTime(Date.now() + TURN_TIMEOUT_MS + 1_000);
    backend.tick();
    now = (await backend.getMatch(match.id))!;
    expect(now.status).toBe("completed");
    expect(now.winnerId).toBe(people.alice!.id);
    expect(now.turnDeadline).toBeNull();
    expect(seat(now, "bob")?.xpDelta).toBe(XP.loss);
  });

  it("keeps rounds monotonic", async () => {
    const match = await fourPlayerLive();
    expect((await backend.setRound(match.id, 2)).round).toBe(2);
    await expectCode(backend.setRound(match.id, 1), "invalid");
    expect((await backend.setRound(match.id, 2)).round).toBe(2);
  });
});

describe("demo backend: leaving N-player matches", () => {
  it("claims against quiet players and continues while two remain", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const match = await backend.markStarted((await fourPlayerLive()).id);
    vi.setSystemTime(Date.now() + 60_000);
    await backend.heartbeat(match.id);
    await as("bob");
    await backend.heartbeat(match.id);
    await as("alice");
    let m = await backend.claimForfeit(match.id); // one quiet player per claim, lowest seat first
    expect(m.status).toBe("active");
    expect(seat(m, "carol")?.state).toBe("left");
    expect(seat(m, "dave")?.state).toBe("joined");
    m = await backend.claimForfeit(match.id);
    expect(seat(m, "dave")?.state).toBe("left");
    expect(m.status).toBe("active");
    await expectCode(backend.claimForfeit(match.id), "conflict"); // bob is still here

    await backend.submit(match.id, { score: 1 });
    await as("bob");
    m = await backend.submit(match.id, { score: 2 });
    expect(m.status).toBe("completed");
    expect(m.winnerId).toBe(people.bob!.id);
    expect(seat(m, "carol")?.rank).toBe(3);
    expect(seat(m, "carol")?.xpDelta).toBe(XP.loss);
  });

  it("settles a team match once a whole team is gone", async () => {
    const match = await fourPlayerLive("teamup", { players: { min: 4, max: 4 }, teams: 2 });
    await as("bob");
    expect((await backend.forfeit(match.id)).status).toBe("active"); // dave still plays for team 1
    await as("dave");
    const done = await backend.forfeit(match.id);
    expect(done.status).toBe("completed");
    expect(done.winnerTeam).toBe(0);
  });
});

describe("demo backend: dead lobbies", () => {
  it("expires a quick lobby nobody joined in 10 minutes and stale live tables after 2 hours", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await as("alice");
      const first = await backend.quickMatch("quick-draw");
      expect(first.status).toBe("open");
      vi.setSystemTime(Date.now() + 11 * 60_000);
      const listed = await backend.listMyMatches();
      expect(listed.find((m) => m.id === first.id)?.status).toBe("expired");
      // A new press makes one fresh lobby, not another dead one next to it.
      const fresh = await backend.quickMatch("quick-draw");
      expect(fresh.id).not.toBe(first.id);
      expect((await backend.quickMatch("quick-draw")).id).toBe(fresh.id);
      await signUp("bob");
      await as("alice");
      const table = await backend.createChallenge({ appSlug: "quick-draw", mode: "live", opponentHandle: "bob" });
      vi.setSystemTime(Date.now() + 3 * 3_600_000);
      const later = await backend.listMyMatches();
      expect(later.find((m) => m.id === table.id)?.status).toBe("expired");
      expect(later.find((m) => m.id === fresh.id)?.status).toBe("expired");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("demo store", () => {
  it("upgrades a v3 database instead of wiping it", () => {
    const v3 = {
      version: 3,
      profiles: { a: { id: "a", handle: "a", name: "a", avatarUrl: null, bio: "", xp: 5, wins: 1, losses: 0, draws: 0, streak: 1, bestStreak: 1, createdAt: "" } },
      apps: {},
      playCounts: {},
      matches: {
        m1: {
          id: "m1",
          appSlug: "emoji-decode",
          mode: "live",
          status: "completed",
          scoring: "high",
          seed: "s",
          createdBy: "a",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          startedAt: null,
          endedAt: null,
          winnerId: "a",
          isOpen: false,
          settings: {},
          votes: {},
          votesNeeded: 0,
          votingEndsAt: null,
          simulatedVotes: false,
          players: [
            { userId: "a", seat: 0, state: "submitted", isBot: false, score: 2, submission: null, result: "win", xpDelta: 30, lastSeenAt: null },
          ],
        },
      },
      votes: [],
      storage: {},
      appStats: {},
    };
    fakeLocalStorage.removeItem(DB_KEY);
    fakeLocalStorage.setItem("xapps:demo-db:v3", JSON.stringify(v3));
    const db = load();
    expect(db.version).toBe(4);
    expect(db.profiles.a?.xp).toBe(5);
    expect(db.matches.m1).toMatchObject({ maxPlayers: 2, minPlayers: 2, stateVersion: 0, round: 0, teams: 0 });
    expect(db.matches.m1?.players[0]).toMatchObject({ role: "player", team: null, rank: 1 });
    expect(PRACTICE_BOTS.every((bot) => db.profiles[bot.id])).toBe(true);
    expect(fakeLocalStorage.getItem("xapps:demo-db:v3")).toBeNull();
  });
});

describe("demo backend: retired apps", () => {
  it("keeps old matches readable, cancels unfinished ones and refuses new play", async () => {
    await signUp("bob");
    await as("alice");
    const done = await backend.createChallenge({ appSlug: "quick-draw", mode: "live", opponentHandle: "bob" });
    await as("bob");
    await backend.joinMatch(done.id);
    await backend.submit(done.id, { score: 1 });
    await as("alice");
    await backend.submit(done.id, { score: 3 });
    const waiting = await backend.createChallenge({ appSlug: "quick-draw", mode: "live", opponentHandle: "bob" });
    // Older demo data: both were Trivia Royale matches.
    const db = JSON.parse(fakeLocalStorage.getItem(DB_KEY)!);
    for (const id of [done.id, waiting.id]) db.matches[id].appSlug = "trivia-royale";
    fakeLocalStorage.setItem(DB_KEY, JSON.stringify(db));

    const mine = await backend.listMyMatches();
    expect(mine.find((m) => m.id === done.id)).toMatchObject({ appSlug: "trivia-royale", status: "completed", winnerId: people.alice!.id });
    expect(mine.find((m) => m.id === waiting.id)?.status).toBe("cancelled");
    expect((await backend.getMatch(done.id))?.status).toBe("completed");
    expect((await backend.listApps()).some((a) => a.slug === "trivia-royale")).toBe(false);
    expect(await backend.getApp("trivia-royale")).toBeNull();
    await expectCode(backend.quickMatch("trivia-royale"), "not_found");
    await expectCode(backend.createChallenge({ appSlug: "trivia-royale", mode: "live", opponentHandle: "bob" }), "not_found");
    await expectCode(backend.startPractice("trivia-royale"), "not_found");
    await expectCode(backend.registerApp(appInput("trivia-royale")), "conflict");
  });

  it("stocks the Arena with Meme Duels only", () => {
    const voting = Object.values(load().matches).filter((m) => m.status === "voting");
    expect(voting.length).toBeGreaterThan(0);
    expect(voting.every((m) => m.appSlug === "meme-duel")).toBe(true);
  });
});

/**
 * Room traffic for a live match. Each client is authoritative for the trucks
 * it simulates (its own, plus the bots when it drives them):
 *
 *   "s"  state   ~15 Hz, every owned truck packed into one message (≈ 70 B each)
 *   "h"  hit     attacker → everyone; the victim's owner applies damage + shove
 *   "k"  ko      the victim's owner announces a KO (with credit + cause)
 *   "f"  fin     round over: final hp / armor / damage of the sender's trucks
 *
 * Senders are checked against the seats they claim: a human may only speak
 * for their own truck, and bots only through a seated human (the bot driver).
 */

import type { XAppsClient } from "@xapps/sdk";
import {
  FLAG,
  KO_CAUSE,
  NET_HZ,
  SendBudget,
  decodeHit,
  encodeHit,
  encodeLoadout,
  packTruck,
  unpackTruck,
  type EndReason,
  type FinMsg,
  type KoMsg,
  type KoCause,
  type StateMsg,
} from "./logic";
import type { HitSend, TruckRuntime, World } from "./world";

const warn = (what: string) => (error: unknown) => {
  // Rate limits are expected under heavy fights; everything else is worth a note.
  if (error && typeof error === "object" && "code" in error && (error as { code: string }).code === "rate_limited") return;
  console.warn(`[wedge-wars] ${what} failed`, error);
};

export class NetLink {
  private readonly budget = new SendBudget(26);
  private lastStateAt = 0;
  private readonly period = 1000 / NET_HZ;
  private finSent = false;

  constructor(
    private readonly xapps: XAppsClient,
    private readonly world: World,
  ) {}

  /** Whether this client sends anything at all (not spectators or offline sims). */
  get active(): boolean {
    return !this.world.sim && !this.world.spectator && this.world.trucks.some((t) => t.local);
  }

  private send(type: string, payload: StateMsg | ReturnType<typeof encodeHit> | KoMsg | FinMsg, now: number, reserve: number): void {
    if (!this.active) return;
    if (!this.budget.take(now, reserve)) return;
    this.xapps.room.send(type, payload as never).catch(warn(`send ${type}`));
  }

  /** Called every frame; sends owned trucks' state at NET_HZ (slower for wrecks). */
  tick(now: number): void {
    if (!this.active) return;
    const owned = this.world.trucks.filter((t) => t.local);
    const allDead = owned.every((t) => !t.alive);
    const period = allDead ? this.period * 3 : this.period;
    if (now - this.lastStateAt < period) return;
    this.lastStateAt = now;
    const t = Math.round(this.world.time(now));
    const msg: StateMsg = { t, k: owned.map((o) => packTruck(o.seat, stateOf(o, t))) };
    // Keep 4 tokens in reserve for hits/KOs.
    this.send("s", msg, now, 4);
  }

  hit(h: HitSend, now: number): void {
    this.send("h", encodeHit(h), now, 0);
  }

  ko(victimSeat: number, attackerSeat: number, cause: KoCause, t: number, now: number): void {
    this.send("k", { v: victimSeat, a: attackerSeat, c: Math.max(0, KO_CAUSE.indexOf(cause)), t: Math.round(t) }, now, 0);
  }

  fin(reason: EndReason, now: number): void {
    if (this.finSent) return;
    this.finSent = true;
    const k = this.world.trucks
      .filter((t) => t.local)
      .map((t) => [t.seat, Math.round(t.hp * 10), Math.round(t.armor * 10), Math.round(t.dmgDealt), t.alive ? 1 : 0, Math.round(t.koAt ?? -1)]);
    this.send("f", { r: reason === "ko" ? 0 : 1, k }, now, 0);
  }

  /* Incoming -------------------------------------------------------------- */

  /** May `from` speak for the truck at `seat`? */
  private owns(from: string, seat: number): TruckRuntime | null {
    const t = this.world.bySeat.get(seat);
    if (!t || t.local) return null;
    if (t.id === from) return t;
    if (t.isBot && this.world.trucks.some((o) => o.id === from && !o.isBot)) return t;
    return null;
  }

  onState(payload: unknown, from: string, now: number): void {
    const msg = payload as Partial<StateMsg>;
    if (!msg || typeof msg.t !== "number" || !Array.isArray(msg.k)) return;
    for (const raw of msg.k.slice(0, 8)) {
      const u = unpackTruck(raw);
      if (!u) continue;
      const t = this.owns(from, u.seat);
      if (!t) continue;
      this.world.receiveState(u.seat, msg.t, u.state, now);
      if (u.state.flags & FLAG.dead && t.alive && this.world.phase === "fight") {
        this.world.knockOut(t, this.world.creditFor(t, now), "wreck", msg.t, null, true);
      }
    }
  }

  onHit(payload: unknown, from: string, now: number): void {
    const h = decodeHit(payload);
    if (!h) return;
    const attacker = this.world.bySeat.get(h.attacker);
    const victim = this.world.bySeat.get(h.victim);
    if (!attacker || !victim) return;
    // The attacker must be the sender's truck (or a bot the sender drives).
    if (attacker.id !== from && !(attacker.isBot && this.world.trucks.some((o) => o.id === from && !o.isBot))) return;
    if (victim.local) {
      this.world.applyHit(attacker.id, victim, h.damage, h.impulse, h.point, h.kind, now);
    } else {
      this.world.hitFx(attacker, victim, h.damage, h.point, h.kind);
    }
  }

  onKo(payload: unknown, from: string): void {
    const m = payload as Partial<KoMsg>;
    if (!m || typeof m.v !== "number" || typeof m.a !== "number" || typeof m.c !== "number" || typeof m.t !== "number") return;
    const victim = this.owns(from, m.v);
    if (!victim) return;
    const by = this.world.bySeat.get(m.a)?.id ?? null;
    this.world.knockOut(victim, by, KO_CAUSE[m.c] ?? "wreck", m.t, null, true);
  }

  onFin(payload: unknown, from: string, now: number): void {
    const m = payload as Partial<FinMsg>;
    if (!m || typeof m.r !== "number" || !Array.isArray(m.k)) return;
    for (const row of m.k.slice(0, 8)) {
      if (!Array.isArray(row) || row.length !== 6 || row.some((v) => typeof v !== "number" || !Number.isFinite(v))) continue;
      const [seat, hp, armor, dmg, alive, koAt] = row as number[];
      const t = this.owns(from, seat!);
      if (!t) continue;
      t.hp = Math.max(0, hp! / 10);
      t.armor = Math.max(0, armor! / 10);
      t.dmgDealt = Math.max(t.dmgDealt, dmg!);
      if (!alive && t.alive) this.world.knockOut(t, null, "wreck", koAt! >= 0 ? koAt! : this.world.time(now), null, true);
    }
    // Someone's clock hit the bell (or saw the last KO) first: end here too.
    this.world.end(m.r === 0 ? "ko" : "time", now);
    this.fin(m.r === 0 ? "ko" : "time", now);
  }
}

/** A local truck's replicated state. */
export function stateOf(t: TruckRuntime, time: number) {
  const weapon = t.loadout.weapon === "spinner" ? t.spin : t.loadout.weapon === "flamer" ? t.fuel : Math.max(0, t.anim);
  const flags =
    (t.boosting ? FLAG.boost : 0) |
    (t.firing || (t.loadout.weapon !== "flamer" && t.animT >= 0) ? FLAG.firing : 0) |
    (t.alive ? 0 : FLAG.dead) |
    (t.burnUntil > time ? FLAG.burning : 0) |
    (t.flipped ? FLAG.flipped : 0);
  return {
    x: t.pos.x,
    y: t.pos.y,
    z: t.pos.z,
    qx: t.quat.x,
    qy: t.quat.y,
    qz: t.quat.z,
    qw: t.quat.w,
    vx: t.vel.x,
    vy: t.vel.y,
    vz: t.vel.z,
    hp: t.hp,
    armor: t.armor,
    weapon,
    flags,
    loadout: encodeLoadout(t.loadout),
    dmg: t.dmgDealt,
  };
}

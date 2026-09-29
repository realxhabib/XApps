/**
 * Wedge Wars — pure game rules. No three.js, no React, no SDK calls: the
 * damage model, loadouts, placements and scoring, the bot brain, the netcode
 * wire format + interpolation, and what a match earns in stats/achievements.
 * Everything here is deterministic and unit-tested (logic.test.ts).
 *
 * Conventions: meters, seconds (ms where named), y up. A truck faces +Z in its
 * own space, so its world heading is `yaw` with forward = (sin yaw, 0, cos yaw).
 */

/* ---------------------------------------------------------------------- */
/* Match constants                                                        */
/* ---------------------------------------------------------------------- */

/** One round: 2:30, or until one truck is left. */
export const ROUND_MS = 150_000;
/** After the deciding KO (or the bell) the KO cam plays before results go in. */
export const OUTRO_MS = 3_200;
/** Base hull points; armor sits on top of it (see ARMORS). */
export const HP_MAX = 100;
/** A truck whose owner has been silent this long powers down and counts as KO. */
export const DISCONNECT_MS = 6_000;
/** Last attacker within this window gets the credit for pit/hazard KOs. */
export const CREDIT_MS = 5_000;
/** Net state rate (per client, all of its trucks in one message). */
export const NET_HZ = 15;
/** Remote trucks are drawn this far in the past, between two snapshots. */
export const INTERP_MS = 100;
/** How far a remote truck may be extrapolated past its newest snapshot. */
export const EXTRAPOLATE_MS = 250;

/** The arena: a 40 × 40 m floor, walls all round, and a square KO pit in the middle. */
export const ARENA = {
  half: 20,
  wallHeight: 4.5,
  pit: { x: 0, z: 0, half: 3 },
  /** Below this a truck has fallen out of the world (pit). */
  koDepth: -2.5,
} as const;

/** Spawn points (by seat), each facing the pit. */
export function spawnFor(seat: number): { x: number; z: number; yaw: number } {
  const corners = [
    [-12, -12],
    [12, 12],
    [12, -12],
    [-12, 12],
  ] as const;
  const [x, z] = corners[((seat % 4) + 4) % 4] ?? corners[0];
  return { x, z, yaw: Math.atan2(-x, -z) };
}

/* ---------------------------------------------------------------------- */
/* Loadouts                                                               */
/* ---------------------------------------------------------------------- */

export type WeaponKind = "spinner" | "flipper" | "hammer" | "flamer";
export type ArmorKind = "scout" | "brawler" | "tank";

export interface WeaponSpec {
  id: WeaponKind;
  name: string;
  blurb: string;
  /** Recharge after a use (ms). The flamer's is its fuel refill time. */
  cooldownMs: number;
  /** Reach in front of the nose (m). */
  range: number;
  /** 1–5 for the garage bars. */
  damage: number;
  control: number;
  /** Top-speed multiplier (weapon weight). */
  speed: number;
}

export const WEAPON_ORDER: WeaponKind[] = ["spinner", "flipper", "hammer", "flamer"];

export const WEAPONS: Record<WeaponKind, WeaponSpec> = {
  spinner: {
    id: "spinner",
    name: "Bar Spinner",
    blurb: "Horizontal bar at 3,000 rpm. Rev it, then kiss them.",
    cooldownMs: 2_600,
    range: 1.3,
    damage: 5,
    control: 2,
    speed: 0.95,
  },
  flipper: {
    id: "flipper",
    name: "Flipper",
    blurb: "Pneumatic wedge plate. Get under them and launch.",
    cooldownMs: 2_200,
    range: 1.5,
    damage: 2,
    control: 5,
    speed: 1.02,
  },
  hammer: {
    id: "hammer",
    name: "Axe Hammer",
    blurb: "Overhead axe. Slow, brutal, satisfying.",
    cooldownMs: 1_500,
    range: 2.0,
    damage: 4,
    control: 3,
    speed: 0.98,
  },
  flamer: {
    id: "flamer",
    name: "Flamethrower",
    blurb: "Hold to torch. Burns keep ticking after you let go.",
    cooldownMs: 4_000,
    range: 5.5,
    damage: 3,
    control: 1,
    speed: 1.06,
  },
};

export interface ArmorSpec {
  id: ArmorKind;
  name: string;
  blurb: string;
  /** Armor points on top of HP_MAX. */
  armor: number;
  /** Relative mass (drives rams and knockback). */
  mass: number;
  /** Top-speed multiplier. */
  speed: number;
  /** Ram damage multiplier (spikes). */
  ram: number;
}

export const ARMOR_ORDER: ArmorKind[] = ["scout", "brawler", "tank"];

export const ARMORS: Record<ArmorKind, ArmorSpec> = {
  scout: { id: "scout", name: "Scout", blurb: "Roll cage, no plates. Fast and twitchy.", armor: 20, mass: 0.85, speed: 1.12, ram: 1 },
  brawler: { id: "brawler", name: "Brawler", blurb: "Spiked bumper and skirts. Built to ram.", armor: 40, mass: 1, speed: 1, ram: 1.35 },
  tank: { id: "tank", name: "Tank", blurb: "Bolted plate everywhere. Slow, hard to kill.", armor: 70, mass: 1.25, speed: 0.86, ram: 1.1 },
};

export interface Paint {
  name: string;
  /** Accent color (stripes, rims, underglow). */
  hex: string;
}

export const PAINTS: Paint[] = [
  { name: "Volt", hex: "#c6ff3d" },
  { name: "Inferno", hex: "#ff5a1f" },
  { name: "Ion", hex: "#35c8ff" },
  { name: "Hotrod", hex: "#ff2e63" },
  { name: "Toxic", hex: "#3dffa2" },
  { name: "Royal", hex: "#9b6bff" },
];

export interface Loadout {
  weapon: WeaponKind;
  armor: ArmorKind;
  paint: number;
}

export const DEFAULT_LOADOUT: Loadout = { weapon: "spinner", armor: "brawler", paint: 0 };

/** Packs a loadout into one small integer for the wire (weapon·100 + armor·10 + paint). */
export function encodeLoadout(l: Loadout): number {
  const w = Math.max(0, WEAPON_ORDER.indexOf(l.weapon));
  const a = Math.max(0, ARMOR_ORDER.indexOf(l.armor));
  const p = clampInt(l.paint, 0, PAINTS.length - 1);
  return w * 100 + a * 10 + p;
}

export function decodeLoadout(code: unknown): Loadout {
  if (typeof code !== "number" || !Number.isFinite(code) || code < 0) return { ...DEFAULT_LOADOUT };
  const n = Math.floor(code);
  const weapon = WEAPON_ORDER[Math.floor(n / 100)] ?? DEFAULT_LOADOUT.weapon;
  const armor = ARMOR_ORDER[Math.floor(n / 10) % 10] ?? DEFAULT_LOADOUT.armor;
  const paint = n % 10 < PAINTS.length ? n % 10 : 0;
  return { weapon, armor, paint };
}

/** Parses a saved/untrusted loadout. */
export function parseLoadout(raw: unknown): Loadout {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_LOADOUT };
  const r = raw as Record<string, unknown>;
  return {
    weapon: WEAPON_ORDER.includes(r.weapon as WeaponKind) ? (r.weapon as WeaponKind) : DEFAULT_LOADOUT.weapon,
    armor: ARMOR_ORDER.includes(r.armor as ArmorKind) ? (r.armor as ArmorKind) : DEFAULT_LOADOUT.armor,
    paint: typeof r.paint === "number" && r.paint >= 0 && r.paint < PAINTS.length ? Math.floor(r.paint) : 0,
  };
}

/** Garage stat bars, each 0..1. */
export function loadoutStats(l: Loadout): { speed: number; armor: number; damage: number } {
  const w = WEAPONS[l.weapon];
  const a = ARMORS[l.armor];
  const speed = topSpeed(l);
  return {
    speed: clamp01((speed - 14) / (22 - 14)),
    armor: clamp01((HP_MAX + a.armor) / (HP_MAX + 70)),
    damage: clamp01((w.damage + (a.ram - 1) * 4) / 6),
  };
}

/** Top speed (m/s) before boost. */
export function topSpeed(l: Loadout): number {
  return 17.5 * WEAPONS[l.weapon].speed * ARMORS[l.armor].speed;
}

/** Deterministic bot loadout for seat `seat` from the match seed (`rand` returns 0..1). */
export function botLoadout(rand: () => number, seat: number): Loadout {
  const weapon = WEAPON_ORDER[Math.floor(rand() * WEAPON_ORDER.length) % WEAPON_ORDER.length] ?? "spinner";
  const armor = ARMOR_ORDER[Math.floor(rand() * ARMOR_ORDER.length) % ARMOR_ORDER.length] ?? "brawler";
  return { weapon, armor, paint: (seat + 1 + Math.floor(rand() * 2)) % PAINTS.length };
}

/** Bot skill 0.35..0.95, varied per seat but stable for a seed. */
export function botSkill(rand: () => number, seat: number): number {
  return 0.35 + ((rand() * 0.6 + seat * 0.17) % 0.6);
}

/* ---------------------------------------------------------------------- */
/* Damage model                                                           */
/* ---------------------------------------------------------------------- */

/** Share of each hit that armor soaks while it lasts. */
export const ARMOR_ABSORB = 0.6;

export interface Health {
  hp: number;
  armor: number;
}

/**
 * Applies `damage` to a hull: armor soaks 60% of it until it is gone, the
 * rest (and everything after) comes off HP. Never goes below 0.
 */
export function applyDamage(h: Health, damage: number): Health & { hpLoss: number; armorLoss: number } {
  const dmg = Math.max(0, Number.isFinite(damage) ? damage : 0);
  const armorLoss = Math.min(h.armor, dmg * ARMOR_ABSORB);
  const hpLoss = Math.min(h.hp, dmg - armorLoss);
  return { hp: h.hp - hpLoss, armor: h.armor - armorLoss, hpLoss, armorLoss };
}

/** Minimum closing speed (m/s) for a ram to hurt. */
export const RAM_MIN_SPEED = 4;

/**
 * Ram damage the attacker deals: from the closing speed along the contact
 * normal, scaled by how squarely the attacker's nose points at the victim
 * (`frontDot` = cos of the angle between its forward and the contact
 * direction). Glancing or backwards bumps deal nothing. Capped at 30.
 */
export function ramDamage(closingSpeed: number, frontDot: number, ramMultiplier = 1): number {
  if (!(closingSpeed > RAM_MIN_SPEED)) return 0;
  const facing = clamp01((frontDot - 0.35) / 0.55);
  if (facing <= 0) return 0;
  return Math.min(30, (closingSpeed - RAM_MIN_SPEED) * 2.4 * facing * ramMultiplier);
}

/** Spinner hit damage from its spin (0..1): a lazy tap stings, a full rev wrecks. */
export function spinnerDamage(spin: number): number {
  const s = clamp01(spin);
  return 4 + 24 * s * s;
}

export const FLIPPER_DAMAGE = 7;
export const HAMMER_DAMAGE = 22;
/** Flame damage per second while the target is in the cone, and after-burn per second. */
export const FLAME_DPS = 17;
export const BURN_DPS = 4;
export const BURN_MS = 1_800;

/** Hazards: saw contact per second, vent flames per second, one pulverizer slam. */
export const SAW_DPS = 22;
export const VENT_DPS = 12;
export const PULVERIZER_DAMAGE = 30;

/** Hit feel: how hard each hit shakes the camera, 0..1. */
export function traumaFor(damage: number): number {
  return clamp01(0.12 + damage / 30);
}

/* ---------------------------------------------------------------------- */
/* Hazards (timed from match start, identical on every client)            */
/* ---------------------------------------------------------------------- */

export interface HazardLayout {
  saws: { x: number; z: number; phase: number }[];
  vents: { x: number; z: number; phase: number }[];
  pulverizer: { x: number; z: number; phase: number };
}

/** Fixed positions; the timing offsets come from the seeded match random. */
export function hazardLayout(rand: () => number): HazardLayout {
  return {
    saws: [
      { x: -10, z: 0, phase: rand() },
      { x: 10, z: 0, phase: rand() },
      { x: 0, z: 11, phase: rand() },
    ],
    vents: [
      { x: 0, z: -10, phase: rand() },
      { x: -6.5, z: 8, phase: rand() },
      { x: 6.5, z: -8, phase: rand() },
    ],
    pulverizer: { x: 14.5, z: 0, phase: rand() },
  };
}

export const SAW_PERIOD = 7;
export const SAW_UP = 2.6;
export const VENT_PERIOD = 6;
export const VENT_WARN = 1;
export const VENT_ON = 1.6;
export const PULVERIZER_PERIOD = 6.5;

/** Saw height 0 (hidden) .. 1 (fully up) at match time `t` (s). */
export function sawLevel(t: number, phase: number): number {
  const local = mod(t + phase * SAW_PERIOD, SAW_PERIOD);
  if (local > SAW_UP) return 0;
  const edge = 0.25;
  return clamp01(Math.min(local / edge, (SAW_UP - local) / edge));
}

/** Vent state at `t`: "idle", "warn" (glowing) or "fire". */
export function ventState(t: number, phase: number): "idle" | "warn" | "fire" {
  const local = mod(t + phase * VENT_PERIOD, VENT_PERIOD);
  if (local < VENT_WARN) return "warn";
  if (local < VENT_WARN + VENT_ON) return "fire";
  return "idle";
}

/**
 * Pulverizer head height 0 (on the floor) .. 1 (raised) at `t`. It hangs up
 * high, slams down in 0.18 s, rests, and winds back up.
 */
export function pulverizerLevel(t: number, phase: number): number {
  const local = mod(t + phase * PULVERIZER_PERIOD, PULVERIZER_PERIOD);
  const drop = PULVERIZER_PERIOD - 0.18;
  if (local >= drop) return 1 - (local - drop) / 0.18;
  if (local < 0.5) return 0;
  return Math.min(1, (local - 0.5) / 2.2);
}

/** True in the frame window right after the pulverizer lands (for one damage tick). */
export function pulverizerJustLanded(tPrev: number, t: number, phase: number): boolean {
  const period = PULVERIZER_PERIOD;
  const landAt = (k: number) => k * period - phase * period;
  const k = Math.ceil((tPrev + phase * period) / period);
  const at = landAt(k);
  return at > tPrev && at <= t;
}

/* ---------------------------------------------------------------------- */
/* Geometry helpers                                                       */
/* ---------------------------------------------------------------------- */

/** Half extents of a truck's hull box (m), used for weapon hit tests. */
export const HULL = { x: 0.82, y: 0.45, z: 1.35 } as const;

/**
 * Does a sphere at world (px, py, pz) with radius `r` touch the box of a truck
 * at (bx, by, bz) with heading `yaw`? (Ignores roll/pitch: trucks are flat most
 * of the time and the hit spheres are generous.)
 */
export function sphereHitsHull(
  px: number,
  py: number,
  pz: number,
  r: number,
  bx: number,
  by: number,
  bz: number,
  yaw: number,
): boolean {
  const dx = px - bx;
  const dy = py - by;
  const dz = pz - bz;
  const c = Math.cos(-yaw);
  const s = Math.sin(-yaw);
  const lx = dx * c + dz * s;
  const lz = -dx * s + dz * c;
  const qx = Math.max(-HULL.x, Math.min(HULL.x, lx));
  const qy = Math.max(-HULL.y, Math.min(HULL.y, dy));
  const qz = Math.max(-HULL.z, Math.min(HULL.z, lz));
  const ex = lx - qx;
  const ey = dy - qy;
  const ez = lz - qz;
  return ex * ex + ey * ey + ez * ez <= r * r;
}

/** Is a flame cone from (x, z) heading `yaw` touching a target at (tx, tz)? */
export function inCone(x: number, z: number, yaw: number, tx: number, tz: number, range: number, halfAngle: number): boolean {
  const dx = tx - x;
  const dz = tz - z;
  const d = Math.hypot(dx, dz);
  if (d > range + HULL.x) return false;
  if (d < 1e-6) return true;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const cos = (dx * fx + dz * fz) / d;
  // The target has width: widen the cone by its angular radius.
  const widen = Math.atan2(HULL.x, d);
  return cos >= Math.cos(halfAngle + widen);
}

/** Is (x, z) over the KO pit (plus a margin)? */
export function overPit(x: number, z: number, margin = 0): boolean {
  const { pit } = ARENA;
  return Math.abs(x - pit.x) < pit.half + margin && Math.abs(z - pit.z) < pit.half + margin;
}

/** Wraps an angle to (-π, π]. */
export function wrapAngle(a: number): number {
  let x = a % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  if (x <= -Math.PI) x += Math.PI * 2;
  return x;
}

/* ---------------------------------------------------------------------- */
/* Placements & scoring                                                   */
/* ---------------------------------------------------------------------- */

export interface Standing {
  id: string;
  seat: number;
  alive: boolean;
  hp: number;
  armor: number;
  /** Match time (ms) of the KO, or null while alive. */
  koAt: number | null;
  /** Damage this truck dealt. */
  dmg: number;
}

/**
 * Placements, 1 = winner. Survivors rank first, by HP + armor left, then
 * damage dealt, then seat. KO'd trucks follow, the later the KO the better
 * (ties by seat). Every truck gets a distinct rank.
 */
export function placements(standings: readonly Standing[]): Map<string, number> {
  const sorted = [...standings].sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    if (a.alive) {
      const ha = Math.round(a.hp + a.armor);
      const hb = Math.round(b.hp + b.armor);
      if (ha !== hb) return hb - ha;
      const da = Math.round(a.dmg);
      const db = Math.round(b.dmg);
      if (da !== db) return db - da;
      return a.seat - b.seat;
    }
    const ka = a.koAt ?? 0;
    const kb = b.koAt ?? 0;
    if (ka !== kb) return kb - ka;
    return a.seat - b.seat;
  });
  return new Map(sorted.map((s, i) => [s.id, i + 1]));
}

/** Damage-dealt bonus cap, so the bonus (≤ 600 + 100 HP) can never outweigh one placement (1,000). */
export const DAMAGE_BONUS_CAP = 600;

/**
 * Final score (scoring "high"):
 *   1000 × (players − placement)   placement: 1st of 4 → 3000, last → 0
 * + min(600, damage dealt)          rounded
 * + HP left (0–100)                 rounded, 0 when KO'd
 * The bonus is < 1000, so the platform's ranking by score always matches the
 * placement order.
 */
export function scoreFor(rank: number, players: number, dmg: number, hpLeft: number): number {
  const place = Math.max(0, players - rank) * 1000;
  const bonus = Math.min(DAMAGE_BONUS_CAP, Math.max(0, Math.round(dmg)));
  const hp = Math.max(0, Math.min(HP_MAX, Math.round(hpLeft)));
  return place + bonus + hp;
}

export type EndReason = "ko" | "time";

/** Is the round over? Last truck standing (with 2+ players), or the bell. */
export function roundOver(alive: number, players: number, elapsedMs: number): EndReason | null {
  if (players >= 2 && alive <= 1) return "ko";
  if (elapsedMs >= ROUND_MS) return "time";
  return null;
}

/** "2:30" style clock. */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/* ---------------------------------------------------------------------- */
/* Netcode: wire format                                                   */
/* ---------------------------------------------------------------------- */

/** State flags (bit field). */
export const FLAG = {
  boost: 1,
  firing: 2,
  dead: 4,
  burning: 8,
  flipped: 16,
} as const;

/** One truck's replicated state. */
export interface NetTruck {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  vx: number;
  vy: number;
  vz: number;
  hp: number;
  armor: number;
  /** Weapon animation 0..1 (flipper/hammer stroke, spinner spin, flamer fuel). */
  weapon: number;
  flags: number;
  loadout: number;
  dmg: number;
}

/**
 * Quantizes a truck into 16 small integers (≈ 70 bytes of JSON):
 * [seat, x cm, y cm, z cm, qx‰, qy‰, qz‰, qw‰, vx cm/s/10, vy, vz, hp·10, armor·10, weapon·100, flags, loadout, dmg]
 * The seat comes first so a message can carry several trucks (bots).
 */
export function packTruck(seat: number, s: NetTruck): number[] {
  // Keep qw ≥ 0 (q and −q are the same rotation) so interpolation takes the short way.
  const sign = s.qw < 0 ? -1 : 1;
  return [
    seat,
    Math.round(s.x * 100),
    Math.round(s.y * 100),
    Math.round(s.z * 100),
    Math.round(s.qx * sign * 1000),
    Math.round(s.qy * sign * 1000),
    Math.round(s.qz * sign * 1000),
    Math.round(s.qw * sign * 1000),
    Math.round(s.vx * 10),
    Math.round(s.vy * 10),
    Math.round(s.vz * 10),
    Math.round(Math.max(0, s.hp) * 10),
    Math.round(Math.max(0, s.armor) * 10),
    Math.round(clamp01(s.weapon) * 100),
    s.flags | 0,
    s.loadout | 0,
    Math.round(Math.max(0, s.dmg)),
  ];
}

export const PACKED_LENGTH = 17;

/** Inverse of `packTruck`; null for anything malformed. */
export function unpackTruck(raw: unknown): { seat: number; state: NetTruck } | null {
  if (!Array.isArray(raw) || raw.length !== PACKED_LENGTH) return null;
  for (const v of raw) if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const a = raw as number[];
  const qx = a[4]! / 1000;
  const qy = a[5]! / 1000;
  const qz = a[6]! / 1000;
  const qw = a[7]! / 1000;
  const len = Math.hypot(qx, qy, qz, qw) || 1;
  return {
    seat: a[0]!,
    state: {
      x: a[1]! / 100,
      y: a[2]! / 100,
      z: a[3]! / 100,
      qx: qx / len,
      qy: qy / len,
      qz: qz / len,
      qw: qw / len,
      vx: a[8]! / 10,
      vy: a[9]! / 10,
      vz: a[10]! / 10,
      hp: a[11]! / 10,
      armor: a[12]! / 10,
      weapon: a[13]! / 100,
      flags: a[14]!,
      loadout: a[15]!,
      dmg: a[16]!,
    },
  };
}

/** Room messages. Kept tiny and positional. */
export interface StateMsg {
  /** Sender's match clock (ms since its match start). */
  t: number;
  /** Packed trucks. */
  k: number[][];
}

/** A weapon/ram hit the attacker detected: the victim's owner applies it. */
export interface HitMsg {
  /** Attacker seat, victim seat. */
  a: number;
  v: number;
  /** Damage ×10. */
  d: number;
  /** Impulse (N·s ×10, per unit mass) and point (cm). */
  i: [number, number, number];
  p: [number, number, number];
  /** Weapon/cause code (see HIT_KIND). */
  w: number;
}

export const HIT_KIND = ["ram", "spinner", "flipper", "hammer", "flamer", "saw", "vent", "pulverizer"] as const;
export type HitKind = (typeof HIT_KIND)[number];

export interface KoMsg {
  /** Victim seat; attacker seat or -1; cause code (see KO_CAUSE); victim's match clock (ms). */
  v: number;
  a: number;
  c: number;
  t: number;
}

export const KO_CAUSE = ["wreck", "pit", "hazard", "dc"] as const;
export type KoCause = (typeof KO_CAUSE)[number];

/** Round over: one entry per truck the sender owns — [seat, hp·10, armor·10, dmg, alive 0/1, koAt]. */
export interface FinMsg {
  r: number;
  k: number[][];
}

export function encodeHit(h: {
  attacker: number;
  victim: number;
  damage: number;
  impulse: [number, number, number];
  point: [number, number, number];
  kind: HitKind;
}): HitMsg {
  return {
    a: h.attacker,
    v: h.victim,
    d: Math.round(Math.max(0, h.damage) * 10),
    i: [Math.round(h.impulse[0] * 10), Math.round(h.impulse[1] * 10), Math.round(h.impulse[2] * 10)],
    p: [Math.round(h.point[0] * 100), Math.round(h.point[1] * 100), Math.round(h.point[2] * 100)],
    w: Math.max(0, HIT_KIND.indexOf(h.kind)),
  };
}

export function decodeHit(raw: unknown): {
  attacker: number;
  victim: number;
  damage: number;
  impulse: [number, number, number];
  point: [number, number, number];
  kind: HitKind;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Partial<HitMsg>;
  const nums = [m.a, m.v, m.d, ...(Array.isArray(m.i) ? m.i : []), ...(Array.isArray(m.p) ? m.p : []), m.w];
  if (nums.length !== 10 || nums.some((n) => typeof n !== "number" || !Number.isFinite(n))) return null;
  const i = m.i as number[];
  const p = m.p as number[];
  return {
    attacker: m.a as number,
    victim: m.v as number,
    // A hit can't do more than a full-rev spinner + a bit: clamp what peers claim.
    damage: Math.min(40, Math.max(0, (m.d as number) / 10)),
    impulse: [i[0]! / 10, i[1]! / 10, i[2]! / 10],
    point: [p[0]! / 100, p[1]! / 100, p[2]! / 100],
    kind: HIT_KIND[m.w as number] ?? "ram",
  };
}

/* ---------------------------------------------------------------------- */
/* Netcode: interpolation                                                 */
/* ---------------------------------------------------------------------- */

export interface Snapshot {
  /** Sender clock (ms). */
  t: number;
  s: NetTruck;
}

/** Inserts a snapshot in time order (dropping duplicates/stale ones) and trims to `max`. */
export function pushSnapshot(buffer: Snapshot[], snap: Snapshot, max = 24): void {
  const last = buffer[buffer.length - 1];
  if (!last || snap.t > last.t) {
    buffer.push(snap);
  } else {
    if (buffer.some((b) => b.t === snap.t)) return;
    const at = buffer.findIndex((b) => b.t > snap.t);
    buffer.splice(at < 0 ? buffer.length : at, 0, snap);
  }
  if (buffer.length > max) buffer.splice(0, buffer.length - max);
}

/**
 * Tracks the offset between a sender's clock and ours (local receive time −
 * sender time). Uses the smallest seen (least delayed) sample, drifting up
 * slowly so a long-past lag spike doesn't pin it.
 */
export function updateClockOffset(prev: number | null, sample: number): number {
  if (prev === null || sample < prev) return sample;
  return prev + (sample - prev) * 0.02;
}

/**
 * The replicated state at sender time `t`: interpolated between the two
 * snapshots around it (position lerp, rotation nlerp), or extrapolated from
 * the newest by its velocity for up to EXTRAPOLATE_MS. Writes into `out`.
 * Returns false when the buffer is empty.
 */
export function sampleSnapshots(buffer: readonly Snapshot[], t: number, out: NetTruck): boolean {
  const n = buffer.length;
  if (n === 0) return false;
  const first = buffer[0]!;
  const last = buffer[n - 1]!;
  if (t <= first.t) {
    Object.assign(out, first.s);
    return true;
  }
  if (t >= last.t) {
    const dt = Math.min(t - last.t, EXTRAPOLATE_MS) / 1000;
    Object.assign(out, last.s);
    out.x = last.s.x + last.s.vx * dt;
    out.y = last.s.y + last.s.vy * dt;
    out.z = last.s.z + last.s.vz * dt;
    return true;
  }
  let i = n - 2;
  while (i > 0 && buffer[i]!.t > t) i--;
  const a = buffer[i]!;
  const b = buffer[i + 1]!;
  const k = (t - a.t) / Math.max(1, b.t - a.t);
  out.x = lerp(a.s.x, b.s.x, k);
  out.y = lerp(a.s.y, b.s.y, k);
  out.z = lerp(a.s.z, b.s.z, k);
  out.vx = lerp(a.s.vx, b.s.vx, k);
  out.vy = lerp(a.s.vy, b.s.vy, k);
  out.vz = lerp(a.s.vz, b.s.vz, k);
  // nlerp along the short arc
  const dot = a.s.qx * b.s.qx + a.s.qy * b.s.qy + a.s.qz * b.s.qz + a.s.qw * b.s.qw;
  const sb = dot < 0 ? -1 : 1;
  let qx = lerp(a.s.qx, b.s.qx * sb, k);
  let qy = lerp(a.s.qy, b.s.qy * sb, k);
  let qz = lerp(a.s.qz, b.s.qz * sb, k);
  let qw = lerp(a.s.qw, b.s.qw * sb, k);
  const len = Math.hypot(qx, qy, qz, qw) || 1;
  qx /= len;
  qy /= len;
  qz /= len;
  qw /= len;
  out.qx = qx;
  out.qy = qy;
  out.qz = qz;
  out.qw = qw;
  // Discrete fields come from the nearer snapshot.
  const near = k < 0.5 ? a.s : b.s;
  out.hp = Math.min(a.s.hp, b.s.hp);
  out.armor = Math.min(a.s.armor, b.s.armor);
  out.weapon = lerp(a.s.weapon, b.s.weapon, k);
  out.flags = near.flags;
  out.loadout = b.s.loadout;
  out.dmg = b.s.dmg;
  return true;
}

export function emptyNetTruck(): NetTruck {
  return { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, vx: 0, vy: 0, vz: 0, hp: HP_MAX, armor: 0, weapon: 0, flags: 0, loadout: 0, dmg: 0 };
}

/**
 * Token bucket that mirrors the SDK's room budget (30 msg/s), with headroom
 * for events: state packets only go out while at least `reserve` tokens are
 * left, so hits and KOs are never the ones dropped.
 */
export class SendBudget {
  private tokens: number;
  private at: number;
  constructor(
    private readonly perSecond = 28,
    now = 0,
  ) {
    this.tokens = perSecond;
    this.at = now;
  }
  take(now: number, reserve = 0): boolean {
    this.tokens = Math.min(this.perSecond, this.tokens + ((now - this.at) / 1000) * this.perSecond);
    this.at = now;
    if (this.tokens < 1 + reserve) return false;
    this.tokens -= 1;
    return true;
  }
}

/* ---------------------------------------------------------------------- */
/* Bot brain                                                              */
/* ---------------------------------------------------------------------- */

export interface BotTarget {
  id: string;
  x: number;
  z: number;
  vx: number;
  vz: number;
  alive: boolean;
}

export interface BotSense {
  /** Match time (s). */
  t: number;
  x: number;
  z: number;
  yaw: number;
  /** Forward speed (m/s, negative when reversing). */
  speed: number;
  weapon: WeaponKind;
  /** Weapon can fire now. */
  ready: boolean;
  /** Boost tank 0..1. */
  boost: number;
  flipped: boolean;
  /** 0..1 */
  skill: number;
  targets: BotTarget[];
  /** Active danger zones to steer clear of (saws up, vents firing…). */
  dangers: { x: number; z: number; r: number }[];
}

export interface BotMemory {
  targetId: string | null;
  retargetAt: number;
  stuckFor: number;
  reverseUntil: number;
  strafe: 1 | -1;
  /** Aim error (rad) re-rolled now and then; bigger for weaker bots. */
  aimError: number;
  aimAt: number;
  lastT: number;
  /** Hold fire for flamers (s). */
  fireUntil: number;
}

export function newBotMemory(): BotMemory {
  return { targetId: null, retargetAt: 0, stuckFor: 0, reverseUntil: 0, strafe: 1, aimError: 0, aimAt: 0, lastT: 0, fireUntil: 0 };
}

export interface BotControls {
  throttle: number;
  steer: number;
  fire: boolean;
  boost: boolean;
  selfRight: boolean;
}

/** Weapon engagement: fire within `dist` and when the target is within `angle` (rad) of the nose. */
const ENGAGE: Record<WeaponKind, { dist: number; angle: number; circle: number }> = {
  spinner: { dist: 4.2, angle: 0.5, circle: 0 },
  flipper: { dist: 3.1, angle: 0.32, circle: 0 },
  hammer: { dist: 3.3, angle: 0.3, circle: 0 },
  flamer: { dist: 5.8, angle: 0.3, circle: 5 },
};

/**
 * One decision for a bot. Seeks the nearest live truck (sticky for a few
 * seconds), circle-strafes with a flamethrower, fires when the weapon's
 * range and angle line up, boosts on long straights, steers away from the
 * pit, walls and live hazards, backs out when stuck, and self-rights when
 * flipped. `rand` (0..1) makes it deterministic in tests. Mutates `mem`.
 */
export function botDecide(sense: BotSense, mem: BotMemory, rand: () => number): BotControls {
  const out: BotControls = { throttle: 0, steer: 0, fire: false, boost: false, selfRight: false };
  const dt = Math.max(0, Math.min(0.5, sense.t - mem.lastT));
  mem.lastT = sense.t;

  if (sense.flipped) {
    out.selfRight = true;
    return out;
  }

  // Target choice: nearest live truck, re-evaluated every ~3 s.
  const live = sense.targets.filter((t) => t.alive);
  let target = live.find((t) => t.id === mem.targetId);
  if (!target || sense.t >= mem.retargetAt) {
    let best: BotTarget | undefined;
    let bestD = Infinity;
    for (const t of live) {
      const d = Math.hypot(t.x - sense.x, t.z - sense.z) + (t.id === mem.targetId ? -3 : 0);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    target = best;
    mem.targetId = best?.id ?? null;
    mem.retargetAt = sense.t + 2.5 + rand() * 2;
    if (rand() < 0.5) mem.strafe = mem.strafe === 1 ? -1 : 1;
  }

  if (sense.t >= mem.aimAt) {
    mem.aimError = (rand() * 2 - 1) * (1 - sense.skill) * 0.35;
    mem.aimAt = sense.t + 0.6 + rand() * 0.8;
  }

  const fx = Math.sin(sense.yaw);
  const fz = Math.cos(sense.yaw);

  // Where do we want to go?
  let gx = 0;
  let gz = 0;
  let dist = Infinity;
  let aimOff = Math.PI;
  const eng = ENGAGE[sense.weapon];
  if (target) {
    // Lead the target a little (better bots lead more).
    const lead = 0.15 + sense.skill * 0.35;
    const tx = target.x + target.vx * lead;
    const tz = target.z + target.vz * lead;
    dist = Math.hypot(target.x - sense.x, target.z - sense.z);
    aimOff = Math.abs(wrapAngle(Math.atan2(target.x - sense.x, target.z - sense.z) - sense.yaw));
    if (eng.circle > 0 && dist < eng.circle + 2) {
      // Circle-strafe: aim at a point on a ring around the target, ahead of us.
      const ang = Math.atan2(sense.x - tx, sense.z - tz) + mem.strafe * 0.9;
      gx = tx + Math.sin(ang) * eng.circle * 0.7 - sense.x;
      gz = tz + Math.cos(ang) * eng.circle * 0.7 - sense.z;
      // …but keep the nose on them when close enough to burn.
      if (dist < eng.dist) {
        gx = tx - sense.x;
        gz = tz - sense.z;
      }
    } else {
      gx = tx - sense.x;
      gz = tz - sense.z;
    }
  } else {
    // Nobody left: idle in a lazy circle away from the pit.
    gx = -sense.x + Math.sin(sense.t * 0.3) * 8;
    gz = -sense.z + Math.cos(sense.t * 0.3) * 8 + 10;
  }

  // Avoidance: pit, walls, hazards. Sample a point ahead and push away.
  const look = 2.5 + Math.max(0, sense.speed) * 0.35;
  const ax = sense.x + fx * look;
  const az = sense.z + fz * look;
  let avx = 0;
  let avz = 0;
  const { pit, half } = { pit: ARENA.pit, half: ARENA.half };
  const pitMargin = 2.2 - sense.skill * 0.8;
  if (overPit(ax, az, pitMargin) || overPit(sense.x, sense.z, pitMargin * 0.6)) {
    const px = sense.x - pit.x;
    const pz = sense.z - pit.z;
    const d = Math.hypot(px, pz) || 1;
    avx += (px / d) * 6;
    avz += (pz / d) * 6;
  }
  const wall = half - 2.5;
  if (Math.abs(ax) > wall) avx -= Math.sign(ax) * 5;
  if (Math.abs(az) > wall) avz -= Math.sign(az) * 5;
  for (const h of sense.dangers) {
    const d = Math.hypot(ax - h.x, az - h.z);
    if (d < h.r + 1.5) {
      avx += ((ax - h.x) / (d || 1)) * 5;
      avz += ((az - h.z) / (d || 1)) * 5;
    }
  }
  const gl = Math.hypot(gx, gz) || 1;
  const wantX = (gx / gl) * 4 + avx;
  const wantZ = (gz / gl) * 4 + avz;
  const want = Math.atan2(wantX, wantZ) + mem.aimError;
  const err = wrapAngle(want - sense.yaw);

  // Steering: proportional, sharper for skilled bots. +steer turns right, which
  // lowers the yaw (yaw grows toward +X, i.e. to the left of a truck facing +Z).
  const gain = 1.6 + sense.skill * 1.4;
  out.steer = Math.max(-1, Math.min(1, -err * gain));
  out.throttle = Math.abs(err) > 2.2 ? 0.4 : 1 - Math.min(0.45, Math.abs(err) * 0.25);

  // Don't overshoot a close melee target: ease off right in front of it.
  if (target && dist < 2.2 && sense.weapon !== "spinner") out.throttle = Math.min(out.throttle, 0.35);

  // Stuck? (pushing but not moving) → back out with the wheel turned.
  if (Math.abs(sense.speed) < 0.6 && out.throttle > 0.3) mem.stuckFor += dt;
  else mem.stuckFor = Math.max(0, mem.stuckFor - dt * 2);
  if (mem.stuckFor > 1.1) {
    mem.reverseUntil = sense.t + 0.8 + rand() * 0.5;
    mem.stuckFor = 0;
  }
  if (sense.t < mem.reverseUntil) {
    out.throttle = -0.9;
    out.steer = -out.steer || mem.strafe;
  }

  // Weapon.
  if (target && sense.ready) {
    const inAngle = aimOff < eng.angle + (1 - sense.skill) * 0.15;
    if (dist < eng.dist && inAngle && rand() < 0.35 + sense.skill * 0.6) {
      out.fire = true;
      if (sense.weapon === "flamer") mem.fireUntil = sense.t + 0.8 + sense.skill;
    }
  }
  if (sense.weapon === "flamer" && sense.t < mem.fireUntil && target && dist < eng.dist + 1) out.fire = true;

  // Boost on the straights.
  if (target && dist > 9 && aimOff < 0.25 && sense.boost > 0.4 && sense.t >= mem.reverseUntil && rand() < 0.2 + sense.skill * 0.5) {
    out.boost = true;
  }
  return out;
}

/* ---------------------------------------------------------------------- */
/* Progress: stats & achievements                                         */
/* ---------------------------------------------------------------------- */

export type WedgeAchievement =
  | "first_win"
  | "first_blood"
  | "flipped"
  | "pit_boss"
  | "untouchable"
  | "flamed_out"
  | "hammer_time"
  | "last_standing"
  | "pulverized";

/** What one player did in a match (built by the game from its own view). */
export interface MatchLog {
  players: number;
  rank: number;
  weapon: WeaponKind;
  /** HP left at the end (0 when KO'd). */
  hpLeft: number;
  dmgDealt: number;
  kos: number;
  /** Did this player land the match's first KO? */
  firstKo: boolean;
  pitKos: number;
  flameKos: number;
  hammerHits: number;
  /** Highest an opponent flew after one of your flips (cm above where it started). */
  bestFlipCm: number;
  pulverized: boolean;
}

/** Launch height that earns "Flipped!". */
export const FLIP_ACHIEVEMENT_CM = 200;

export function earnedAchievements(log: MatchLog): WedgeAchievement[] {
  const out: WedgeAchievement[] = [];
  const won = log.rank === 1;
  if (won) out.push("first_win");
  if (log.firstKo) out.push("first_blood");
  if (log.bestFlipCm >= FLIP_ACHIEVEMENT_CM) out.push("flipped");
  if (log.pitKos > 0) out.push("pit_boss");
  if (won && log.hpLeft > HP_MAX * 0.75) out.push("untouchable");
  if (log.flameKos > 0) out.push("flamed_out");
  if (log.hammerHits >= 5) out.push("hammer_time");
  if (won && log.players >= 4) out.push("last_standing");
  if (log.pulverized) out.push("pulverized");
  return out;
}

export function finalStats(log: MatchLog): { damage_dealt: number; kos: number; wins: number; best_flip?: number } {
  const stats: { damage_dealt: number; kos: number; wins: number; best_flip?: number } = {
    damage_dealt: Math.round(Math.max(0, log.dmgDealt)),
    kos: log.kos,
    wins: log.rank === 1 ? 1 : 0,
  };
  if (log.bestFlipCm > 0) stats.best_flip = Math.round(log.bestFlipCm);
  return stats;
}

/* ---------------------------------------------------------------------- */
/* Small math                                                             */
/* ---------------------------------------------------------------------- */

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.floor(Number.isFinite(v) ? v : lo)));
}

export function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}

export function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** Frame-rate independent exponential smoothing factor. */
export function damp(lambda: number, dt: number): number {
  return 1 - Math.exp(-lambda * dt);
}

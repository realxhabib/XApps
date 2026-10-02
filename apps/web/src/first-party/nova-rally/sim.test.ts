import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { AiPilot } from "./ai";
import { DT, Ship, tuningFor } from "./physics";
import { compileTrack, deltaS, hasWall, newFrame, trackPoint, wrapS, type CompiledTrack } from "./track";
import { ARENAS, TRACKS } from "./tracks";

function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("a CPU pilot laps every track", () => {
  for (const def of [...TRACKS, ...ARENAS]) {
    it(def.name, () => {
      const track = compileTrack(def);
      const g = track.grid(0);
      const ship = new Ship(track, tuningFor({ speed: 3, accel: 3, handling: 3, weight: 3 }), g.s, g.d);
      const ai = new AiPilot(0.8, mulberry(3));
      let progress = 0;
      let falls = 0;
      let walls = 0;
      let turbos = 0;
      let maxSpeed = 0;
      for (let i = 0; i < 90 * 60; i++) {
        const prev = ship.s;
        const dec = ai.think(ship, { track, others: [], dangers: [], boxes: [], threatened: false, item: null, place: 0, field: 1 }, DT);
        ship.step(dec.controls);
        for (const e of ship.events) {
          if (e.type === "fall") { falls++; console.log("fall at", (ship.s).toFixed(0), "node", "speed", ship.speed.toFixed(0), "d", ship.d.toFixed(1), "h", ship.h.toFixed(1)); }
          if (e.type === "wall") walls++;
          if (e.type === "turbo") turbos++;
        }
        if (ship.state !== "tow" && ship.state !== "fall") progress += deltaS(prev, ship.s, track.length);
        maxSpeed = Math.max(maxSpeed, ship.speed);
      }
      const laps = progress / track.length;
      console.log(`${def.name}: length ${track.length.toFixed(0)} laps/90s ${laps.toFixed(3)} falls ${falls} walls ${walls} turbos ${turbos} max ${maxSpeed.toFixed(0)}`);
      expect(laps).toBeGreaterThan(2.2);
      expect(falls).toBeLessThanOrEqual(1);
    });
  }
});

/**
 * Sample indices of a track's tightest corners: at least 150 units apart, at least `minRatio` as tight as the
 * tightest one, clear of ramps (the drift has to start on the ground) and on a road that faces up (no
 * corkscrews or loops, where "turning" isn't a flat curve). Tightest first.
 */
function tightCorners(track: CompiledTrack, n: number, minRatio = 0.6): number[] {
  const max = Math.max(...Array.from(track.curve, Math.abs));
  const order = Array.from({ length: track.count }, (_, i) => i).sort((a, b) => Math.abs(track.curve[b]!) - Math.abs(track.curve[a]!));
  const out: number[] = [];
  for (const i of order) {
    if (Math.abs(track.curve[i]!) < max * minRatio || out.length === n) break;
    const s = i * track.step;
    const apart = out.every((j) => Math.min(Math.abs(i - j), track.count - Math.abs(i - j)) * track.step > 150);
    const ramp = track.ramps.some((r) => Math.abs(deltaS(s, r.s, track.length)) < 120);
    let flat = true;
    for (let k = -80; k <= 80; k++) flat &&= track.up[(((i + k) % track.count) + track.count) % track.count * 3 + 1]! > 0.85;
    if (apart && !ramp && flat) out.push(i);
  }
  return out;
}

describe("holding a drift through the tightest corners", () => {
  for (const def of TRACKS) {
    const track = compileTrack(def);
    const corners = tightCorners(track, 3);
    it(`${def.name} has corners to test`, () => expect(corners.length).toBeGreaterThan(0));
    for (const [rank, apex] of corners.entries()) {
      for (const style of ["line", "full"] as const) {
        it(`${def.name} corner #${rank + 1}, ${style === "line" ? "steering the racing line" : "full lock into the turn"}`, () => {
          const apexS = apex * track.step;
          const dir = Math.sign(track.curve[apex]!) as 1 | -1;
          const ship = new Ship(track, tuningFor({ speed: 3, accel: 3, handling: 3, weight: 3 }), apexS - 70, 0);
          ship.speed = ship.tune.top;
          const f = newFrame();
          const target = new Vector3();
          const cross = new Vector3();
          const seconds = 3;
          let progress = 0;
          let outerHits = 0;
          let cornerSpeed = Infinity;
          let cornerOffroad = 0;
          for (let i = 0; i < seconds * 60; i++) {
            // A player aiming at the racing line a little way ahead, holding drift from just before the corner.
            const look = 14 + ship.speed * 0.42;
            const li = Math.floor(wrapS(ship.s + look, track.length) / track.step) % track.count;
            trackPoint(track, ship.s + look, track.line[li]! * track.halfWidth[li]! * 0.8, 0, target, f);
            target.sub(ship.pos);
            const up = ship.frame.up;
            target.addScaledVector(up, -target.dot(up));
            const err = Math.atan2(-cross.crossVectors(ship.fwd, target).dot(up), ship.fwd.dot(target));
            const gap = deltaS(ship.s, apexS, track.length);
            const drift = gap < 45 || ship.driftDir !== 0;
            const steer = drift && (ship.driftDir === 0 || style === "full") ? dir : Math.max(-1, Math.min(1, err * 3));
            const prev = ship.s;
            ship.step({ steer, throttle: 1, brake: 0, drift });
            progress += deltaS(prev, ship.s, track.length);
            if (Math.abs(gap) < 40) {
              for (const e of ship.events) if (e.type === "wall" && e.side === -dir) outerHits++;
              cornerSpeed = Math.min(cornerSpeed, ship.speed);
              if (ship.offroad) cornerOffroad++;
            }
            const side = ship.d > 0 ? 1 : -1;
            if (hasWall(track, ship.s, side)) expect(Math.abs(ship.d), `past the rail at s=${ship.s.toFixed(0)}`).toBeLessThanOrEqual(ship.frame.wallOffset);
            expect(Math.abs(ship.headingError), `facing backward at s=${ship.s.toFixed(0)}`).toBeLessThan(Math.PI / 2);
          }
          expect(ship.driftDir, "the drift survived").toBe(dir);
          expect(ship.driftTier, "a mini-turbo charged").toBeGreaterThanOrEqual(1);
          expect(progress, "forward progress").toBeGreaterThan(ship.tune.top * seconds * 0.6);
          if (style === "line") {
            // Holding the line: no slide into the outer rail, on the road and at speed all the way round.
            expect(outerHits, "slid into the outer rail").toBe(0);
            expect(cornerOffroad, "frames off the road in the corner").toBe(0);
            expect(cornerSpeed).toBeGreaterThan(ship.tune.top * 0.85);
          }
        });
      }
    }
  }
});

describe("drifting into the rail", () => {
  for (const def of TRACKS) {
    it(`${def.name}: the rail pushes back softly and keeps the drift`, () => {
      const track = compileTrack(def);
      const ship = new Ship(track, tuningFor({ speed: 3, accel: 3, handling: 3, weight: 3 }), 30, 0);
      ship.speed = ship.tune.top;
      let walls = 0;
      let onRail = 0;
      let minSpeed = Infinity;
      // Hold a right drift at full lock on the opening straight: the nose swings into the right rail.
      for (let i = 0; i < 2.5 * 60; i++) {
        ship.step({ steer: 1, throttle: 1, brake: 0, drift: true });
        for (const e of ship.events) if (e.type === "wall") walls++;
        if (ship.railContact !== 0) onRail++;
        minSpeed = Math.min(minSpeed, ship.speed);
        if (hasWall(track, ship.s, ship.d > 0 ? 1 : -1)) expect(Math.abs(ship.d)).toBeLessThanOrEqual(ship.frame.wallOffset);
        expect(Math.abs(ship.headingError)).toBeLessThan(Math.PI / 2);
      }
      expect(walls).toBeGreaterThan(0);
      expect(ship.driftDir).toBe(1);
      // Each contact costs a capped amount and pushes the ship off, so scraping along never bleeds it below
      // the shoulder's own offroad pace.
      expect(minSpeed).toBeGreaterThan(ship.tune.top * 0.5);
      expect(onRail / 150, "share of frames on the rail").toBeLessThan(0.25);
    });
  }
});

describe("a held drift with neutral or outward steering stays off the outer rail", () => {
  for (const def of TRACKS) {
    const track = compileTrack(def);
    const corners = tightCorners(track, 3, 0);
    it(`${def.name} has 3 corners to test`, () => expect(corners.length).toBe(3));
    for (const [rank, apex] of corners.entries()) {
      for (const style of ["neutral", "outward"] as const) {
        it(`${def.name} corner #${rank + 1}, ${style} steering`, () => {
          const apexS = apex * track.step;
          const dir = Math.sign(track.curve[apex]!) as 1 | -1;
          const startS = apexS - 70;
          const si = Math.floor(wrapS(startS, track.length) / track.step) % track.count;
          const ship = new Ship(track, tuningFor({ speed: 3, accel: 3, handling: 3, weight: 3 }), startS, track.line[si]! * track.halfWidth[si]! * 0.8);
          ship.speed = ship.tune.top;
          const f = newFrame();
          const target = new Vector3();
          const cross = new Vector3();
          // Follow the racing line up to the corner, then flick into a drift and hold it for 3 s.
          let held = 0;
          let frames = 0;
          let speedSum = 0;
          let onRail = 0;
          let left = false;
          let minSpeed = Infinity;
          for (let i = 0; i < 6 * 60 && held < 3 * 60; i++) {
            const gap = deltaS(ship.s, apexS, track.length);
            let steer: number;
            let drift = false;
            if (ship.driftDir !== 0) {
              drift = true;
              steer = style === "neutral" ? 0 : -dir;
            } else if (gap < 45 && held === 0) {
              drift = true;
              steer = dir;
            } else {
              const look = 14 + ship.speed * 0.42;
              const li = Math.floor(wrapS(ship.s + look, track.length) / track.step) % track.count;
              trackPoint(track, ship.s + look, track.line[li]! * track.halfWidth[li]! * 0.8, 0, target, f);
              target.sub(ship.pos);
              const up = ship.frame.up;
              target.addScaledVector(up, -target.dot(up));
              const err = Math.atan2(-cross.crossVectors(ship.fwd, target).dot(up), ship.fwd.dot(target));
              steer = Math.max(-1, Math.min(1, err * 3));
            }
            if (drift && (held > 0 || ship.driftDir !== 0)) held++;
            ship.step({ steer, throttle: 1, brake: 0, drift });
            if (held === 0) continue;
            for (const e of ship.events) if (e.type === "fall") left = true;
            if (ship.state === "fall" || ship.state === "tow" || Math.abs(ship.d) > ship.frame.wallOffset + 0.5) left = true;
            // An outward full-lock slide may run off an open edge; measure up to that point.
            if (left) break;
            frames++;
            speedSum += ship.speed;
            minSpeed = Math.min(minSpeed, ship.speed);
            if (ship.railContact !== 0) onRail++;
          }
          const avg = speedSum / Math.max(1, frames);
          console.log(
            `drift-hold ${def.name} #${rank + 1} ${style}: avg ${((avg / ship.tune.top) * 100).toFixed(0)}% min ${((minSpeed / ship.tune.top) * 100).toFixed(0)}% rail ${((onRail / Math.max(1, frames)) * 100).toFixed(0)}% frames ${frames}${left ? " LEFT" : ""}`,
          );
          expect(held, "the drift was held").toBeGreaterThan(60);
          if (style === "neutral") expect(left, "left the track").toBe(false);
          expect(avg, "average speed").toBeGreaterThan(ship.tune.top * 0.75);
          expect(onRail / Math.max(1, frames), "share of frames on the rail").toBeLessThan(0.25);
        });
      }
    }
  }
});

describe("open edges while drifting", () => {
  for (const def of TRACKS) {
    const track = compileTrack(def);
    const at = (k: number) => (k + track.count) % track.count;
    const run = Math.round(60 / track.step);
    // Starts of open, floored stretches that run on for a while, on the outside of the bend (or straight).
    const cases: { start: number; edge: -1 | 1 }[] = [];
    for (const edge of [-1, 1] as const) {
      const bit = edge === -1 ? 1 : 2;
      const open = (k: number) => (track.open[at(k)]! & bit) !== 0 && track.floor[at(k)] === 1;
      for (let i = 0; i < track.count; i++) {
        if (!open(i) || open(i - 1) || !Array.from({ length: run }, (_, k) => open(i + k)).every(Boolean)) continue;
        const bend = track.curve[at(i + run / 2)]!;
        if (Math.abs(bend) < 0.003 || edge === (bend > 0 ? -1 : 1)) cases.push({ start: i, edge });
      }
    }
    for (const { start, edge } of cases) {
      for (const style of ["neutral", "outward"] as const) {
        it(`${def.name} at s=${(start * track.step).toFixed(0)}, ${edge < 0 ? "left" : "right"} edge: ${style === "neutral" ? "a neutral drift stays on" : "full outward lock slides off"}`, () => {
          const hw = track.halfWidth[start]!;
          const ship = new Ship(track, tuningFor({ speed: 3, accel: 3, handling: 3, weight: 3 }), start * track.step + 6, edge * (hw - 2));
          ship.speed = ship.tune.top;
          // Heading for the open edge, then flick into a drift whose outside is that edge.
          ship.fwd.applyAxisAngle(ship.frame.up, -edge * 0.3);
          ship.vdir.copy(ship.fwd);
          let fell = false;
          for (let i = 0; i < 1.5 * 60; i++) {
            const steer = i === 0 ? -edge : style === "neutral" ? 0 : edge;
            ship.step({ steer, throttle: 1, brake: 0, drift: true });
            if (ship.events.some((e) => e.type === "fall") || ship.state === "fall") fell = true;
            if (!fell) expect(ship.driftDir).toBe(-edge);
          }
          expect(fell).toBe(style === "outward");
        });
      }
    }
  }
});

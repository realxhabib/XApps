import { describe, expect, it } from "vitest";
import { AiPilot } from "./ai";
import { DT, Ship, tuningFor } from "./physics";
import { compileTrack, deltaS } from "./track";
import { TRACKS } from "./tracks";

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
  for (const def of TRACKS) {
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
      console.log(`${def.name}: length ${track.length.toFixed(0)} laps/90s ${laps.toFixed(2)} falls ${falls} walls ${walls} turbos ${turbos} max ${maxSpeed.toFixed(0)}`);
      expect(laps).toBeGreaterThan(2.2);
      expect(falls).toBeLessThanOrEqual(1);
    });
  }
});

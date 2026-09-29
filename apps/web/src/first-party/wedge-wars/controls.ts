/**
 * Player input: keyboard (WASD/arrows, Space, Shift, R), the first gamepad
 * (left stick / triggers, A fire, B boost, Y self-right) and the on-screen
 * touch controls, merged into one `Controls` value each frame.
 */

import type { Controls } from "./world";

export interface TouchState {
  /** Stick deflection −1..1 (x = right, y = forward). */
  x: number;
  y: number;
  fire: boolean;
  boost: boolean;
  selfRight: boolean;
}

const DRIVE_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Space",
  "ShiftLeft",
  "ShiftRight",
  "KeyR",
]);

export class Input {
  private readonly keys = new Set<string>();
  readonly touch: TouchState = { x: 0, y: 0, fire: false, boost: false, selfRight: false };
  /** Set once the player has pressed anything (hides the controls hint). */
  touched = false;
  /** Pause toggle requests (Escape / P / gamepad Start). */
  private pauseListeners = new Set<() => void>();
  private startWasDown = false;
  private detach: (() => void) | null = null;

  attach(): void {
    if (this.detach || typeof window === "undefined") return;
    const down = (e: KeyboardEvent) => {
      if (e.code === "Escape" || e.code === "KeyP") {
        this.pauseListeners.forEach((l) => l());
        return;
      }
      if (!DRIVE_KEYS.has(e.code)) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      e.preventDefault();
      this.keys.add(e.code);
      this.touched = true;
    };
    const up = (e: KeyboardEvent) => {
      this.keys.delete(e.code);
    };
    const blur = () => this.keys.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    this.detach = () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }

  dispose(): void {
    this.detach?.();
    this.detach = null;
    this.keys.clear();
  }

  /** Touch stick (−1..1, y = forward). */
  setStick(x: number, y: number): void {
    this.touch.x = x;
    this.touch.y = y;
  }

  setButton(name: "fire" | "boost" | "selfRight", down: boolean): void {
    this.touch[name] = down;
    if (down) this.touched = true;
  }

  onPause(listener: () => void): () => void {
    this.pauseListeners.add(listener);
    return () => this.pauseListeners.delete(listener);
  }

  /** Writes the merged controls into `out`. */
  read(out: Controls): void {
    const k = this.keys;
    let throttle = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    let steer = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    let fire = k.has("Space");
    let boost = k.has("ShiftLeft") || k.has("ShiftRight");
    let selfRight = k.has("KeyR");

    // Touch stick: forward/back from y, steering from x.
    const t = this.touch;
    if (Math.abs(t.x) > 0.05 || Math.abs(t.y) > 0.05) {
      throttle = Math.abs(t.y) > 0.18 ? Math.sign(t.y) * Math.min(1, Math.abs(t.y) * 1.25) : Math.hypot(t.x, t.y) > 0.5 ? 0.35 : 0;
      steer = t.x * (t.y < -0.18 ? -1 : 1) * 1.1;
      this.touched = true;
    }
    fire ||= t.fire;
    boost ||= t.boost;
    selfRight ||= t.selfRight;

    // Gamepad.
    const pads = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads ? Array.from(pads).find((p) => p && p.connected) : null;
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
      if (Math.abs(dz(ax)) > 0) steer = dz(ax);
      if (rt > 0.05 || lt > 0.05) throttle = rt - lt;
      else if (Math.abs(dz(ay)) > 0) throttle = -dz(ay);
      if (pad.buttons[0]?.pressed || pad.buttons[5]?.pressed) fire = true;
      if (pad.buttons[1]?.pressed || pad.buttons[4]?.pressed) boost = true;
      if (pad.buttons[3]?.pressed) selfRight = true;
      const start = !!pad.buttons[9]?.pressed;
      if (start && !this.startWasDown) this.pauseListeners.forEach((l) => l());
      this.startWasDown = start;
      if (steer || throttle || fire || boost) this.touched = true;
    }

    out.throttle = Math.max(-1, Math.min(1, throttle));
    out.steer = Math.max(-1, Math.min(1, steer));
    out.fire = fire;
    out.boost = boost;
    out.selfRight = selfRight;
  }
}

/** True on touch-first devices (phones/tablets). */
export function isTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(pointer: coarse)").matches ?? "ontouchstart" in window;
}

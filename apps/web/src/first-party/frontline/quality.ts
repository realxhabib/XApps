/**
 * Render quality tiers. `auto` guesses from the device (GPU string, touch,
 * memory, cores), then the engine watches real frame times and steps down
 * (pixel ratio first, then shadows and draw distance) when it can't hold
 * the target. Players can pin a tier in the settings menu.
 */

export type Tier = "high" | "medium" | "low";
export type QualityPref = "auto" | Tier;

export interface TierSettings {
  /** Max device pixel ratio (the engine may go lower on its own). */
  dpr: number;
  /** Lowest the dynamic resolution may go. */
  minDpr: number;
  antialias: boolean;
  shadows: boolean;
  shadowMapSize: number;
  /** Fog end = draw distance (m). */
  far: number;
  /** Bullet-hole decals kept. */
  decals: number;
  /** Particle budget multiplier. */
  particles: number;
  skyline: boolean;
}

export const TIERS: Record<Tier, TierSettings> = {
  high: { dpr: 2, minDpr: 1, antialias: true, shadows: true, shadowMapSize: 2048, far: 170, decals: 96, particles: 1, skyline: true },
  medium: { dpr: 1.5, minDpr: 0.85, antialias: true, shadows: true, shadowMapSize: 1024, far: 130, decals: 64, particles: 0.7, skyline: true },
  low: { dpr: 1, minDpr: 0.6, antialias: false, shadows: false, shadowMapSize: 0, far: 90, decals: 32, particles: 0.45, skyline: false },
};

let guessed: Tier | null = null;

/** A first guess from what the browser says about the GPU and device. */
export function detectTier(): Tier {
  if (guessed) return guessed;
  let tier: Tier = "medium";
  try {
    const nav = navigator as Navigator & { deviceMemory?: number };
    const touch = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    const cores = nav.hardwareConcurrency ?? 4;
    const memory = nav.deviceMemory ?? 8;
    const renderer = gpuRenderer().toLowerCase();
    if (/swiftshader|llvmpipe|software|mesa offscreen|microsoft basic/.test(renderer)) tier = "low";
    else if (touch) tier = memory >= 6 && cores >= 8 && /apple gpu|adreno \(tm\) (7[3-9]|8)\d\d|immortalis/.test(renderer) ? "medium" : "low";
    else if (/nvidia|geforce|rtx|radeon rx|apple m\d|apple gpu/.test(renderer)) tier = "high";
    else if (/intel/.test(renderer)) tier = cores >= 8 ? "medium" : "low";
    else tier = cores >= 8 && memory >= 8 ? "high" : "medium";
  } catch {
    tier = "medium";
  }
  guessed = tier;
  return tier;
}

function gpuRenderer(): string {
  const c = document.createElement("canvas");
  const gl = (c.getContext("webgl2") ?? c.getContext("webgl")) as WebGLRenderingContext | null;
  if (!gl) return "software";
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  const name = ext ? (gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string) : (gl.getParameter(gl.RENDERER) as string);
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return name ?? "";
}

export function lower(tier: Tier): Tier {
  return tier === "high" ? "medium" : "low";
}

/**
 * Dynamic resolution: fed frame times, it nudges the pixel ratio down when
 * frames run long (and back up slowly when there's headroom), within the
 * tier's range. Returns a new ratio when it changed, else null.
 */
export class FrameGovernor {
  private acc = 0;
  private frames = 0;
  private warm = 0;
  private lowStreak = 0;
  ratio: number;

  constructor(
    private max: number,
    private min: number,
    private readonly targetFps = 55,
  ) {
    this.ratio = max;
  }

  setRange(max: number, min: number): void {
    this.max = max;
    this.min = min;
    this.ratio = Math.min(Math.max(this.ratio, min), max);
  }

  /** Called when a whole tier step is warranted (resolution already at its floor for a while). */
  onGiveUp: (() => void) | null = null;

  sample(dt: number): number | null {
    this.warm += dt;
    if (this.warm < 2) return null;
    this.acc += dt;
    this.frames++;
    if (this.acc < 1.5) return null;
    const fps = this.frames / this.acc;
    this.acc = 0;
    this.frames = 0;
    const before = this.ratio;
    if (fps < this.targetFps - 8) {
      this.ratio = Math.max(this.min, this.ratio * (fps < 35 ? 0.8 : 0.9));
      if (this.ratio === this.min && before === this.min) {
        this.lowStreak++;
        if (this.lowStreak >= 2) {
          this.lowStreak = 0;
          this.onGiveUp?.();
        }
      }
    } else if (fps > this.targetFps + 3) {
      this.lowStreak = 0;
      this.ratio = Math.min(this.max, this.ratio * 1.05);
    }
    this.ratio = Math.round(this.ratio * 100) / 100;
    return this.ratio !== before ? this.ratio : null;
  }
}

/**
 * Nova Rally ships: eight procedural rocket karts (plain three.js, no assets).
 *
 * Every model is built from lathed fuselages, bevelled extrusions and a few
 * primitives, merged into one mesh per material so a ship stays around twenty
 * draw calls. Local space: origin on the hover plane under the ship's centre,
 * nose toward −Z, up +Y, roughly 3.2 × 2 × 1 units. Flames, underglow, drift
 * sparks and the shield bubble are additive shader meshes owned by the model.
 */

import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Euler,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  type Material,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  type Texture,
  TorusGeometry,
  Vector2,
  Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Livery, ShipStats } from "./types";

/* ------------------------------------------------------------------ */
/* Catalogue                                                          */
/* ------------------------------------------------------------------ */

export interface ShipDesign {
  id: string;
  name: string;
  tagline: string;
  stats: ShipStats;
  livery: Livery;
}

export const SHIPS: readonly ShipDesign[] = [
  {
    id: "comet",
    name: "Comet",
    tagline: "Light, twitchy and first off the line",
    stats: { speed: 3, accel: 5, handling: 4, weight: 1 },
    livery: { primary: "#ff5a1f", secondary: "#fff4e4", glow: "#ffc93c" },
  },
  {
    id: "hammerhead",
    name: "Hammerhead",
    tagline: "Wide jaws, big bite, holds its line",
    stats: { speed: 4, accel: 3, handling: 2, weight: 4 },
    livery: { primary: "#1fcf6f", secondary: "#14283a", glow: "#b6ff3c" },
  },
  {
    id: "gemini",
    name: "Gemini",
    tagline: "Twin booms, twice the swagger",
    stats: { speed: 4, accel: 3, handling: 3, weight: 3 },
    livery: { primary: "#7a3cff", secondary: "#ffd23f", glow: "#d68cff" },
  },
  {
    id: "nebula-queen",
    name: "Nebula Queen",
    tagline: "Royal saucer, born to drift",
    stats: { speed: 3, accel: 3, handling: 5, weight: 2 },
    livery: { primary: "#ff4fa3", secondary: "#fff0f8", glow: "#ff8ae8" },
  },
  {
    id: "iron-moon",
    name: "Iron Moon",
    tagline: "Hauls freight. Hauls tail.",
    stats: { speed: 5, accel: 2, handling: 1, weight: 5 },
    livery: { primary: "#465064", secondary: "#ffb81c", glow: "#ff6a2a" },
  },
  {
    id: "pulsar",
    name: "Pulsar",
    tagline: "A needle with a star strapped on",
    stats: { speed: 5, accel: 3, handling: 3, weight: 2 },
    livery: { primary: "#1f6bff", secondary: "#eef4ff", glow: "#4de3ff" },
  },
  {
    id: "rosie",
    name: "Rosie Rocket",
    tagline: "Retro fins, modern attitude",
    stats: { speed: 3, accel: 4, handling: 3, weight: 3 },
    livery: { primary: "#f4ecd8", secondary: "#e8322f", glow: "#ffa53c" },
  },
  {
    id: "manta",
    name: "Midnight Manta",
    tagline: "Glides through corners like water",
    stats: { speed: 4, accel: 3, handling: 4, weight: 1 },
    livery: { primary: "#23265e", secondary: "#34f5a4", glow: "#3dffb0" },
  },
];

export const LIVERY_SWATCHES: readonly Livery[] = [
  { primary: "#e8262f", secondary: "#ffffff", glow: "#ff7b54" }, // Redline
  { primary: "#15c3e8", secondary: "#0e1f3d", glow: "#7ff6ff" }, // Ice Comet
  { primary: "#ffd21f", secondary: "#1a1a24", glow: "#ffea6b" }, // Bumblebee
  { primary: "#9dff3a", secondary: "#6a1fd6", glow: "#d3ff5c" }, // Toxic
  { primary: "#ff8ac9", secondary: "#7af4ff", glow: "#ffc2ea" }, // Candy
  { primary: "#1b1b22", secondary: "#ff3355", glow: "#ff2d6f" }, // Stealth
  { primary: "#f2f4f8", secondary: "#2a6bff", glow: "#6fb4ff" }, // Polar
  { primary: "#ff9a1f", secondary: "#2b134f", glow: "#ffcf5a" }, // Sunset
];

const RACE_NUMBERS: Record<string, number> = {
  comet: 7,
  hammerhead: 22,
  gemini: 2,
  "nebula-queen": 9,
  "iron-moon": 88,
  pulsar: 1,
  rosie: 50,
  manta: 13,
};

/* ------------------------------------------------------------------ */
/* Public model                                                       */
/* ------------------------------------------------------------------ */

export interface ShipModel {
  root: Group;
  body: Group;
  exhausts: Vector3[];
  setThrottle(throttle: number, boost: number, time: number): void;
  setDriftGlow(tier: 0 | 1 | 2 | 3): void;
  setShield(on: boolean, time: number): void;
  setGhost(alpha: number): void;
  dispose(): void;
}

type Quality = "high" | "low";
type V3 = readonly [number, number, number];
/** Profile point: [radius, forward] or top-view/side-view [a, b, cornerRadius?]. */
type P2 = readonly [number, number];
type P3 = readonly [number, number] | readonly [number, number, number];

const DRIFT_COLORS = ["#000000", "#3fa9ff", "#ff8a1f", "#c04bff"] as const;
const SHIELD_COLOR = "#72d8ff";
const BOOST_CORE = new Color("#d8f2ff");
const BOOST_OUTER = new Color("#58b8ff");

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                   */
/* ------------------------------------------------------------------ */

interface Place {
  p?: V3;
  r?: V3;
  s?: V3 | number;
  mirror?: boolean;
}

const MIRROR_X = new Matrix4().makeScale(-1, 1, 1);

function placeMatrix(pl: Place): Matrix4 {
  const s = pl.s === undefined ? [1, 1, 1] : typeof pl.s === "number" ? [pl.s, pl.s, pl.s] : pl.s;
  const p = pl.p ?? [0, 0, 0];
  const r = pl.r ?? [0, 0, 0];
  return new Matrix4().compose(
    new Vector3(p[0], p[1], p[2]),
    new Quaternion().setFromEuler(new Euler(r[0], r[1], r[2])),
    new Vector3(s[0], s[1], s[2]),
  );
}

function flipWinding(g: BufferGeometry): void {
  for (const name of ["position", "normal", "uv"]) {
    const attr = g.getAttribute(name);
    if (!attr) continue;
    const a = attr.array;
    const n = attr.itemSize;
    for (let i = 0; i < attr.count; i += 3) {
      for (let k = 0; k < n; k++) {
        const b = (i + 1) * n + k;
        const c = (i + 2) * n + k;
        const t = a[b];
        a[b] = a[c];
        a[c] = t;
      }
    }
  }
}

/** Accumulates transformed copies of geometries that will share one material. */
class Batch {
  private parts: BufferGeometry[] = [];

  add(geo: BufferGeometry, pl: Place = {}): this {
    const m = placeMatrix(pl);
    this.push(geo, m);
    if (pl.mirror) this.push(geo, MIRROR_X.clone().multiply(m));
    geo.dispose();
    return this;
  }

  addMatrix(geo: BufferGeometry, m: Matrix4): this {
    this.push(geo, m);
    geo.dispose();
    return this;
  }

  private push(geo: BufferGeometry, m: Matrix4): void {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const name of Object.keys(g.attributes)) {
      if (name !== "position" && name !== "normal" && name !== "uv") g.deleteAttribute(name);
    }
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    if (!g.getAttribute("uv")) {
      g.setAttribute("uv", new Float32BufferAttribute(new Float32Array(g.getAttribute("position").count * 2), 2));
    }
    g.clearGroups();
    g.applyMatrix4(m);
    if (m.determinant() < 0) flipWinding(g);
    this.parts.push(g);
  }

  get empty(): boolean {
    return this.parts.length === 0;
  }

  build(): BufferGeometry | null {
    if (this.parts.length === 0) return null;
    const merged = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    return merged;
  }
}

/** A lathe around the ship's long axis: profile is [radius, forward], forward maps to −Z, phi 0 is +Y. */
function zLathe(profile: readonly P2[], segs: number, phiStart = 0, phiLen = Math.PI * 2): BufferGeometry {
  const g = new LatheGeometry(
    profile.map(([r, f]) => new Vector2(Math.max(r, 0.0005), f)),
    segs,
    phiStart,
    phiLen,
  );
  g.rotateX(-Math.PI / 2);
  return g;
}

function roundedShape(pts: readonly P3[], defaultR: number, flipX = false): Shape {
  const s = new Shape();
  const n = pts.length;
  const at = (i: number): Vector2 => {
    const p = pts[(i + n) % n];
    return new Vector2(flipX ? -p[0] : p[0], p[1]);
  };
  for (let i = 0; i < n; i++) {
    const p = at(i);
    const prev = at(i - 1);
    const next = at(i + 1);
    const want = pts[i][2] ?? defaultR;
    const r = Math.min(want, p.distanceTo(prev) * 0.45, p.distanceTo(next) * 0.45);
    const a = prev.clone().sub(p).normalize().multiplyScalar(r).add(p);
    const b = next.clone().sub(p).normalize().multiplyScalar(r).add(p);
    if (i === 0) s.moveTo(a.x, a.y);
    else s.lineTo(a.x, a.y);
    s.quadraticCurveTo(p.x, p.y, b.x, b.y);
  }
  s.closePath();
  return s;
}

/** Full outline from a right half ordered nose → tail (x ≥ 0), mirrored across x = 0. */
function mirrorOutline(half: readonly P3[]): P3[] {
  const left = [...half].reverse().filter((p) => p[0] > 1e-4).map((p): P3 => (p.length === 3 ? [-p[0], p[1], p[2]] : [-p[0], p[1]]));
  return [...half, ...left];
}

interface SlabOpts {
  thick: number;
  bevel: number;
  round?: number;
}

/** Top-view outline [x, forward] extruded vertically, centred on y = 0. */
function topSlab(pts: readonly P3[], o: SlabOpts, q: Quality): BufferGeometry {
  const depth = Math.max(o.thick - 2 * o.bevel, 0.002);
  const g = new ExtrudeGeometry(roundedShape(pts, o.round ?? 0.06), {
    depth,
    bevelEnabled: o.bevel > 0,
    bevelThickness: o.bevel,
    bevelSize: o.bevel * 0.8,
    bevelSegments: q === "high" ? 3 : 1,
    curveSegments: q === "high" ? 8 : 3,
  });
  g.translate(0, 0, -depth / 2);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** Side-view outline [forward, y] extruded across X, centred on x = 0. */
function sideSlab(pts: readonly P3[], o: SlabOpts, q: Quality): BufferGeometry {
  const depth = Math.max(o.thick - 2 * o.bevel, 0.002);
  const g = new ExtrudeGeometry(roundedShape(pts, o.round ?? 0.06), {
    depth,
    bevelEnabled: o.bevel > 0,
    bevelThickness: o.bevel,
    bevelSize: o.bevel * 0.8,
    bevelSegments: q === "high" ? 3 : 1,
    curveSegments: q === "high" ? 8 : 3,
  });
  g.translate(0, 0, -depth / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

/* ------------------------------------------------------------------ */
/* Shaders                                                            */
/* ------------------------------------------------------------------ */

const FRESNEL_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
void main() {
  vUv = uv;
  vP = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const FLAME_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uOpacity;
uniform float uAlpha;
uniform float uTime;
uniform float uSeed;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  float t = clamp(vUv.y, 0.0, 1.0);
  float rim = abs(dot(normalize(vN), normalize(vV)));
  float edge = 0.4 + 0.6 * pow(rim, 1.2);
  float fade = pow(1.0 - t, 0.85) * smoothstep(0.0, 0.05, t + 0.01);
  float flick = 0.8 + 0.2 * sin(t * 24.0 - uTime * 40.0 + uSeed);
  float hot = clamp((1.0 - t * 1.5) * pow(rim, 1.5), 0.0, 1.0);
  vec3 col = mix(uColor, uCore, hot) * 1.35;
  float a = clamp(edge * fade * flick * uOpacity * uAlpha, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

const GLOW_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uAlpha;
uniform float uPow;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float d = length(p);
  float a = pow(clamp(1.0 - d, 0.0, 1.0), uPow) * uOpacity * uAlpha;
  gl_FragColor = vec4(uColor * (1.0 + a), a);
  #include <colorspace_fragment>
}`;

const SHIELD_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uTime;
uniform float uPop;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
void main() {
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float fr = pow(f, 2.4);
  vec2 h = vec2(atan(vP.z, vP.x) * 5.0, vP.y * 9.0);
  vec2 g = abs(fract(h + vec2(0.5 * floor(h.y), 0.0)) - 0.5);
  float cell = smoothstep(0.42, 0.5, max(g.x, g.y));
  float scan = 0.5 + 0.5 * sin(vP.y * 14.0 - uTime * 5.0);
  float a = (fr * 0.75 + 0.03 + cell * (0.03 + 0.16 * fr) + scan * 0.06 * fr + uPop * 0.3) * uAlpha;
  vec3 col = mix(uColor, vec3(1.0), clamp(fr * 0.35 + uPop, 0.0, 1.0));
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  #include <colorspace_fragment>
}`;

/* ------------------------------------------------------------------ */
/* Model context                                                      */
/* ------------------------------------------------------------------ */

type MatKey = "paint" | "paint2" | "chrome" | "dark" | "trim" | "glass" | "helmet" | "visor" | "glowN" | "decal";
const MAT_KEYS: readonly MatKey[] = [
  "paint",
  "paint2",
  "chrome",
  "dark",
  "trim",
  "helmet",
  "visor",
  "glowN",
  "decal",
  "glass",
];

interface Wobble {
  obj: Group;
  axis: 0 | 1 | 2;
  base: number;
  amp: number;
  phase: number;
}

interface Nozzle {
  pos: Vector3;
  r: number;
}

class Ctx {
  readonly batches: Record<MatKey, Batch>;
  readonly nozzles: Nozzle[] = [];
  readonly wobbles: Wobble[] = [];
  readonly geos: BufferGeometry[] = [];
  readonly seg: number;
  readonly sph: readonly [number, number];
  readonly tube: readonly [number, number];
  underglow: readonly [number, number, number] = [1.7, 3.0, 0];
  sparks: readonly [number, number, number] = [0.6, 0.22, 1.0];

  constructor(
    readonly q: Quality,
    readonly body: Group,
    readonly mats: Record<MatKey, Material>,
  ) {
    const b = (): Batch => new Batch();
    this.batches = {
      paint: b(),
      paint2: b(),
      chrome: b(),
      dark: b(),
      trim: b(),
      glass: b(),
      helmet: b(),
      visor: b(),
      glowN: b(),
      decal: b(),
    };
    const hi = q === "high";
    this.seg = hi ? 36 : 14;
    this.sph = hi ? [32, 20] : [14, 9];
    this.tube = hi ? [10, 36] : [5, 16];
  }

  get paint(): Batch {
    return this.batches.paint;
  }
  get paint2(): Batch {
    return this.batches.paint2;
  }
  get chrome(): Batch {
    return this.batches.chrome;
  }
  get dark(): Batch {
    return this.batches.dark;
  }
  get trim(): Batch {
    return this.batches.trim;
  }

  sphere(thetaStart = 0, thetaLen = Math.PI, phiStart = 0, phiLen = Math.PI * 2): SphereGeometry {
    return new SphereGeometry(1, this.sph[0], this.sph[1], phiStart, phiLen, thetaStart, thetaLen);
  }

  torus(r: number, tube: number, arc = Math.PI * 2): TorusGeometry {
    return new TorusGeometry(r, tube, this.tube[0], this.tube[1], arc);
  }

  box(w: number, h: number, d: number, r: number): BufferGeometry {
    return new RoundedBoxGeometry(w, h, d, this.q === "high" ? 3 : 1, r);
  }

  cyl(rTop: number, rBot: number, h: number, segs = this.seg): CylinderGeometry {
    return new CylinderGeometry(rTop, rBot, h, segs, 1);
  }

  lathe(profile: readonly P2[], phiStart = 0, phiLen = Math.PI * 2): BufferGeometry {
    const segs = phiLen < Math.PI * 2 ? Math.max(4, Math.round((this.seg * phiLen) / (Math.PI * 2)) + 2) : this.seg;
    return zLathe(profile, segs, phiStart, phiLen);
  }

  /** Glass canopy (half ellipsoid) with a chrome sill and a pilot inside. */
  cockpit(x: number, y: number, z: number, sx: number, sy: number, sz: number): void {
    this.batches.glass.add(this.sphere(0, Math.PI / 2), { p: [x, y, z], s: [sx, sy, sz] });
    const sill = this.torus(1, 0.045);
    sill.rotateX(Math.PI / 2);
    this.chrome.add(sill, { p: [x, y + 0.01, z], s: [sx * 1.01, 0.7, sz * 1.01] });
    // pilot
    const hr = Math.min(sx, sy) * 0.58;
    const hy = y + sy * 0.34;
    const hz = z + sz * 0.12;
    this.batches.helmet.add(this.sphere(), { p: [x, hy, hz], s: hr });
    this.batches.visor.add(this.sphere(0.95, 0.85, Math.PI * 1.5 - 0.95, 1.9), {
      p: [x, hy, hz],
      s: hr * 1.05,
    });
    // glowing mohawk ridge on the helmet
    this.trim.add(this.sphere(), { p: [x, hy + hr * 0.82, hz + hr * 0.15], s: [hr * 0.16, hr * 0.32, hr * 0.85] });
    // shoulders
    this.dark.add(this.sphere(), { p: [x, hy - hr * 1.05, hz + hr * 0.3], s: [hr * 1.5, hr * 0.7, hr * 1.1] });
  }

  /** A thruster: chrome bell, dark throat, emissive core disc and ring. Exit plane at z. */
  nozzle(x: number, y: number, z: number, r: number, len = r * 1.5): void {
    const at: Place = { p: [x, y, z] };
    this.dark.add(
      this.lathe([
        [r * 0.5, r * 0.62],
        [r * 0.82, 0],
      ]),
      at,
    );
    this.chrome.add(
      this.lathe([
        [r * 0.82, 0],
        [r * 1.0, 0],
        [r * 1.07, r * 0.16],
        [r * 1.0, r * 0.4],
        [r * 0.94, len * 0.62],
        [r * 0.72, len],
      ]),
      at,
    );
    this.batches.glowN.add(new CircleGeometry(r * 0.56, this.q === "high" ? 24 : 10), { p: [x, y, z - r * 0.6] });
    this.batches.glowN.add(this.torus(r * 0.8, r * 0.07), { p: [x, y, z - r * 0.06] });
    this.nozzles.push({ pos: new Vector3(x, y, z), r });
  }

  /** Decal plane facing `normal`, text up along `up`. */
  decal(pos: V3, normal: V3, up: V3, size: number): void {
    const n = new Vector3(...normal).normalize();
    const xa = new Vector3(...up).cross(n).normalize();
    const ya = n.clone().cross(xa);
    const m = new Matrix4().makeBasis(xa, ya, n).setPosition(pos[0], pos[1], pos[2]);
    this.batches.decal.addMatrix(new PlaneGeometry(size, size), m);
  }

  /** A separately animated part hinged at `pivot`. */
  fin(
    key: MatKey,
    pivot: V3,
    rot: V3,
    axis: 0 | 1 | 2,
    amp: number,
    build: (b: Batch) => void,
    mirror: boolean,
  ): void {
    const batch = new Batch();
    build(batch);
    const geo = batch.build();
    if (!geo) return;
    this.geos.push(geo);
    const make = (sign: number, phase: number): void => {
      const g = new Group();
      g.position.set(pivot[0] * sign, pivot[1], pivot[2]);
      g.rotation.set(rot[0], rot[1] * sign, rot[2] * sign);
      const mesh = new Mesh(geo, this.mats[key]);
      mesh.scale.x = sign;
      mesh.castShadow = true;
      g.add(mesh);
      this.body.add(g);
      const base = axis === 0 ? g.rotation.x : axis === 1 ? g.rotation.y : g.rotation.z;
      this.wobbles.push({ obj: g, axis, base, amp: axis === 0 ? amp : amp * sign, phase });
    };
    make(1, 0);
    if (mirror) make(-1, 1.7);
  }

  finish(): void {
    for (const key of MAT_KEYS) {
      const geo = this.batches[key].build();
      if (!geo) continue;
      this.geos.push(geo);
      const mesh = new Mesh(geo, this.mats[key]);
      mesh.castShadow = key !== "glass" && key !== "decal" && key !== "glowN";
      mesh.receiveShadow = key === "paint" || key === "paint2";
      if (key === "decal") mesh.renderOrder = 1;
      if (key === "glass") mesh.renderOrder = 2;
      this.body.add(mesh);
    }
  }
}

/* ------------------------------------------------------------------ */
/* The eight hulls                                                    */
/* ------------------------------------------------------------------ */

const Y = 0.55;

function buildComet(c: Ctx): void {
  const prof: P2[] = [
    [0, -1.42],
    [0.3, -1.42],
    [0.42, -1.2],
    [0.47, -0.7],
    [0.46, -0.1],
    [0.4, 0.5],
    [0.28, 1.05],
    [0.13, 1.45],
    [0.02, 1.62],
    [0, 1.63],
  ];
  c.paint.add(c.lathe(prof), { p: [0, Y, 0], s: [1.2, 0.78, 1] });
  c.paint2.add(c.lathe(prof.slice(1, -1), -0.24, 0.48), { p: [0, Y, 0], s: [1.215, 0.79, 1.003] });
  // nose tip + intake cheeks
  c.chrome.add(c.sphere(), { p: [0, Y, -1.6], s: [0.05, 0.05, 0.08] });
  const intake: Place = { p: [0.47, Y + 0.02, -0.1], s: [1, 1.2, 1], mirror: true };
  c.paint.add(
    c.lathe([
      [0, -0.4],
      [0.1, -0.32],
      [0.145, 0.0],
      [0.14, 0.3],
      [0.115, 0.37],
    ]),
    intake,
  );
  c.dark.add(new CircleGeometry(0.115, 16).rotateY(Math.PI).translate(0, 0, -0.36), intake);
  c.chrome.add(c.torus(0.115, 0.018).translate(0, 0, -0.37), intake);
  // delta wings with tip pods
  const wing: P3[] = [
    [0.32, 0.35, 0.05],
    [1.02, -0.72, 0.14],
    [1.06, -1.08, 0.1],
    [0.32, -1.05, 0.05],
  ];
  c.paint2.add(topSlab(wing, { thick: 0.11, bevel: 0.04 }, c.q), { p: [0, Y - 0.12, 0], mirror: true });
  const pod: P2[] = [
    [0, -0.42],
    [0.06, -0.38],
    [0.085, -0.1],
    [0.075, 0.25],
    [0, 0.42],
  ];
  c.paint.add(c.lathe(pod), { p: [1.06, Y - 0.1, 0.78], mirror: true });
  c.trim.add(c.sphere(), { p: [1.06, Y - 0.1, 0.39], s: [0.045, 0.045, 0.06], mirror: true });
  // accent glow line down the flank
  c.trim.add(c.cyl(0.018, 0.018, 1.3, 8), { p: [0.54, Y - 0.08, 0.35], r: [Math.PI / 2, 0, 0], mirror: true });
  // tail fin
  const fin: P3[] = [
    [-0.85, 0, 0.04],
    [-1.42, 0, 0.04],
    [-1.62, 0.52, 0.08],
    [-1.36, 0.55, 0.08],
  ];
  c.paint.add(sideSlab(fin, { thick: 0.08, bevel: 0.03 }, c.q), { p: [0, Y + 0.18, 0] });
  c.trim.add(c.sphere(), { p: [0, Y + 0.72, 1.5], s: [0.05, 0.035, 0.12] });
  c.cockpit(0, Y + 0.16, -0.3, 0.3, 0.32, 0.64);
  c.nozzle(0, Y, 1.46, 0.34);
  // hover canards
  c.fin("paint", [0.28, Y - 0.04, -0.8], [0, 0, -0.12], 2, 0.1, (b) => {
    b.add(
      topSlab(
        [
          [0, 0.18],
          [0.36, -0.02],
          [0.36, -0.12],
          [0, -0.16],
        ],
        { thick: 0.06, bevel: 0.02 },
        c.q,
      ),
    );
  }, true);
  c.decal([0.64, Y - 0.06 + 0.006, 0.72], [0, 1, 0], [0, 0, -1], 0.36);
  c.decal([-0.64, Y - 0.06 + 0.006, 0.72], [0, 1, 0], [0, 0, -1], 0.36);
  c.underglow = [1.7, 3.1, 0];
  c.sparks = [0.62, 0.24, 1.05];
}

function buildHammerhead(c: Ctx): void {
  const prof: P2[] = [
    [0, -1.35],
    [0.3, -1.35],
    [0.44, -1.1],
    [0.5, -0.5],
    [0.48, 0.3],
    [0.4, 0.95],
    [0.26, 1.35],
    [0.1, 1.56],
    [0, 1.58],
  ];
  c.paint.add(c.lathe(prof), { p: [0, Y, 0], s: [1.12, 0.74, 1] });
  c.paint2.add(c.lathe(prof.slice(1, -1), -0.2, 0.4), { p: [0, Y, 0], s: [1.135, 0.75, 1.003] });
  // the hammer
  const hammer: P3[] = [
    [-1.02, 0.95, 0.12],
    [-0.9, 1.3, 0.12],
    [0.9, 1.3, 0.12],
    [1.02, 0.95, 0.12],
    [0.55, 0.72, 0.2],
    [-0.55, 0.72, 0.2],
  ];
  c.paint2.add(topSlab(hammer, { thick: 0.17, bevel: 0.06 }, c.q), { p: [0, Y - 0.02, 0] });
  const pod: P2[] = [
    [0, -0.55],
    [0.13, -0.5],
    [0.21, -0.2],
    [0.21, 0.22],
    [0.13, 0.5],
    [0, 0.57],
  ];
  c.paint.add(c.lathe(pod), { p: [1.04, Y, -1.02], mirror: true });
  c.chrome.add(c.torus(0.212, 0.022), { p: [1.04, Y, -0.78], mirror: true });
  c.trim.add(c.sphere(), { p: [1.04, Y + 0.01, -1.56], s: [0.06, 0.055, 0.05], mirror: true });
  c.trim.add(c.box(0.9, 0.03, 0.05, 0.012), { p: [0, Y + 0.07, -1.28] });
  // engine block and flank lights
  c.paint2.add(c.box(0.98, 0.4, 0.42, 0.16), { p: [0, Y, 1.2] });
  c.trim.add(c.cyl(0.02, 0.02, 1.6, 8), { p: [0.55, Y - 0.02, 0.1], r: [Math.PI / 2, 0, 0], mirror: true });
  c.chrome.add(c.box(0.12, 0.08, 0.9, 0.03), { p: [0.52, Y - 0.2, 0.3], mirror: true });
  c.cockpit(0, Y + 0.17, -0.1, 0.3, 0.3, 0.6);
  c.nozzle(0.3, Y, 1.42, 0.25);
  c.nozzle(-0.3, Y, 1.42, 0.25);
  // V-tail
  c.fin("paint", [0.3, Y + 0.2, 0.85], [0, 0, 0.62], 0, 0.08, (b) => {
    b.add(
      topSlab(
        [
          [0, 0.1],
          [0.55, -0.3],
          [0.62, -0.5],
          [0, -0.46],
        ],
        { thick: 0.07, bevel: 0.025 },
        c.q,
      ),
    );
    b.add(new SphereGeometry(0.04, 8, 6), { p: [0.6, 0, 0.42] });
  }, true);
  c.decal([0.62, Y + 0.065, -1.05], [0, 1, 0], [0, 0, -1], 0.3);
  c.decal([-0.62, Y + 0.065, -1.05], [0, 1, 0], [0, 0, -1], 0.3);
  c.underglow = [2.2, 3.1, -0.1];
  c.sparks = [0.62, 0.24, 1.1];
}

function buildGemini(c: Ctx): void {
  const boom: P2[] = [
    [0, -1.45],
    [0.22, -1.45],
    [0.3, -1.2],
    [0.32, -0.4],
    [0.3, 0.6],
    [0.22, 1.2],
    [0.1, 1.5],
    [0, 1.56],
  ];
  const bx = 0.74;
  c.paint.add(c.lathe(boom), { p: [bx, Y, 0], mirror: true });
  c.paint2.add(c.lathe(boom.slice(1, -1), -0.25, 0.5), { p: [bx, Y, 0], s: [1.015, 1.015, 1.003], mirror: true });
  c.chrome.add(c.torus(0.305, 0.025), { p: [bx, Y, -0.85], mirror: true });
  c.trim.add(c.sphere(), { p: [bx, Y, -1.54], s: [0.06, 0.06, 0.06], mirror: true });
  // central nacelle
  const nac: P2[] = [
    [0, -0.75],
    [0.18, -0.75],
    [0.3, -0.45],
    [0.34, 0.2],
    [0.28, 0.8],
    [0.14, 1.2],
    [0, 1.3],
  ];
  c.batches.paint2.add(c.lathe(nac), { p: [0, Y + 0.06, 0], s: [1, 0.92, 1] });
  c.trim.add(c.cyl(0.05, 0.08, 0.2, 12), { p: [0, Y + 0.06, 0.8], r: [Math.PI / 2, 0, 0] });
  // centre wing + tail bar
  c.paint.add(
    topSlab(
      [
        [-0.78, 0.3, 0.1],
        [0.78, 0.3, 0.1],
        [0.78, -0.72, 0.1],
        [-0.78, -0.72, 0.1],
      ],
      { thick: 0.1, bevel: 0.035 },
      c.q,
    ),
    { p: [0, Y - 0.03, 0] },
  );
  const tail: P3[] = [
    [-0.75, 0, 0.04],
    [-1.4, 0, 0.04],
    [-1.55, 0.46, 0.06],
    [-1.2, 0.48, 0.1],
  ];
  c.paint2.add(sideSlab(tail, { thick: 0.07, bevel: 0.025 }, c.q), { p: [bx, Y + 0.2, 0], mirror: true });
  c.paint.add(c.box(1.72, 0.07, 0.3, 0.03), { p: [0, Y + 0.68, 1.36] });
  c.trim.add(c.box(1.2, 0.02, 0.04, 0.008), { p: [0, Y + 0.72, 1.24] });
  c.cockpit(0, Y + 0.18, -0.42, 0.25, 0.28, 0.52);
  c.nozzle(bx, Y, 1.45, 0.24);
  c.nozzle(-bx, Y, 1.45, 0.24);
  c.fin("paint2", [bx + 0.26, Y, -0.9], [0, 0, -0.1], 2, 0.1, (b) => {
    b.add(
      topSlab(
        [
          [0, 0.15],
          [0.3, -0.02],
          [0.3, -0.13],
          [0, -0.2],
        ],
        { thick: 0.05, bevel: 0.018 },
        c.q,
      ),
    );
  }, true);
  c.decal([bx + 0.318, Y + 0.02, 0.15], [1, 0, 0], [0, 1, 0], 0.26);
  c.decal([-bx - 0.318, Y + 0.02, 0.15], [-1, 0, 0], [0, 1, 0], 0.26);
  c.underglow = [2.1, 3.1, 0];
  c.sparks = [0.74, 0.22, 1.1];
}

function buildNebulaQueen(c: Ctx): void {
  const zS = 1.36;
  const disc = new LatheGeometry(
    [
      [0.0005, -0.2],
      [0.55, -0.22],
      [0.9, -0.16],
      [1.05, -0.05],
      [1.08, 0.02],
      [1.0, 0.1],
      [0.75, 0.18],
      [0.45, 0.24],
      [0.0005, 0.26],
    ].map(([r, y]) => new Vector2(r, y)),
    c.q === "high" ? 48 : 16,
  );
  c.paint.add(disc, { p: [0, Y, 0.05], s: [1, 1, zS] });
  const rim = c.torus(1.075, 0.035);
  rim.rotateX(Math.PI / 2);
  c.chrome.add(rim, { p: [0, Y + 0.01, 0.05], s: [1, 1, zS] });
  const glowRing = c.torus(0.98, 0.025);
  glowRing.rotateX(Math.PI / 2);
  c.trim.add(glowRing, { p: [0, Y - 0.13, 0.05], s: [1, 1, zS] });
  const crown = c.torus(0.5, 0.06);
  crown.rotateX(Math.PI / 2);
  c.paint2.add(crown, { p: [0, Y + 0.2, -0.05], s: [1, 1, 1.25] });
  // tiara gems
  c.trim.add(c.sphere(), { p: [0, Y + 0.14, -1.18], s: 0.07 });
  c.trim.add(c.sphere(), { p: [0.36, Y + 0.14, -1.08], s: 0.05, mirror: true });
  c.cockpit(0, Y + 0.18, -0.05, 0.42, 0.4, 0.52);
  // engine housing
  c.paint2.add(c.box(1.2, 0.36, 0.55, 0.12), { p: [0, Y + 0.02, 1.3] });
  c.dark.add(c.box(1.05, 0.26, 0.2, 0.06), { p: [0, Y + 0.02, 1.52] });
  c.nozzle(0, Y + 0.03, 1.66, 0.19);
  c.nozzle(0.4, Y + 0.02, 1.58, 0.16);
  c.nozzle(-0.4, Y + 0.02, 1.58, 0.16);
  // crown fins
  c.fin("paint2", [0.5, Y + 0.16, 1.05], [0, 0, -0.35], 2, 0.07, (b) => {
    b.add(
      sideSlab(
        [
          [0.05, 0, 0.03],
          [-0.42, 0, 0.03],
          [-0.55, 0.42, 0.08],
          [-0.22, 0.44, 0.1],
        ],
        { thick: 0.06, bevel: 0.022 },
        c.q,
      ),
    );
    b.add(new SphereGeometry(0.045, 8, 6), { p: [0, 0.46, 0.45] });
  }, true);
  const n = new Vector3(0.2, 1, 0.06).normalize();
  c.decal([0.72, Y + 0.195, 0.34], [n.x, n.y, n.z], [0, 0, -1], 0.36);
  c.decal([-0.72, Y + 0.195, 0.34], [-n.x, n.y, n.z], [0, 0, -1], 0.36);
  c.underglow = [2.4, 3.2, 0.05];
  c.sparks = [0.85, 0.2, 0.95];
}

function buildIronMoon(c: Ctx): void {
  const hull: P3[] = [
    [-1.25, -0.2, 0.06],
    [1.12, -0.2, 0.1],
    [1.38, -0.02, 0.08],
    [1.2, 0.14, 0.1],
    [0.5, 0.2, 0.14],
    [-1.25, 0.2, 0.06],
  ];
  c.paint.add(sideSlab(hull, { thick: 1.32, bevel: 0.1 }, c.q), { p: [0, Y, 0] });
  // pontoons, bumper, stripes
  c.paint2.add(c.box(0.38, 0.36, 2.6, 0.12), { p: [0.84, Y - 0.12, 0.05], mirror: true });
  c.dark.add(c.box(0.3, 0.08, 2.3, 0.03), { p: [0.84, Y - 0.32, 0.05], mirror: true });
  c.chrome.add(c.box(1.95, 0.2, 0.24, 0.08), { p: [0, Y - 0.2, -1.42] });
  c.trim.add(c.box(0.22, 0.07, 0.04, 0.02), { p: [0.62, Y - 0.14, -1.53], mirror: true });
  c.paint2.add(c.box(0.13, 0.03, 1.7, 0.012), { p: [0.4, Y + 0.305, 0.38], mirror: true });
  // roof light bar and stacks
  c.trim.add(c.box(0.7, 0.06, 0.1, 0.025), { p: [0, Y + 0.33, 0.35] });
  c.chrome.add(c.cyl(0.075, 0.085, 0.5, 14), { p: [0.52, Y + 0.45, 0.95], mirror: true });
  c.trim.add(c.cyl(0.065, 0.075, 0.05, 14), { p: [0.52, Y + 0.71, 0.95], mirror: true });
  // engine block
  c.dark.add(c.box(1.4, 0.54, 0.34, 0.1), { p: [0, Y, 1.35] });
  c.cockpit(0, Y + 0.22, -0.3, 0.38, 0.3, 0.52);
  c.nozzle(0, Y + 0.02, 1.62, 0.24);
  c.nozzle(0.45, Y, 1.6, 0.2);
  c.nozzle(-0.45, Y, 1.6, 0.2);
  // spoiler on struts
  c.chrome.add(c.cyl(0.03, 0.03, 0.3, 8), { p: [0.4, Y + 0.45, 1.28], mirror: true });
  c.fin("paint2", [0, Y + 0.62, 1.26], [0.12, 0, 0], 0, 0.05, (b) => {
    b.add(
      topSlab(
        [
          [-0.85, 0.12, 0.05],
          [0.85, 0.12, 0.05],
          [0.8, -0.2, 0.05],
          [-0.8, -0.2, 0.05],
        ],
        { thick: 0.07, bevel: 0.025 },
        c.q,
      ),
    );
    b.add(c.box(0.06, 0.22, 0.4, 0.02), { p: [0.84, 0.06, 0.04], mirror: true });
  }, false);
  c.decal([1.033, Y - 0.1, 0.1], [1, 0, 0], [0, 1, 0], 0.32);
  c.decal([-1.033, Y - 0.1, 0.1], [-1, 0, 0], [0, 1, 0], 0.32);
  c.underglow = [2.2, 3.2, 0];
  c.sparks = [0.85, 0.2, 1.1];
}

function buildPulsar(c: Ctx): void {
  const prof: P2[] = [
    [0, -1.3],
    [0.24, -1.3],
    [0.32, -1.05],
    [0.34, -0.4],
    [0.3, 0.4],
    [0.2, 1.0],
    [0.1, 1.45],
    [0.03, 1.7],
    [0, 1.72],
  ];
  c.paint.add(c.lathe(prof), { p: [0, Y, 0], s: [1.15, 0.95, 1] });
  c.paint2.add(c.lathe(prof.slice(1, -1), -0.36, 0.72), { p: [0, Y, 0], s: [1.165, 0.962, 1.003] });
  const probe = c.cyl(0.004, 0.03, 0.34, 10);
  probe.rotateX(-Math.PI / 2);
  c.chrome.add(probe, { p: [0, Y, -1.84] });
  c.trim.add(c.sphere(), { p: [0, Y, -2.0], s: 0.025 });
  // the pulsar halo
  const hz = 0.12;
  c.chrome.add(c.torus(0.5, 0.045), { p: [0, Y, hz], s: [1.22, 0.86, 1] });
  c.trim.add(c.torus(0.5, 0.022), { p: [0, Y, hz - 0.05], s: [1.22, 0.86, 1] });
  for (const a of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
    c.chrome.add(c.cyl(0.022, 0.022, 0.3, 8), {
      p: [Math.cos(a) * 0.46, Y + Math.sin(a) * 0.33, hz],
      r: [0, 0, a - Math.PI / 2],
    });
  }
  // swept wings, canards
  c.paint2.add(
    topSlab(
      [
        [0.25, -0.15, 0.04],
        [0.95, -0.92, 0.1],
        [0.98, -1.2, 0.06],
        [0.25, -1.15, 0.04],
      ],
      { thick: 0.07, bevel: 0.025 },
      c.q,
    ),
    { p: [0, Y - 0.06, 0], mirror: true },
  );
  c.paint2.add(
    topSlab(
      [
        [0.18, 1.02, 0.03],
        [0.48, 0.8, 0.05],
        [0.48, 0.72, 0.03],
        [0.18, 0.68, 0.03],
      ],
      { thick: 0.05, bevel: 0.018 },
      c.q,
    ),
    { p: [0, Y - 0.04, 0], mirror: true },
  );
  c.trim.add(c.cyl(0.014, 0.014, 1.0, 6), {
    p: [0.585, Y - 0.04, 0.53],
    r: [Math.PI / 2, 0, 0.83],
    mirror: true,
  });
  c.cockpit(0, Y + 0.14, -0.5, 0.22, 0.26, 0.62);
  c.nozzle(0, Y, 1.32, 0.29);
  c.fin("paint", [0.96, Y - 0.04, 1.05], [0, 0, -0.08], 2, 0.1, (b) => {
    b.add(
      sideSlab(
        [
          [0.14, 0, 0.02],
          [-0.18, 0, 0.02],
          [-0.26, 0.32, 0.05],
          [-0.06, 0.32, 0.05],
        ],
        { thick: 0.045, bevel: 0.016 },
        c.q,
      ),
    );
  }, true);
  c.decal([0.6, Y - 0.06 + 0.041, 0.86], [0, 1, 0], [0, 0, -1], 0.3);
  c.decal([-0.6, Y - 0.06 + 0.041, 0.86], [0, 1, 0], [0, 0, -1], 0.3);
  c.underglow = [1.6, 3.4, -0.1];
  c.sparks = [0.55, 0.22, 1.05];
}

function buildRosie(c: Ctx): void {
  const y = Y + 0.03;
  const prof: P2[] = [
    [0, -1.3],
    [0.3, -1.3],
    [0.4, -1.1],
    [0.47, -0.6],
    [0.48, 0.0],
    [0.44, 0.5],
    [0.34, 0.95],
    [0.2, 1.3],
    [0.06, 1.52],
    [0, 1.56],
  ];
  c.paint.add(c.lathe(prof), { p: [0, y, 0] });
  c.paint2.add(
    c.lathe([
      [0.345, 0.95],
      [0.205, 1.3],
      [0.065, 1.52],
      [0, 1.565],
    ]),
    { p: [0, y, 0], s: [1.01, 1.01, 1] },
  );
  c.paint2.add(
    c.lathe([
      [0.484, -0.36],
      [0.49, -0.34],
      [0.49, -0.06],
      [0.484, -0.04],
    ]),
    { p: [0, y, 0] },
  );
  c.chrome.add(c.torus(0.48, 0.02), { p: [0, y, 0.38] });
  c.chrome.add(c.torus(0.48, 0.02), { p: [0, y, 0.02] });
  c.chrome.add(c.torus(0.345, 0.022), { p: [0, y, -0.95] });
  c.chrome.add(c.sphere(), { p: [0, y, -1.56], s: 0.045 });
  // portholes along the flank
  for (const [z, x] of [
    [0.62, 0.462],
    [0.9, 0.438],
  ] as const) {
    const port = c.torus(0.07, 0.02);
    port.rotateY(Math.PI / 2);
    c.chrome.add(port, { p: [x, y + 0.08, z], mirror: true });
    c.trim.add(new CircleGeometry(0.066, 14).rotateY(Math.PI / 2), { p: [x - 0.004, y + 0.08, z], mirror: true });
  }
  c.cockpit(0, y + 0.3, -0.48, 0.27, 0.28, 0.36);
  // three swoopy fins with chrome ball tips
  const fin: P3[] = [
    [-0.55, 0, 0.05],
    [-1.2, 0, 0.05],
    [-1.6, 0.6, 0.14],
    [-1.4, 0.68, 0.1],
    [-1.02, 0.28, 0.2],
  ];
  for (const a of [(2 * Math.PI) / 3, (-2 * Math.PI) / 3]) {
    c.paint2.add(sideSlab(fin, { thick: 0.08, bevel: 0.03 }, c.q).translate(0, 0.28, 0), {
      p: [0, y, 0],
      r: [0, 0, a],
    });
    c.chrome.add(new SphereGeometry(0.065, 14, 10).translate(0, 0.95, 1.52), { p: [0, y, 0], r: [0, 0, a] });
  }
  c.fin("paint2", [0, y + 0.28, 0], [0, 0, 0], 1, 0.05, (b) => {
    b.add(sideSlab(fin, { thick: 0.08, bevel: 0.03 }, c.q));
    b.add(new SphereGeometry(0.065, 14, 10), { p: [0, 0.67, 1.52] });
  }, false);
  c.nozzle(0, y, 1.34, 0.3);
  c.decal([0.458, y - 0.08, -0.55], [0.96, -0.18, 0], [0, 1, 0], 0.26);
  c.decal([-0.458, y - 0.08, -0.55], [-0.96, -0.18, 0], [0, 1, 0], 0.26);
  c.underglow = [1.7, 3.1, 0];
  c.sparks = [0.6, 0.2, 1.0];
}

function buildManta(c: Ctx): void {
  const half: P3[] = [
    [0, 1.02, 0.08],
    [0.19, 1.5, 0.07],
    [0.4, 1.12, 0.12],
    [0.76, 0.46, 0.25],
    [1.04, -0.02, 0.12],
    [0.82, -0.36, 0.25],
    [0.45, -0.72, 0.2],
    [0.22, -1.25, 0.1],
    [0, -1.28, 0.1],
  ];
  const wy = Y - 0.08;
  c.paint.add(topSlab(mirrorOutline(half), { thick: 0.15, bevel: 0.07 }, c.q), { p: [0, wy, 0] });
  const dorsal: P2[] = [
    [0, -1.2],
    [0.25, -1.2],
    [0.36, -0.8],
    [0.4, -0.1],
    [0.34, 0.5],
    [0.2, 0.95],
    [0, 1.08],
  ];
  c.paint.add(c.lathe(dorsal), { p: [0, Y - 0.02, 0], s: [1.1, 0.55, 1] });
  c.paint2.add(c.lathe(dorsal.slice(1, -1), -0.12, 0.24), { p: [0, Y - 0.02, 0], s: [1.115, 0.56, 1.003] });
  // neon veins
  c.trim.add(
    topSlab(
      [
        [0.36, 0.26, 0.01],
        [0.92, -0.04, 0.01],
        [0.9, -0.1, 0.01],
        [0.36, 0.17, 0.01],
      ],
      { thick: 0.02, bevel: 0 },
      c.q,
    ),
    { p: [0, wy + 0.068, 0], mirror: true },
  );
  c.trim.add(
    topSlab(
      [
        [0.3, -0.62, 0.01],
        [0.7, -0.44, 0.01],
        [0.68, -0.39, 0.01],
        [0.3, -0.55, 0.01],
      ],
      { thick: 0.02, bevel: 0 },
      c.q,
    ),
    { p: [0, wy + 0.068, 0], mirror: true },
  );
  // engine pods and tail spike
  const pod: P2[] = [
    [0.2, -1.2],
    [0.24, -0.9],
    [0.22, -0.3],
    [0, 0.1],
  ];
  c.paint2.add(c.lathe(pod), { p: [0.34, Y - 0.04, 0], s: [1, 0.85, 1], mirror: true });
  c.chrome.add(
    c.lathe([
      [0, -1.85],
      [0.035, -1.7],
      [0.07, -1.25],
      [0, -1.05],
    ]),
    { p: [0, Y - 0.04, 0] },
  );
  c.trim.add(c.sphere(), { p: [0, Y - 0.04, 1.85], s: 0.035 });
  c.trim.add(c.sphere(), { p: [0.19, wy + 0.02, -1.5], s: [0.04, 0.04, 0.05], mirror: true });
  c.cockpit(0, Y + 0.08, -0.35, 0.25, 0.26, 0.52);
  c.nozzle(0.34, Y - 0.04, 1.28, 0.2);
  c.nozzle(-0.34, Y - 0.04, 1.28, 0.2);
  c.fin("paint2", [1.0, wy + 0.03, 0.0], [0, 0, -0.18], 2, 0.1, (b) => {
    b.add(
      sideSlab(
        [
          [0.22, 0, 0.02],
          [-0.24, 0, 0.02],
          [-0.34, 0.3, 0.06],
          [-0.08, 0.32, 0.06],
        ],
        { thick: 0.045, bevel: 0.016 },
        c.q,
      ),
    );
  }, true);
  c.decal([0.62, wy + 0.076, 0.32], [0, 1, 0], [0, 0, -1], 0.3);
  c.decal([-0.62, wy + 0.076, 0.32], [0, 1, 0], [0, 0, -1], 0.3);
  c.underglow = [2.2, 3.1, 0];
  c.sparks = [0.7, 0.2, 0.95];
}

const BUILDERS: Record<string, (c: Ctx) => void> = {
  comet: buildComet,
  hammerhead: buildHammerhead,
  gemini: buildGemini,
  "nebula-queen": buildNebulaQueen,
  "iron-moon": buildIronMoon,
  pulsar: buildPulsar,
  rosie: buildRosie,
  manta: buildManta,
};

/* ------------------------------------------------------------------ */
/* Materials                                                          */
/* ------------------------------------------------------------------ */

function decalTexture(num: number, livery: Livery): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const g = cv.getContext("2d");
  if (!g) return null;
  g.clearRect(0, 0, 128, 128);
  g.fillStyle = "#15161f";
  g.beginPath();
  g.arc(64, 64, 62, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = livery.glow;
  g.beginPath();
  g.arc(64, 64, 57, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#fbfbf6";
  g.beginPath();
  g.arc(64, 64, 47, 0, Math.PI * 2);
  g.fill();
  const text = String(num);
  g.font = `italic 900 ${text.length > 1 ? 50 : 62}px "Arial Black", Impact, system-ui, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineWidth = 6;
  g.strokeStyle = livery.primary;
  g.strokeText(text, 64, 68);
  g.fillStyle = "#15161f";
  g.fillText(text, 64, 68);
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

interface MatSet {
  mats: Record<MatKey, Material>;
  textures: Texture[];
}

function makeMaterials(livery: Livery, q: Quality, num: number): MatSet {
  const hi = q === "high";
  const glow = new Color(livery.glow);
  const paint = (color: string): Material =>
    hi
      ? new MeshPhysicalMaterial({
          color,
          roughness: 0.3,
          metalness: 0.12,
          clearcoat: 1,
          clearcoatRoughness: 0.05,
        })
      : new MeshStandardMaterial({ color, roughness: 0.32, metalness: 0.15 });
  const chrome = hi
    ? new MeshPhysicalMaterial({ color: "#eef2f7", metalness: 1, roughness: 0.13, clearcoat: 0.6 })
    : new MeshStandardMaterial({ color: "#e4e9f0", metalness: 1, roughness: 0.16 });
  const dark = new MeshStandardMaterial({ color: "#232834", metalness: 0.6, roughness: 0.4 });
  const trim = new MeshStandardMaterial({
    color: glow,
    emissive: glow,
    emissiveIntensity: 1.6,
    roughness: 0.3,
  });
  const glassTint = new Color("#0e2748").lerp(glow, 0.08);
  const glass = hi
    ? new MeshPhysicalMaterial({
        color: glassTint,
        emissive: glow,
        emissiveIntensity: 0.1,
        metalness: 0,
        roughness: 0.03,
        clearcoat: 1,
        clearcoatRoughness: 0.02,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        envMapIntensity: 1.6,
      })
    : new MeshStandardMaterial({
        color: glassTint,
        emissive: glow,
        emissiveIntensity: 0.14,
        metalness: 0.2,
        roughness: 0.05,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      });
  const helmet = paint("#fbfbf8");
  const visor = hi
    ? new MeshPhysicalMaterial({
        color: "#0b0e18",
        emissive: glow,
        emissiveIntensity: 0.45,
        metalness: 0.7,
        roughness: 0.08,
        clearcoat: 1,
      })
    : new MeshStandardMaterial({ color: "#0b0e18", emissive: glow, emissiveIntensity: 0.45, metalness: 0.7, roughness: 0.1 });
  const glowN = new MeshStandardMaterial({ color: "#000000", emissive: glow, emissiveIntensity: 2 });
  const tex = decalTexture(num, livery);
  const decalOpts = {
    map: tex,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    roughness: 0.3,
    visible: tex !== null,
  };
  const decal = hi ? new MeshPhysicalMaterial({ ...decalOpts, clearcoat: 1, clearcoatRoughness: 0.05 }) : new MeshStandardMaterial(decalOpts);
  return {
    mats: {
      paint: paint(livery.primary),
      paint2: paint(livery.secondary),
      chrome,
      dark,
      trim,
      glass,
      helmet,
      visor,
      glowN,
      decal,
    },
    textures: tex ? [tex] : [],
  };
}

function flameMaterial(color: Color, core: Color, seed: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: color.clone() },
      uCore: { value: core.clone() },
      uOpacity: { value: 1 },
      uAlpha: { value: 1 },
      uTime: { value: 0 },
      uSeed: { value: seed },
    },
    vertexShader: FRESNEL_VERT,
    fragmentShader: FLAME_FRAG,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}

function glowMaterial(color: Color, opacity: number, pow: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: color.clone() },
      uOpacity: { value: opacity },
      uAlpha: { value: 1 },
      uPow: { value: pow },
    },
    vertexShader: FRESNEL_VERT,
    fragmentShader: GLOW_FRAG,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
}

function uniformsOf(m: ShaderMaterial): Record<string, { value: unknown }> {
  return m.uniforms as Record<string, { value: unknown }>;
}

function setU(m: ShaderMaterial, name: string, v: number): void {
  const u = uniformsOf(m)[name];
  if (u) u.value = v;
}

function colorU(m: ShaderMaterial, name: string): Color {
  const u = uniformsOf(m)[name];
  if (u && u.value instanceof Color) return u.value;
  const c = new Color();
  if (u) u.value = c;
  return c;
}

/* ------------------------------------------------------------------ */
/* buildShip                                                          */
/* ------------------------------------------------------------------ */

export function buildShip(design: ShipDesign, livery: Livery, quality: "high" | "low"): ShipModel {
  const root = new Group();
  root.name = `ship:${design.id}`;
  const body = new Group();
  root.add(body);

  const { mats, textures } = makeMaterials(livery, quality, RACE_NUMBERS[design.id] ?? 0);
  const ctx = new Ctx(quality, body, mats);
  (BUILDERS[design.id] ?? buildComet)(ctx);
  ctx.finish();

  const geos = ctx.geos;
  const shaderMats: ShaderMaterial[] = [];
  const glowColor = new Color(livery.glow);

  // Three crossed quads: a cheap any-angle glow for nozzle blooms and drift sparks.
  const crossParts = new Batch();
  crossParts.add(new PlaneGeometry(1, 1));
  crossParts.add(new PlaneGeometry(1, 1), { r: [0, Math.PI / 2, 0] });
  crossParts.add(new PlaneGeometry(1, 1), { r: [Math.PI / 2, 0, 0] });
  const crossGeo = crossParts.build() ?? new BufferGeometry();
  geos.push(crossGeo);

  // Flames: an outer livery-coloured cone, a white-hot core and a bloom per nozzle.
  const hi = quality === "high";
  const flameGeo = new LatheGeometry(
    [
      [0.78, 0],
      [0.98, 0.06],
      [1.0, 0.16],
      [0.8, 0.42],
      [0.42, 0.74],
      [0.0005, 1],
    ].map(([r, t]) => new Vector2(r, t)),
    hi ? 18 : 10,
  );
  flameGeo.rotateX(Math.PI / 2);
  geos.push(flameGeo);
  const coreBase = glowColor.clone().lerp(new Color("#ffffff"), 0.75);
  interface Flame {
    group: Group;
    outer: Mesh;
    core: Mesh;
    bloom: Mesh;
    outerMat: ShaderMaterial;
    coreMat: ShaderMaterial;
    r: number;
    seed: number;
  }
  const bloomMat = glowMaterial(glowColor, 0.9, 2.4);
  shaderMats.push(bloomMat);
  const flames: Flame[] = ctx.nozzles.map((n, i) => {
    const seed = i * 2.37 + 0.5;
    const outerMat = flameMaterial(glowColor, coreBase, seed);
    const coreMat = flameMaterial(coreBase, new Color("#ffffff"), seed + 1.1);
    shaderMats.push(outerMat, coreMat);
    const group = new Group();
    group.position.copy(n.pos);
    const outer = new Mesh(flameGeo, outerMat);
    const core = new Mesh(flameGeo, coreMat);
    outer.renderOrder = 3;
    core.renderOrder = 4;
    const bloom = new Mesh(crossGeo, bloomMat);
    bloom.position.z = n.r * 0.25;
    bloom.renderOrder = 5;
    group.add(outer, core, bloom);
    body.add(group);
    return { group, outer, core, bloom, outerMat, coreMat, r: n.r, seed };
  });

  // Underglow.
  const [ugW, ugL, ugZ] = ctx.underglow;
  const ugGeo = new PlaneGeometry(ugW, ugL);
  ugGeo.rotateX(-Math.PI / 2);
  geos.push(ugGeo);
  const ugMat = glowMaterial(glowColor, 0.75, 1.6);
  shaderMats.push(ugMat);
  const underglow = new Mesh(ugGeo, ugMat);
  underglow.position.set(0, 0.04, ugZ);
  underglow.renderOrder = 1;
  body.add(underglow);

  // Drift spark emitters: three crossed quads each side.
  const sparkMat = glowMaterial(new Color(DRIFT_COLORS[1]), 1.2, 2.2);
  shaderMats.push(sparkMat);
  const sparks: Mesh[] = [];
  const [sx, sy, sz] = ctx.sparks;
  for (const side of [1, -1]) {
    const m = new Mesh(crossGeo, sparkMat);
    m.position.set(sx * side, sy, sz);
    m.visible = false;
    m.renderOrder = 5;
    body.add(m);
    sparks.push(m);
  }

  // Shield bubble.
  const shieldGeo = new SphereGeometry(1, hi ? 40 : 20, hi ? 28 : 14);
  geos.push(shieldGeo);
  const shieldMat = new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(SHIELD_COLOR) },
      uAlpha: { value: 1 },
      uTime: { value: 0 },
      uPop: { value: 0 },
    },
    vertexShader: FRESNEL_VERT,
    fragmentShader: SHIELD_FRAG,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  shaderMats.push(shieldMat);
  const shield = new Mesh(shieldGeo, shieldMat);
  shield.scale.set(1.45, 0.85, 2.0);
  shield.position.set(0, 0.52, 0);
  shield.visible = false;
  shield.renderOrder = 6;
  root.add(shield);

  // Ghost bookkeeping for the standard materials.
  const allMats = Object.values(mats);
  const baseState = new Map<Material, { opacity: number; transparent: boolean; depthWrite: boolean }>();
  for (const m of allMats) baseState.set(m, { opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite });

  const glowMat = mats.glowN as MeshStandardMaterial;
  let driftTier: 0 | 1 | 2 | 3 = 0;
  let shieldSince = -1;
  const tmpColor = new Color();

  const exhausts = ctx.nozzles.map((n) => n.pos.clone());

  return {
    root,
    body,
    exhausts,

    setThrottle(throttle: number, boost: number, time: number): void {
      const th = Math.min(1, Math.max(0, throttle));
      const bo = Math.min(1, Math.max(0, boost));
      for (const f of flames) {
        const flick = 0.88 + 0.08 * Math.sin(time * 37 + f.seed) + 0.05 * Math.sin(time * 71 + f.seed * 3.1);
        const len = f.r * (1.5 + th * 4.6 + bo * 6.5) * flick;
        const w = f.r * (0.82 + 0.1 * th + 0.18 * bo);
        f.outer.scale.set(w, w, len);
        f.core.scale.set(w * 0.55, w * 0.55, len * (0.55 + 0.15 * bo));
        f.bloom.scale.setScalar(f.r * (2.2 + 1.4 * th + 1.6 * bo) * (0.94 + 0.06 * flick));
        const op = 0.4 + 0.6 * th + 0.3 * bo;
        setU(f.outerMat, "uOpacity", op);
        setU(f.coreMat, "uOpacity", op * 1.1);
        setU(f.outerMat, "uTime", time);
        setU(f.coreMat, "uTime", time);
        colorU(f.outerMat, "uColor").copy(glowColor).lerp(BOOST_OUTER, bo * 0.55);
        colorU(f.coreMat, "uColor").copy(coreBase).lerp(BOOST_CORE, bo);
        colorU(f.outerMat, "uCore").copy(coreBase).lerp(BOOST_CORE, bo);
      }
      glowMat.emissiveIntensity = 1.2 + th * 2.2 + bo * 3 + 0.25 * Math.sin(time * 23);
      tmpColor.copy(glowColor).lerp(BOOST_CORE, bo * 0.5);
      glowMat.emissive.copy(tmpColor);
      setU(ugMat, "uOpacity", 0.6 + 0.15 * th + 0.08 * Math.sin(time * 5.3) + (driftTier > 0 ? 0.25 : 0));
      for (const w of ctx.wobbles) {
        const v = w.base + Math.sin(time * (3.1 + th * 2) + w.phase) * w.amp * (0.4 + 0.6 * th);
        if (w.axis === 0) w.obj.rotation.x = v;
        else if (w.axis === 1) w.obj.rotation.y = v;
        else w.obj.rotation.z = v;
      }
      if (driftTier > 0) {
        for (let i = 0; i < sparks.length; i++) {
          const s = 0.3 + 0.12 * driftTier + 0.18 * Math.abs(Math.sin(time * 47 + i * 1.9));
          sparks[i].scale.setScalar(s);
          sparks[i].rotation.set(time * 9 + i, time * 13, time * 7 + i * 2);
        }
      }
    },

    setDriftGlow(tier: 0 | 1 | 2 | 3): void {
      driftTier = tier;
      for (const s of sparks) s.visible = tier > 0;
      if (tier > 0) {
        const c = new Color(DRIFT_COLORS[tier]);
        colorU(sparkMat, "uColor").copy(c);
        colorU(ugMat, "uColor").copy(glowColor).lerp(c, 0.8);
      } else {
        colorU(ugMat, "uColor").copy(glowColor);
      }
    },

    setShield(on: boolean, time: number): void {
      if (on && !shield.visible) shieldSince = time;
      if (!on) shieldSince = -1;
      shield.visible = on;
      if (!on) return;
      const age = Math.max(0, time - shieldSince);
      const pop = Math.exp(-age * 6);
      setU(shieldMat, "uTime", time);
      setU(shieldMat, "uPop", pop);
      const s = 1 + 0.25 * pop + 0.015 * Math.sin(time * 6);
      shield.scale.set(1.45 * s, 0.85 * s, 2.0 * s);
    },

    setGhost(alpha: number): void {
      const a = Math.min(1, Math.max(0, alpha));
      const ghost = a < 0.999;
      for (const m of allMats) {
        const b = baseState.get(m);
        if (!b) continue;
        const transparent = b.transparent || ghost;
        if (m.transparent !== transparent) {
          m.transparent = transparent;
          m.needsUpdate = true;
        }
        m.opacity = b.opacity * a;
        m.depthWrite = ghost ? false : b.depthWrite;
      }
      for (const m of shaderMats) setU(m, "uAlpha", a);
    },

    dispose(): void {
      root.removeFromParent();
      for (const g of geos) g.dispose();
      for (const m of allMats) m.dispose();
      for (const m of shaderMats) m.dispose();
      for (const t of textures) t.dispose();
    },
  };
}

/* ------------------------------------------------------------------ */
/* Menu icons                                                         */
/* ------------------------------------------------------------------ */

interface IconSpec {
  body: string;
  accent: string[];
  dark?: string[];
  canopy: readonly [number, number, number, number];
  nozzles: readonly number[];
}

const ICONS: Record<string, IconSpec> = {
  comet: {
    body: "M9 21 Q11 15 22 15 L42 16 Q55 18 61 21 Q55 24 42 25.5 L22 27 Q11 27 9 21Z",
    accent: ["M20 24 L38 23.5 L28 31 L16 31Z", "M11 16 L19 16 L13 8 L9 8.5Z"],
    canopy: [37, 16, 7, 3.6],
    nozzles: [21],
  },
  hammerhead: {
    body: "M9 20 Q10 15 20 15 L46 16 Q58 18 60 21 Q57 25 46 25.5 L20 26 Q10 26 9 20Z",
    accent: ["M44 17 L60 16 Q63 21 60 26 L44 25Z", "M12 16 L20 16 L15 10 L11 10Z"],
    canopy: [33, 15.5, 7, 3.4],
    nozzles: [18.5, 23],
  },
  gemini: {
    body: "M8 22 Q9 17 16 17 L50 17.5 Q60 19 62 22 Q60 25 50 26 L16 26.5 Q9 26.5 8 22Z",
    accent: ["M20 17 Q24 12 36 12 Q46 13 50 17Z", "M10 17 L16 17 L13 9 L9 9Z", "M8 8.5 L15 8.5 L15 10 L8 10Z"],
    canopy: [40, 13.5, 6, 2.8],
    nozzles: [22],
  },
  "nebula-queen": {
    body: "M6 22 Q10 17 32 16.5 Q55 17 60 22 Q55 26.5 32 27 Q10 26.5 6 22Z",
    accent: ["M6 22 Q32 24 60 22 Q55 26.5 32 27 Q10 26.5 6 22Z", "M10 18 L15 18 L12 11 L9 11Z"],
    canopy: [33, 16, 9, 6],
    nozzles: [21.5],
  },
  "iron-moon": {
    body: "M8 13 L40 13 L56 18 Q60 20 59 24 L57 28 L8 28Z",
    accent: ["M8 24 L58 24 L57 30 L8 30Z", "M9 7 L20 7 L20 9 L9 9Z"],
    dark: ["M12 9 L13.5 9 L13.5 13 L12 13Z", "M17 9 L18.5 9 L18.5 13 L17 13Z"],
    canopy: [42, 13, 7, 4],
    nozzles: [17, 22.5],
  },
  pulsar: {
    body: "M10 21 Q12 17 22 17 L44 18 Q56 19.5 63 21 Q56 22.5 44 24 L22 25 Q12 25 10 21Z",
    accent: ["M14 22.5 L30 22.5 L18 29 L12 29Z", "M17 21 L50 20.2 L50 21.8 L17 22Z"],
    dark: ["M28 12 Q33 21 28 30 L26 30 Q31 21 26 12Z"],
    canopy: [42, 17.5, 7, 3],
    nozzles: [21],
  },
  rosie: {
    body: "M10 21 Q10 15.5 22 15.5 L40 15.5 Q54 16 62 21 Q54 26 40 26.5 L22 26.5 Q10 26.5 10 21Z",
    accent: ["M50 16.5 Q57 18 62 21 Q57 24 50 25.5Z", "M26 15.5 L31 15.5 L31 26.5 L26 26.5Z", "M8 10 L16 10 L24 17 L14 17Z", "M8 32 L16 32 L24 25 L14 25Z"],
    canopy: [42, 15.5, 5.5, 4.5],
    nozzles: [21],
  },
  manta: {
    body: "M6 22 Q14 17 30 17 Q48 17 58 20 L62 19 L60 22 L62 25 L58 24 Q48 27 30 27 Q14 27 6 22Z",
    accent: ["M18 23 L44 22 L44 23.5 L18 24.5Z", "M24 17.5 L30 17.5 L27 12.5 L23.5 12.5Z"],
    canopy: [42, 17.5, 6, 3],
    nozzles: [22],
  },
};

/** Tiny SVG string (viewBox 0 0 64 40) side silhouette of the ship in its livery, for menus. */
export function shipIconSvg(design: ShipDesign, livery: Livery): string {
  const spec = ICONS[design.id] ?? ICONS.comet;
  const esc = (s: string): string => s.replace(/[^#0-9a-zA-Z(),.% -]/g, "");
  const p = esc(livery.primary);
  const s = esc(livery.secondary);
  const g = esc(livery.glow);
  const [cx, cy, rx, ry] = spec.canopy;
  const flames = spec.nozzles
    .map(
      (y) =>
        `<path d="M8 ${y - 2.4} L0.5 ${y} L8 ${y + 2.4}Z" fill="${g}" opacity="0.9"/>` +
        `<path d="M8 ${y - 1.1} L3.5 ${y} L8 ${y + 1.1}Z" fill="#fff"/>` +
        `<rect x="6.5" y="${y - 2.6}" width="4" height="5.2" rx="1.2" fill="#c9d2de" stroke="#2a2f3a" stroke-width="0.6"/>`,
    )
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 40">` +
    `<ellipse cx="34" cy="35.5" rx="24" ry="2.2" fill="${g}" opacity="0.45"/>` +
    flames +
    `<path d="${spec.body}" fill="${p}" stroke="#12141c" stroke-width="1" stroke-linejoin="round"/>` +
    spec.accent.map((d) => `<path d="${d}" fill="${s}" stroke="#12141c" stroke-width="0.8" stroke-linejoin="round"/>`).join("") +
    (spec.dark ?? []).map((d) => `<path d="${d}" fill="#3a4050" stroke="#12141c" stroke-width="0.6"/>`).join("") +
    `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${g}" opacity="0.85" stroke="#12141c" stroke-width="0.8"/>` +
    `<ellipse cx="${cx - rx * 0.3}" cy="${cy - ry * 0.35}" rx="${rx * 0.35}" ry="${ry * 0.25}" fill="#fff" opacity="0.7"/>` +
    `</svg>`
  );
}

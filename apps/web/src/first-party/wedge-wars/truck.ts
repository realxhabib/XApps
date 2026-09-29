/**
 * The wedge truck, modeled in code: a faceted stainless hull built from
 * cross-section "stations" (flat panels, sharp creases, a glass band), hex
 * fender flares, chunky off-road wheels, a full-width light bar, underglow,
 * decals, per-armor-kit mods (roll cage, spikes, skirts, bolted plates) and
 * the four weapons. `TruckRig` owns one truck's scene graph and animates it
 * (suspension, wheels, weapon strokes, damage wear, flying panels).
 *
 * Truck space: +Z forward, +Y up, origin at the physics body's center
 * (≈ 0.63 m above the floor at rest).
 */

import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  LatheGeometry,
  PointLight,
  Shape,
  TorusGeometry,
  Vector2,
  Vector3,
  type Material,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { ARMORS, HP_MAX, PAINTS, type Loadout, type WeaponKind } from "./logic";
import { brushedSteel, doorDecal, heatNoise, hoodDecal, softDot, tireTread } from "./textures";

/* ---------------------------------------------------------------------- */
/* Dimensions (shared with physics)                                       */
/* ---------------------------------------------------------------------- */

export const WHEEL_RADIUS = 0.37;
export const WHEEL_Y = -0.26;
export const WHEELS: { x: number; z: number; front: boolean }[] = [
  { x: -0.84, z: 0.88, front: true },
  { x: 0.84, z: 0.88, front: true },
  { x: -0.84, z: -0.9, front: false },
  { x: 0.84, z: -0.9, front: false },
];
/** Where each weapon reaches, in truck space (hit sphere center + radius). */
export const WEAPON_ZONE: Record<WeaponKind, { x: number; y: number; z: number; r: number }> = {
  spinner: { x: 0, y: -0.02, z: 1.72, r: 1.05 },
  flipper: { x: 0, y: -0.1, z: 2.05, r: 1.0 },
  hammer: { x: 0, y: 0.3, z: 2.1, r: 0.85 },
  flamer: { x: 0, y: 0.05, z: 1.75, r: 0 },
};
export const FLAME_NOZZLES = [
  { x: -0.42, y: 0.03, z: 1.78 },
  { x: 0.42, y: 0.03, z: 1.78 },
];
export const EXHAUSTS = [
  { x: -0.5, y: 1.04, z: -0.74 },
  { x: 0.5, y: 1.04, z: -0.74 },
];

/* ---------------------------------------------------------------------- */
/* Hull                                                                   */
/* ---------------------------------------------------------------------- */

interface Station {
  z: number;
  yb: number;
  ySill: number;
  yBelt: number;
  yTop: number;
  wLow: number;
  wBelt: number;
  wTop: number;
}

/**
 * Front to back. The hood + windshield share one straight line from the
 * nose chamfer to the roof apex; the sail runs straight from the apex to the
 * tail; the belt crease is one straight line — that is the whole look.
 */
const STATIONS: Station[] = [
  { z: 1.43, yb: -0.07, ySill: -0.02, yBelt: 0.1, yTop: 0.13, wLow: 0.6, wBelt: 0.7, wTop: 0.66 },
  { z: 1.25, yb: -0.19, ySill: -0.06, yBelt: 0.22, yTop: 0.25, wLow: 0.72, wBelt: 0.82, wTop: 0.77 },
  { z: 0.45, yb: -0.21, ySill: -0.06, yBelt: 0.27, yTop: 0.581, wLow: 0.74, wBelt: 0.84, wTop: 0.654 },
  { z: -0.2, yb: -0.21, ySill: -0.06, yBelt: 0.311, yTop: 0.85, wLow: 0.74, wBelt: 0.84, wTop: 0.56 },
  { z: -0.55, yb: -0.21, ySill: -0.06, yBelt: 0.333, yTop: 0.745, wLow: 0.74, wBelt: 0.84, wTop: 0.611 },
  { z: -1.3, yb: -0.19, ySill: -0.05, yBelt: 0.38, yTop: 0.52, wLow: 0.72, wBelt: 0.83, wTop: 0.72 },
  { z: -1.43, yb: -0.08, ySill: 0.0, yBelt: 0.36, yTop: 0.47, wLow: 0.64, wBelt: 0.76, wTop: 0.68 },
];

function section(s: Station): [number, number][] {
  return [
    [-s.wLow, s.yb],
    [-s.wBelt, s.ySill],
    [-s.wBelt, s.yBelt],
    [-s.wTop, s.yTop],
    [s.wTop, s.yTop],
    [s.wBelt, s.yBelt],
    [s.wBelt, s.ySill],
    [s.wLow, s.yb],
  ];
}

/** Which faces are glass: side windows (edges 2-3, 4-5) over the cab, windshield + rear glass on top (3-4). */
function isGlass(segment: number, edge: number): boolean {
  if (segment === 2 || segment === 3) return edge === 2 || edge === 4 || edge === 3;
  // The long sail over the bed is a dark glazed vault cover.
  if (segment === 4) return edge === 3;
  return false;
}

/**
 * The hull as flat-shaded triangles (non-indexed, so every panel gets its
 * own crisp normal). Group 0 = stainless, group 1 = glass. UVs are planar per
 * face, along the truck's length, so the brushed grain runs front to back.
 */
export function buildHullGeometry(): BufferGeometry {
  const steel: number[] = [];
  const glass: number[] = [];
  const tri = (out: number[], a: Vector3, b: Vector3, c: Vector3, center: Vector3) => {
    // Orient outward.
    const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
    const mid = new Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3);
    if (n.dot(mid.sub(center)) < 0) out.push(a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z);
    else out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };
  for (let i = 0; i < STATIONS.length - 1; i++) {
    const s0 = STATIONS[i]!;
    const s1 = STATIONS[i + 1]!;
    const p0 = section(s0);
    const p1 = section(s1);
    const center = new Vector3(0, 0.2, (s0.z + s1.z) / 2);
    for (let e = 0; e < 8; e++) {
      const f = (e + 1) % 8;
      const a = new Vector3(p0[e]![0], p0[e]![1], s0.z);
      const b = new Vector3(p0[f]![0], p0[f]![1], s0.z);
      const c = new Vector3(p1[f]![0], p1[f]![1], s1.z);
      const d = new Vector3(p1[e]![0], p1[e]![1], s1.z);
      const out = isGlass(i, e) ? glass : steel;
      tri(out, a, b, c, center);
      tri(out, a, c, d, center);
    }
  }
  // End caps (fans).
  for (const [s, dir] of [
    [STATIONS[0]!, 1],
    [STATIONS[STATIONS.length - 1]!, -1],
  ] as const) {
    const p = section(s);
    const c = new Vector3(0, (s.yb + s.yTop) / 2, s.z);
    const inside = new Vector3(0, 0.2, s.z - dir);
    for (let e = 0; e < 8; e++) {
      const f = (e + 1) % 8;
      tri(steel, c, new Vector3(p[e]![0], p[e]![1], s.z), new Vector3(p[f]![0], p[f]![1], s.z), inside);
    }
  }
  const positions = new Float32Array([...steel, ...glass]);
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(positions, 3));
  geo.addGroup(0, steel.length / 3, 0);
  geo.addGroup(steel.length / 3, glass.length / 3, 1);
  geo.computeVertexNormals();
  planarUvs(geo, 0.9);
  return geo;
}

/** Per-face planar UVs by dominant normal axis (grain along z). */
function planarUvs(geo: BufferGeometry, scale: number): void {
  const pos = geo.getAttribute("position");
  const nor = geo.getAttribute("normal");
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    const nz = Math.abs(nor.getZ(i));
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    let u = z;
    let v = y;
    if (ny >= nx && ny >= nz) v = x;
    else if (nz >= nx && nz >= ny) {
      u = x;
      v = y;
    }
    uv[i * 2] = u * scale;
    uv[i * 2 + 1] = v * scale * 6;
  }
  geo.setAttribute("uv", new BufferAttribute(uv, 2));
}

/** Presses dents into a (per-truck) hull geometry: vertices near `p` move inward. */
export function dentHull(geo: BufferGeometry, p: { x: number; y: number; z: number; depth: number }): void {
  const pos = geo.getAttribute("position") as BufferAttribute;
  const radius = 0.42;
  const cx = 0;
  const cy = 0.25;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const d = Math.hypot(x - p.x, y - p.y, z - p.z);
    if (d > radius) continue;
    const k = (1 - d / radius) ** 2 * p.depth;
    // Push toward the hull's core line.
    const dx = cx - x;
    const dy = cy - y;
    const len = Math.hypot(dx, dy) || 1;
    pos.setXYZ(i, x + (dx / len) * k, y + (dy / len) * k, z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

/* ---------------------------------------------------------------------- */
/* Shared materials                                                       */
/* ---------------------------------------------------------------------- */

const shared = new Map<string, Material>();
function mat<T extends Material>(key: string, make: () => T): T {
  if (!shared.has(key)) shared.set(key, make());
  return shared.get(key) as T;
}

export function makeSteel(anisotropy: boolean): MeshPhysicalMaterial {
  const tex = brushedSteel();
  const m = new MeshPhysicalMaterial({
    color: new Color("#e2e6eb"),
    metalness: 1,
    roughness: 1,
    roughnessMap: tex.roughness,
    normalMap: tex.normal,
    normalScale: new Vector2(0.18, 0.18),
    envMapIntensity: 1.25,
    flatShading: false,
  });
  if (anisotropy) {
    m.anisotropy = 0.55;
    m.anisotropyRotation = 0;
  }
  return m;
}

const glassMat = () =>
  mat(
    "glass",
    () =>
      new MeshPhysicalMaterial({
        color: "#10161f",
        metalness: 0.85,
        roughness: 0.06,
        clearcoat: 1,
        clearcoatRoughness: 0.04,
        envMapIntensity: 2.2,
      }),
  );
const plasticMat = () => mat("plastic", () => new MeshStandardMaterial({ color: "#16181d", roughness: 0.72, metalness: 0.05 }));
const gunmetalMat = () =>
  mat("gunmetal", () => {
    const tex = brushedSteel();
    return new MeshStandardMaterial({
      color: "#586070",
      roughness: 0.55,
      metalness: 0.9,
      normalMap: tex.normal,
      normalScale: new Vector2(0.4, 0.4),
      envMapIntensity: 1.1,
    });
  });
const chromeMat = () => mat("chrome", () => new MeshStandardMaterial({ color: "#eef1f5", roughness: 0.12, metalness: 1, envMapIntensity: 1.4 }));
const darkSteelMat = () => mat("darkSteel", () => new MeshStandardMaterial({ color: "#2a2e36", roughness: 0.4, metalness: 0.95 }));
const rubberMat = () =>
  mat("rubber", () => {
    const t = tireTread();
    const normal = t.normal.clone();
    normal.repeat.set(2, 1);
    normal.needsUpdate = true;
    return new MeshStandardMaterial({ color: "#1b1c1f", roughness: 0.88, metalness: 0, normalMap: normal, normalScale: new Vector2(1.6, 1.6), envMapIntensity: 0.6 });
  });
const lightMat = () =>
  mat("lightbar", () => new MeshStandardMaterial({ color: "#000", emissive: new Color("#f4f8ff"), emissiveIntensity: 7, toneMapped: false }));
const tailMat = () =>
  mat("taillight", () => new MeshStandardMaterial({ color: "#000", emissive: new Color("#ff1a2a"), emissiveIntensity: 5, toneMapped: false }));
const pilotMat = () =>
  mat("pilot", () => new MeshBasicMaterial({ color: new Color("#4aa8ff").multiplyScalar(4), toneMapped: false }));
const blurMat = () =>
  mat(
    "blur",
    () =>
      new MeshBasicMaterial({
        color: "#dfe6f0",
        map: ringTexture(),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      }),
  );

let ringTex: import("three").Texture | null = null;
function ringTexture() {
  if (!ringTex) ringTex = softDot();
  return ringTex;
}

function paintMat(hex: string): MeshStandardMaterial {
  return mat(
    `paint:${hex}`,
    () =>
      new MeshStandardMaterial({
        color: hex,
        roughness: 0.35,
        metalness: 0.4,
        emissive: new Color(hex),
        emissiveIntensity: 0.35,
      }),
  );
}
function paintGlowMat(hex: string): MeshBasicMaterial {
  return mat(`glow:${hex}`, () => new MeshBasicMaterial({ color: new Color(hex).multiplyScalar(3.2), toneMapped: false }));
}
function underglowMat(hex: string): MeshBasicMaterial {
  return mat(
    `under:${hex}`,
    () =>
      new MeshBasicMaterial({
        color: new Color(hex).multiplyScalar(1.4),
        map: softDot(),
        transparent: true,
        opacity: 0.55,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
  );
}
function decalMat(key: string, tex: import("three").Texture): MeshStandardMaterial {
  return mat(
    key,
    () =>
      new MeshStandardMaterial({
        map: tex,
        transparent: true,
        roughness: 0.45,
        metalness: 0.3,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        depthWrite: false,
      }),
  );
}

/* ---------------------------------------------------------------------- */
/* Shared geometries                                                      */
/* ---------------------------------------------------------------------- */

const geos = new Map<string, BufferGeometry>();
function geo<T extends BufferGeometry>(key: string, make: () => T): T {
  if (!geos.has(key)) geos.set(key, make());
  return geos.get(key) as T;
}

let hullTemplate: BufferGeometry | null = null;
function hullGeometry(): BufferGeometry {
  if (!hullTemplate) hullTemplate = buildHullGeometry();
  return hullTemplate.clone();
}

function flareGeometry(): BufferGeometry {
  return geo("flare", () => {
    const outer = 0.55;
    const inner = 0.44;
    const angles = [0, 32, 68, 112, 148, 180].map((d) => (d * Math.PI) / 180);
    const s = new Shape();
    s.moveTo(Math.cos(angles[0]!) * outer + 0.06, -0.06);
    for (const a of angles) s.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
    s.lineTo(-outer - 0.06, -0.06);
    s.lineTo(-inner, -0.06);
    for (const a of [...angles].reverse()) s.lineTo(Math.cos(a) * inner, Math.sin(a) * inner);
    s.lineTo(inner, -0.06);
    s.closePath();
    const g = new ExtrudeGeometry(s, { depth: 0.2, bevelEnabled: false });
    g.rotateY(-Math.PI / 2);
    return g;
  });
}

/** Off-road tire: lathed profile with rounded shoulders; tread band in the middle of the UV range. */
function tireGeometry(): BufferGeometry {
  return geo("tire", () => {
    const R = WHEEL_RADIUS;
    const w = 0.17;
    const pts = [
      new Vector2(0.2, -w),
      new Vector2(R - 0.07, -w),
      new Vector2(R - 0.025, -w + 0.025),
      new Vector2(R, -w + 0.07),
      new Vector2(R, w - 0.07),
      new Vector2(R - 0.025, w - 0.025),
      new Vector2(R - 0.07, w),
      new Vector2(0.2, w),
    ];
    const g = new LatheGeometry(pts, 28);
    // Lathe spins around Y: turn the axle to X.
    g.rotateZ(Math.PI / 2);
    return g;
  });
}

/** Six lug nuts + a center cap, merged. */
function lugGeometry(): BufferGeometry {
  return geo("lugs", () => {
    const parts: BufferGeometry[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      parts.push(new CylinderGeometry(0.022, 0.022, 0.03, 6).rotateZ(Math.PI / 2).translate(0, Math.cos(a) * 0.11, Math.sin(a) * 0.11));
    }
    parts.push(new CylinderGeometry(0.06, 0.07, 0.04, 8).rotateZ(Math.PI / 2));
    return mergeGeometries(parts.map((p) => p.toNonIndexed())) ?? parts[0]!;
  });
}

function tube(a: Vector3, b: Vector3, r: number, material: Material): Mesh {
  const len = a.distanceTo(b);
  const m = new Mesh(geo(`tube:${r}`, () => new CylinderGeometry(r, r, 1, 8)), material);
  m.scale.set(1, len, 1);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), new Vector3().subVectors(b, a).normalize());
  m.castShadow = true;
  return m;
}

function box(w: number, h: number, d: number, material: Material, x = 0, y = 0, z = 0): Mesh {
  const m = new Mesh(geo(`box:${w}:${h}:${d}`, () => new BoxGeometry(w, h, d)), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** A plate with rivet heads merged in (one draw call). */
function rivetedPlate(w: number, h: number, d: number): BufferGeometry {
  return geo(`plate:${w}:${h}:${d}`, () => {
    const parts: BufferGeometry[] = [new BoxGeometry(w, h, d)];
    const rivet = new CylinderGeometry(0.022, 0.026, 0.02, 6);
    // Rivets on the largest face; figure out which axis is thin.
    const thin = w <= h && w <= d ? "x" : h <= w && h <= d ? "y" : "z";
    const [a, b] = thin === "x" ? [d, h] : thin === "y" ? [w, d] : [w, h];
    const nA = Math.max(2, Math.round(a / 0.22));
    const nB = Math.max(2, Math.round(b / 0.22));
    for (let i = 0; i < nA; i++) {
      for (let j = 0; j < nB; j++) {
        if (i !== 0 && i !== nA - 1 && j !== 0 && j !== nB - 1) continue;
        const u = (i / (nA - 1) - 0.5) * (a - 0.08);
        const v = (j / (nB - 1) - 0.5) * (b - 0.08);
        for (const side of [1, -1]) {
          const r = rivet.clone();
          if (thin === "x") {
            r.rotateZ(Math.PI / 2);
            r.translate((side * w) / 2, v, u);
          } else if (thin === "y") {
            r.translate(u, (side * h) / 2, v);
          } else {
            r.rotateX(Math.PI / 2);
            r.translate(u, v, (side * d) / 2);
          }
          parts.push(r);
        }
      }
    }
    const merged = mergeGeometries(parts.map((p) => p.toNonIndexed()));
    return merged ?? parts[0]!;
  });
}

/* ---------------------------------------------------------------------- */
/* Rig                                                                    */
/* ---------------------------------------------------------------------- */

export interface RigState {
  dt: number;
  time: number;
  /** Forward speed (m/s), steering −1..1 (+ = right). */
  speed: number;
  steer: number;
  grounded: boolean;
  /** Body-frame accelerations (m/s²): +forward, +right. */
  accelLong: number;
  accelLat: number;
  /** Weapon: 0..1 animation (flipper/hammer stroke), spin 0..1, flames on. */
  weaponAnim: number;
  spin: number;
  firing: boolean;
  boosting: boolean;
  /** 0..1 hull + armor left. */
  health: number;
  scorch: number;
  alive: boolean;
}

interface Detachable {
  obj: Object3D;
  threshold: number;
  gone: boolean;
}

export interface RigOptions {
  loadout: Loadout;
  number: number;
  quality: "high" | "medium" | "low";
  /** Garage turntable: no damage state. */
  showroom?: boolean;
}

/** Called when a panel flies off: world position + its color. */
export type DetachHandler = (x: number, y: number, z: number, color: string) => void;

export class TruckRig {
  readonly root = new Group();
  /** Suspension group: the hull and everything bolted to it. */
  readonly body = new Group();
  readonly loadout: Loadout;
  private readonly hull: Mesh;
  private readonly hullGeo: BufferGeometry;
  private readonly steel: MeshPhysicalMaterial;
  private readonly steelBase = new Color("#e2e6eb");
  private readonly grime = new Color("#4a4038");
  private readonly wheels: { pivot: Group; spinner: Group; front: boolean; x: number }[] = [];
  private readonly detachables: Detachable[] = [];
  private readonly lightBar: Mesh;
  private underglow: Mesh | null = null;
  // Weapon parts
  private spinPivot: Group | null = null;
  private spinBlur: Mesh | null = null;
  private spinBar: Group | null = null;
  private flipHinge: Group | null = null;
  private flipPistons: Mesh[] = [];
  private hammerPivot: Group | null = null;
  private flameLight: PointLight | null = null;
  private pilots: Mesh[] = [];
  private haze: Mesh | null = null;
  private hazeMap: import("three").Texture | null = null;
  // Suspension state
  private pitch = 0;
  private pitchV = 0;
  private roll = 0;
  private rollV = 0;
  private heave = 0;
  private heaveV = 0;
  private wheelDrop = 0;
  private wheelSpin = 0;
  private spinAngle = 0;
  private dentCount = 0;

  constructor(options: RigOptions) {
    const { loadout, quality } = options;
    this.loadout = loadout;
    const paint = PAINTS[loadout.paint]?.hex ?? "#c6ff3d";
    this.steel = makeSteel(quality === "high");
    this.hullGeo = hullGeometry();
    this.hull = new Mesh(this.hullGeo, [this.steel, glassMat()]);
    this.hull.castShadow = true;
    this.hull.receiveShadow = true;
    this.body.add(this.hull);
    this.root.add(this.body);

    // Belt-line crease stripe, both sides, in the paint color.
    const stripeLen = Math.hypot(2.55, 0.16);
    for (const side of [-1, 1]) {
      const s = new Mesh(geo("stripe", () => new BoxGeometry(0.012, 0.035, stripeLen)), paintGlowMat(paint));
      s.position.set(side * 0.845, 0.3, -0.025);
      s.rotation.x = 0.0627;
      this.body.add(s);
    }
    // Underbody black chassis rails + skid.
    this.body.add(box(1.3, 0.1, 2.5, plasticMat(), 0, -0.24, 0));

    // Light bars.
    this.lightBar = box(1.34, 0.032, 0.03, lightMat(), 0, 0.196, 1.338);
    this.lightBar.rotation.x = -0.6;
    this.lightBar.castShadow = false;
    this.body.add(this.lightBar);
    this.body.add(box(1.5, 0.14, 0.12, darkSteelMat(), 0, -0.1, -1.46));
    this.body.add(box(0.5, 0.16, 0.012, plasticMat(), 0, 0.14, -1.438));
    const tail = box(1.34, 0.03, 0.02, tailMat(), 0, 0.42, -1.44);
    tail.castShadow = false;
    this.body.add(tail);

    // Decals.
    const hood = new Mesh(geo("hoodDecal", () => new PlaneGeometry(1.18, 0.82)), decalMat(`hood:${paint}:${options.number}`, hoodDecal(paint, options.number)));
    {
      const y = new Vector3(0, -0.331, 0.8).normalize();
      const x = new Vector3(-1, 0, 0);
      const z = new Vector3().crossVectors(x, y).normalize();
      hood.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
      hood.position.set(0, 0.415, 0.85).addScaledVector(z, 0.004);
    }
    hood.receiveShadow = true;
    this.body.add(hood);
    for (const side of [-1, 1]) {
      const door = new Mesh(geo("doorDecal", () => new PlaneGeometry(0.78, 0.39)), decalMat(`door:${paint}:${options.number}`, doorDecal(paint, options.number)));
      door.position.set(side * 0.846, 0.1, -0.1);
      door.rotation.y = side * (Math.PI / 2);
      door.receiveShadow = true;
      this.body.add(door);
    }

    // Exhaust stacks (everyone).
    for (const e of EXHAUSTS) {
      const pipe = new Mesh(geo("exhaust", () => new CylinderGeometry(0.055, 0.06, 0.62, 10)), chromeMat());
      pipe.position.set(e.x, e.y - 0.3, e.z);
      pipe.castShadow = true;
      this.body.add(pipe);
      const tip = new Mesh(geo("exhaustTip", () => new CylinderGeometry(0.062, 0.062, 0.05, 10)), darkSteelMat());
      tip.position.set(e.x, e.y, e.z);
      this.body.add(tip);
    }

    // Fender flares (detach at low health).
    for (const w of WHEELS) {
      const f = new Mesh(flareGeometry(), plasticMat());
      f.position.set(w.x < 0 ? -0.74 : 0.94, WHEEL_Y, w.z);
      f.castShadow = true;
      this.body.add(f);
      this.detachables.push({ obj: f, threshold: w.front ? 0.28 : 0.18, gone: false });
    }

    // Wheels: lathed off-road tire (rounded shoulders, tread band), dark hex rim, lug nuts, paint ring.
    for (const w of WHEELS) {
      const pivot = new Group();
      pivot.position.set(w.x, WHEEL_Y, w.z);
      const spinner = new Group();
      const tire = new Mesh(tireGeometry(), rubberMat());
      tire.castShadow = true;
      tire.receiveShadow = true;
      spinner.add(tire);
      const rim = new Mesh(geo("rim", () => new CylinderGeometry(0.215, 0.215, 0.3, 6).rotateZ(Math.PI / 2)), darkSteelMat());
      rim.castShadow = true;
      spinner.add(rim);
      const ring = new Mesh(geo("rimRing", () => new TorusGeometry(0.2, 0.016, 6, 24).rotateY(Math.PI / 2)), paintGlowMat(paint));
      const outside = w.x < 0 ? -1 : 1;
      ring.position.x = outside * 0.152;
      spinner.add(ring);
      const lugs = new Mesh(lugGeometry(), chromeMat());
      lugs.position.x = outside * 0.15;
      lugs.scale.x = outside;
      spinner.add(lugs);
      pivot.add(spinner);
      this.root.add(pivot);
      this.wheels.push({ pivot, spinner, front: w.front, x: w.x });
    }

    // Underglow.
    if (quality !== "low") {
      const u = new Mesh(geo("underglow", () => new PlaneGeometry(2.6, 3.8).rotateX(-Math.PI / 2)), underglowMat(paint));
      u.position.set(0, -0.6, 0);
      u.renderOrder = 2;
      this.root.add(u);
      this.underglow = u;
    }

    this.buildMods(paint);
    this.buildWeapon(loadout.weapon, paint, quality);
    this.root.traverse((o) => {
      o.userData.truckPart = true;
    });
  }

  private buildMods(paint: string): void {
    const kind = this.loadout.armor;
    const cage = paintMat(paint);
    const add = (o: Object3D, threshold: number) => {
      this.body.add(o);
      this.detachables.push({ obj: o, threshold, gone: false });
    };
    if (kind === "scout") {
      // Roll cage over the sail.
      const g = new Group();
      const pts = {
        hl: new Vector3(-0.5, 1.0, -0.3),
        hr: new Vector3(0.5, 1.0, -0.3),
        bl: new Vector3(-0.62, 0.36, -0.3),
        br: new Vector3(0.62, 0.36, -0.3),
        tl: new Vector3(-0.58, 0.66, -1.36),
        tr: new Vector3(0.58, 0.66, -1.36),
      };
      g.add(tube(pts.hl, pts.hr, 0.035, cage));
      g.add(tube(pts.hl, pts.bl, 0.035, cage));
      g.add(tube(pts.hr, pts.br, 0.035, cage));
      g.add(tube(pts.hl, pts.tl, 0.032, cage));
      g.add(tube(pts.hr, pts.tr, 0.032, cage));
      g.add(tube(pts.hl, pts.tr, 0.028, cage));
      // Bull bar across the nose.
      g.add(tube(new Vector3(-0.6, 0.16, 1.52), new Vector3(0.6, 0.16, 1.52), 0.035, cage));
      g.add(tube(new Vector3(-0.45, -0.1, 1.5), new Vector3(-0.45, 0.16, 1.52), 0.03, cage));
      g.add(tube(new Vector3(0.45, -0.1, 1.5), new Vector3(0.45, 0.16, 1.52), 0.03, cage));
      add(g, 0.45);
      // Light pods on the cage.
      for (const x of [-0.3, 0.3]) {
        const pod = box(0.2, 0.08, 0.07, darkSteelMat(), x, 1.07, -0.28);
        const lens = box(0.17, 0.05, 0.01, lightMat(), x, 1.07, -0.24);
        lens.castShadow = false;
        const g2 = new Group();
        g2.add(pod, lens);
        add(g2, 0.6);
      }
    }
    if (kind === "brawler" || kind === "tank") {
      for (const side of [-1, 1]) {
        const skirt = new Mesh(rivetedPlate(0.05, 0.24, 0.92), gunmetalMat());
        skirt.position.set(side * 0.87, -0.13, -0.01);
        skirt.rotation.z = side * -0.14;
        skirt.castShadow = true;
        add(skirt, side < 0 ? 0.72 : 0.62);
      }
    }
    if (kind === "brawler") {
      const spikes = new Group();
      const cone = geo("spike", () => new ConeGeometry(0.065, 0.3, 6).rotateX(Math.PI / 2));
      for (let i = -2; i <= 2; i++) {
        const s = new Mesh(cone, chromeMat());
        s.position.set(i * 0.27, -0.08, 1.52);
        s.castShadow = true;
        spikes.add(s);
      }
      spikes.add(box(1.4, 0.12, 0.1, darkSteelMat(), 0, -0.08, 1.42));
      add(spikes, 0.5);
      for (const side of [-1, 1]) {
        const sideSpikes = new Group();
        for (const z of [-0.45, 0.35]) {
          const s = new Mesh(cone, chromeMat());
          s.rotation.y = side * (Math.PI / 2);
          s.position.set(side * 1.02, -0.13, z);
          s.castShadow = true;
          sideSpikes.add(s);
        }
        add(sideSpikes, side < 0 ? 0.35 : 0.3);
      }
    }
    if (kind === "tank") {
      const hood = new Mesh(rivetedPlate(1.3, 0.05, 0.62), gunmetalMat());
      hood.position.set(0, 0.46, 0.78);
      hood.rotation.x = 0.393;
      hood.castShadow = true;
      add(hood, 0.85);
      for (const side of [-1, 1]) {
        const plate = new Mesh(rivetedPlate(0.05, 0.3, 1.25), gunmetalMat());
        plate.position.set(side * 0.875, 0.16, -0.12);
        plate.castShadow = true;
        add(plate, side < 0 ? 0.78 : 0.7);
      }
      const rear = new Mesh(rivetedPlate(1.3, 0.34, 0.05), gunmetalMat());
      rear.position.set(0, 0.16, -1.47);
      rear.castShadow = true;
      add(rear, 0.55);
      const front = new Mesh(rivetedPlate(1.2, 0.2, 0.05), gunmetalMat());
      front.position.set(0, -0.08, 1.47);
      front.castShadow = true;
      add(front, 0.4);
    }
  }

  private buildWeapon(kind: WeaponKind, paint: string, quality: RigOptions["quality"]): void {
    const pm = paintMat(paint);
    if (kind === "spinner") {
      // Mount + vertical axle at the nose.
      this.body.add(box(0.3, 0.14, 0.42, darkSteelMat(), 0, -0.05, 1.5));
      const pivot = new Group();
      pivot.position.set(0, -0.02, 1.72);
      const bar = new Group();
      const blade = new Mesh(geo("spinBar", () => new BoxGeometry(2.1, 0.075, 0.2)), chromeMat());
      blade.castShadow = true;
      bar.add(blade);
      for (const s of [-1, 1]) {
        const tooth = new Mesh(geo("spinTooth", () => new BoxGeometry(0.16, 0.12, 0.3)), darkSteelMat());
        tooth.position.set(s * 0.98, 0, s * 0.02);
        tooth.castShadow = true;
        bar.add(tooth);
        const stripe = new Mesh(geo("spinStripe", () => new BoxGeometry(0.3, 0.08, 0.205)), pm);
        stripe.position.set(s * 0.55, 0, 0);
        bar.add(stripe);
      }
      const hub = new Mesh(geo("spinHub", () => new CylinderGeometry(0.13, 0.13, 0.16, 12)), darkSteelMat());
      bar.add(hub);
      pivot.add(bar);
      const blur = new Mesh(geo("blurDisc", () => new CircleGeometry(1.1, 48).rotateX(-Math.PI / 2)), blurMat().clone());
      blur.renderOrder = 3;
      pivot.add(blur);
      this.body.add(pivot);
      this.spinPivot = pivot;
      this.spinBar = bar;
      this.spinBlur = blur;
    } else if (kind === "flipper") {
      const hinge = new Group();
      hinge.position.set(0, 0.2, 1.3);
      const plate = new Mesh(geo("flipPlate", () => new BoxGeometry(1.52, 0.05, 0.95)), gunmetalMat());
      plate.position.set(0, 0, 0.47);
      plate.castShadow = true;
      plate.receiveShadow = true;
      hinge.add(plate);
      // Beveled lip + paint edge.
      const lip = box(1.52, 0.03, 0.08, pm, 0, 0.015, 0.93);
      hinge.add(lip);
      for (const s of [-1, 1]) {
        const cheek = new Mesh(geo("flipCheek", () => new BoxGeometry(0.04, 0.16, 0.7)), darkSteelMat());
        cheek.position.set(s * 0.74, -0.08, 0.36);
        cheek.castShadow = true;
        hinge.add(cheek);
      }
      hinge.rotation.x = 0.72;
      this.body.add(hinge);
      this.flipHinge = hinge;
      for (const s of [-0.4, 0.4]) {
        const piston = new Mesh(geo("piston", () => new CylinderGeometry(0.05, 0.05, 1, 8)), chromeMat());
        piston.position.set(s, 0.05, 1.45);
        this.body.add(piston);
        this.flipPistons.push(piston);
      }
      this.body.add(box(1.2, 0.1, 0.2, darkSteelMat(), 0, 0.14, 1.3));
    } else if (kind === "hammer") {
      // Mast on the roof.
      for (const s of [-1, 1]) this.body.add(tube(new Vector3(s * 0.22, 0.72, -0.1), new Vector3(s * 0.1, 1.1, -0.1), 0.045, darkSteelMat()));
      const pivot = new Group();
      pivot.position.set(0, 1.1, -0.1);
      const hub = new Mesh(geo("hammerHub", () => new CylinderGeometry(0.1, 0.1, 0.3, 10).rotateZ(Math.PI / 2)), pm);
      pivot.add(hub);
      const arm = box(0.11, 0.13, 2.1, gunmetalMat(), 0, 0, 1.05);
      pivot.add(arm);
      const head = new Group();
      head.position.set(0, 0, 2.1);
      head.add(box(0.32, 0.26, 0.26, darkSteelMat()));
      const bladeShape = new Shape();
      bladeShape.moveTo(-0.28, 0);
      bladeShape.lineTo(0.28, 0);
      bladeShape.lineTo(0.2, -0.46);
      bladeShape.quadraticCurveTo(0, -0.56, -0.2, -0.46);
      bladeShape.closePath();
      const blade = new Mesh(
        geo("axe", () => new ExtrudeGeometry(bladeShape, { depth: 0.05, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 1 }).rotateY(Math.PI / 2).translate(-0.025, 0, 0)),
        chromeMat(),
      );
      blade.position.set(0, -0.1, 0);
      blade.castShadow = true;
      head.add(blade);
      const stripe = box(0.34, 0.06, 0.27, pm, 0, 0.1, 0);
      head.add(stripe);
      pivot.add(head);
      pivot.rotation.x = -1.95;
      this.body.add(pivot);
      this.hammerPivot = pivot;
    } else {
      // Flamethrower: fuel tank on the sail, hoses, twin nozzles with pilot lights.
      const tank = new Mesh(geo("tank", () => new CylinderGeometry(0.19, 0.19, 1.05, 14).rotateZ(Math.PI / 2)), chromeMat());
      tank.position.set(0, 0.84, -0.95);
      tank.castShadow = true;
      this.body.add(tank);
      for (const x of [-0.32, 0.32]) {
        const band = new Mesh(geo("tankBand", () => new CylinderGeometry(0.2, 0.2, 0.08, 14).rotateZ(Math.PI / 2)), pm);
        band.position.set(x, 0.84, -0.95);
        this.body.add(band);
      }
      for (const n of FLAME_NOZZLES) {
        const nozzle = new Mesh(geo("nozzle", () => new CylinderGeometry(0.045, 0.07, 0.36, 10).rotateX(Math.PI / 2)), darkSteelMat());
        nozzle.position.set(n.x, n.y, n.z - 0.2);
        nozzle.castShadow = true;
        this.body.add(nozzle);
        this.body.add(tube(new Vector3(n.x, n.y, n.z - 0.35), new Vector3(n.x * 0.5, 0.78, -0.6), 0.025, plasticMat()));
        const pilot = new Mesh(geo("pilot", () => new ConeGeometry(0.03, 0.09, 8).rotateX(Math.PI / 2)), pilotMat());
        pilot.position.set(n.x, n.y, n.z + 0.01);
        this.body.add(pilot);
        this.pilots.push(pilot);
      }
      if (quality === "high") {
        // Heat shimmer: a refractive cone in front of the nozzles (transmission bends what's behind it).
        const ripple = heatNoise().clone();
        ripple.repeat.set(2, 3);
        ripple.needsUpdate = true;
        const haze = new Mesh(
          geo("haze", () => new ConeGeometry(0.75, 3.2, 20, 1, true).rotateX(-Math.PI / 2)),
          new MeshPhysicalMaterial({
            color: "#ffffff",
            metalness: 0,
            roughness: 0.02,
            transmission: 1,
            thickness: 0.12,
            ior: 1.015,
            specularIntensity: 0,
            normalMap: ripple,
            normalScale: new Vector2(0.5, 0.5),
            transparent: true,
            depthWrite: false,
            side: DoubleSide,
            envMapIntensity: 0,
          }),
        );
        haze.position.set(0, 0.2, 1.8 + 1.7);
        haze.visible = false;
        haze.renderOrder = 7;
        this.body.add(haze);
        this.haze = haze;
        this.hazeMap = ripple;
        const light = new PointLight("#ff7a2a", 0, 9, 2);
        light.position.set(0, 0.3, 3.2);
        this.body.add(light);
        this.flameLight = light;
      }
    }
  }

  /** World-space position of a truck-space point (after the latest render transform). */
  localToWorld(x: number, y: number, z: number, out: Vector3): Vector3 {
    return this.root.localToWorld(out.set(x, y, z));
  }

  /** Presses any new dents into the hull. */
  applyDents(dents: { x: number; y: number; z: number; depth: number }[]): void {
    while (this.dentCount < dents.length) {
      const d = dents[this.dentCount++]!;
      dentHull(this.hullGeo, d);
    }
  }

  update(s: RigState, onDetach?: DetachHandler): void {
    const dt = Math.min(0.05, s.dt);
    // Suspension: damped springs driven by body accelerations.
    const k = 90;
    const c = 11;
    const targetPitch = Math.max(-0.09, Math.min(0.09, s.accelLong * 0.0055));
    const targetRoll = Math.max(-0.08, Math.min(0.08, -s.accelLat * 0.005));
    this.pitchV += ((targetPitch - this.pitch) * k - this.pitchV * c) * dt;
    this.pitch += this.pitchV * dt;
    this.rollV += ((targetRoll - this.roll) * k - this.rollV * c) * dt;
    this.roll += this.rollV * dt;
    this.heaveV += ((0 - this.heave) * k - this.heaveV * c) * dt;
    this.heave += this.heaveV * dt;
    this.body.rotation.set(this.pitch, 0, this.roll);
    this.body.position.y = this.heave;
    // Wheels drop (suspension extends) in the air.
    this.wheelDrop += ((s.grounded ? 0 : -0.1) - this.wheelDrop) * Math.min(1, dt * 10);
    this.wheelSpin += (s.speed / WHEEL_RADIUS) * dt;
    for (const w of this.wheels) {
      w.pivot.position.y = WHEEL_Y + this.wheelDrop + (w.x < 0 ? this.roll : -this.roll) * 0.5;
      w.pivot.rotation.y = w.front ? -s.steer * 0.42 : 0;
      w.spinner.rotation.x = this.wheelSpin;
    }

    // Weapons.
    if (this.spinPivot && this.spinBar && this.spinBlur) {
      this.spinAngle -= (s.spin * 42 + 1.5) * dt;
      this.spinPivot.rotation.y = this.spinAngle;
      const blur = this.spinBlur.material as MeshBasicMaterial;
      blur.opacity = Math.min(0.55, s.spin * s.spin * 0.7);
      this.spinBar.visible = s.spin < 0.85 || Math.floor(s.time * 40) % 2 === 0;
    }
    if (this.flipHinge) {
      const a = s.weaponAnim;
      this.flipHinge.rotation.x = 0.72 - a * 1.45;
      for (const p of this.flipPistons) {
        p.scale.y = 0.3 + a * 0.6;
        p.position.y = 0.05 + a * 0.25;
        p.rotation.x = -0.3 - a * 0.6;
      }
    }
    if (this.hammerPivot) {
      const a = s.weaponAnim;
      // −0.1..0 wind-up, 0..1 strike.
      this.hammerPivot.rotation.x = a < 0 ? -1.95 + a * 2 : -1.95 + a * 2.25;
    }
    if (this.pilots.length) {
      const flick = 0.8 + Math.sin(s.time * 37) * 0.2;
      for (const p of this.pilots) p.scale.setScalar(s.firing ? 1.8 : flick);
      if (this.flameLight) this.flameLight.intensity = s.firing ? 30 + Math.sin(s.time * 50) * 8 : 0;
      if (this.haze && this.hazeMap) {
        this.haze.visible = s.firing;
        this.hazeMap.offset.set((s.time * 0.9) % 1, (s.time * 2.3) % 1);
      }
    }

    // Wear: grime + scorch darken and dull the steel.
    const wear = Math.min(1, s.scorch * 0.85 + (1 - s.health) * 0.35);
    this.steel.color.copy(this.steelBase).lerp(this.grime, wear * 0.75);
    this.steel.roughness = 1 + wear * 0.9;
    this.steel.envMapIntensity = 1.25 - wear * 0.6;
    this.lightBar.visible = s.alive || Math.sin(s.time * 20) > 0.6;
    if (this.underglow) this.underglow.visible = s.alive && s.grounded;

    // Panels fly off as health drops.
    for (const d of this.detachables) {
      if (!d.gone && s.health < d.threshold) {
        d.gone = true;
        d.obj.visible = false;
        if (onDetach) {
          const p = d.obj.getWorldPosition(_tmp);
          onDetach(p.x, p.y, p.z, "#586070");
        }
      }
    }
  }

  dispose(): void {
    this.hullGeo.dispose();
    this.steel.dispose();
    if (this.spinBlur) (this.spinBlur.material as Material).dispose();
    if (this.haze) (this.haze.material as Material).dispose();
    this.hazeMap?.dispose();
  }
}

/** Health fraction used for wear + detach thresholds. */
export function healthFraction(hp: number, armor: number, loadout: Loadout): number {
  return (Math.max(0, hp) + Math.max(0, armor)) / (HP_MAX + ARMORS[loadout.armor].armor);
}

const _tmp = new Vector3();

/**
 * The 3D view (plain three.js, one draw loop): builds each hole as a little
 * diorama (painted turf on a height field, wooden rails, blocks, bumpers,
 * windmill, spinners, sliders, glass tubes, the ramp, water, flag, trees),
 * draws every ball (yours, bots', opponents' ghosts), the aim guide, and
 * particles, and drives the camera: intro flyover, follow, overview and pan.
 *
 * Course space is (x, y) on the ground with height h; three.js is Y-up, so a
 * course point maps to (x, h, −y) and the camera looks up the hole.
 */

import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Fog,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Raycaster,
  RingGeometry,
  Scene,
  Shape as ThreeShape,
  ShapeGeometry,
  SphereGeometry,
  SRGBColorSpace,
  type Texture,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { BALL_R, WALL_H, WALL_T, getCompiled, type CompiledHole } from "./compile";
import { HOLES, type Hole, type Shape, type Vec } from "./course";
import { TUBE_R, sliderState, spinnerAngle, windmillAngle } from "./physics";
import type { Fx, GolfRuntime, Seat } from "./runtime";
import {
  paintBall,
  paintChevrons,
  paintDot,
  paintFlag,
  paintPlanks,
  paintRipples,
  paintRough,
  paintSail,
  paintSky,
  paintStripes,
  paintTurf,
  rng,
} from "./textures";

const BASE = -0.9;
const WATER_LEVEL = -0.1;
const TURF_STEP = 0.25;
const COLORS = {
  railTop: new Color("#fff4e2"),
  railInner: new Color("#d99a5b"),
  railOuter: new Color("#9c6433"),
  blockTop: new Color("#fff0da"),
  house: new Color("#f6eadb"),
  houseDark: new Color("#3a2a22"),
  trim: new Color("#7a4a2a"),
};

const tmpV = new Vector3();
const tmpV2 = new Vector3();
const tmpObj = new Object3D();
const up = new Vector3(0, 1, 0);

function p3(x: number, y: number, h: number, out = new Vector3()): Vector3 {
  return out.set(x, h, -y);
}

/* ------------------------------------------------------------------ */
/* Geometry builder                                                   */
/* ------------------------------------------------------------------ */

/** Flat-shaded, vertex-coloured faces, oriented by an outward hint. */
class Faces {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];

  tri(a: Vector3, b: Vector3, c: Vector3, color: Color, hint: Vector3): void {
    const n = tmpV.subVectors(b, a).cross(tmpV2.subVectors(c, a)).normalize();
    if (n.dot(hint) < 0) {
      [b, c] = [c, b];
      n.negate();
    }
    for (const p of [a, b, c]) {
      this.pos.push(p.x, p.y, p.z);
      this.nor.push(n.x, n.y, n.z);
      this.col.push(color.r, color.g, color.b);
    }
  }

  quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3, color: Color, hint: Vector3): void {
    this.tri(a, b, c, color, hint);
    this.tri(a, c, d, color, hint);
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new Float32BufferAttribute(this.nor, 3));
    g.setAttribute("color", new Float32BufferAttribute(this.col, 3));
    return g;
  }
}

/* ------------------------------------------------------------------ */
/* Scene                                                              */
/* ------------------------------------------------------------------ */

interface BallView {
  mesh: Mesh;
  shadow: Mesh;
  last: Vector3;
  seatId: string;
}

interface HoleView {
  serial: number;
  hole: Hole;
  course: CompiledHole;
  group: Group;
  disposables: { dispose(): void }[];
  bumpers: { mesh: Group; flash: number }[];
  spinners: Group[];
  sliders: Mesh[];
  sails: Group | null;
  tubes: CatmullRomCurve3[];
  water: Mesh[];
  boost: Mesh[];
  flag: { group: Group; cloth: Mesh; base: Float32Array; lift: number };
  turf: Mesh;
}

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  color: Color;
  gravity: number;
}

export interface Quality {
  dpr: number;
  shadows: number;
}

export function detectQuality(): Quality {
  const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, coarse ? 2 : 1.75) : 1;
  return { dpr, shadows: coarse ? 1024 : 2048 };
}

export class GolfScene {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(46, 1, 0.1, 200);
  private readonly rt: GolfRuntime;
  private readonly reduced: boolean;
  private readonly sun: DirectionalLight;
  private view: HoleView | null = null;
  private readonly shared: { dispose(): void }[] = [];
  private readonly dot: Texture;
  private readonly rough: Texture;
  private readonly roughGround: Mesh;
  private readonly balls = new Map<string, BallView>();
  private readonly aimDots: InstancedMesh;
  private readonly aimRing: Mesh;
  private readonly particles: Particle[] = [];
  private readonly points: Points;
  private readonly pointsGeo: BufferGeometry;
  private readonly rings: { mesh: Mesh; life: number }[] = [];
  private readonly raycaster = new Raycaster();
  private width = 1;
  private height = 1;
  private quality: Quality;
  private time = 0;
  private shake = 0;

  /* Camera state (course space) */
  private cam = { x: 0, y: 0, h: 0, dist: 12, pitch: 0.95 };
  private panX = 0;
  private panY = 0;
  private overviewBlend = 0;
  private followY = 0;
  private frameTimes: number[] = [];

  constructor(canvas: HTMLCanvasElement, rt: GolfRuntime, reduced: boolean, quality: Quality) {
    this.rt = rt;
    this.reduced = reduced;
    this.quality = quality;
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", stencil: false });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.setPixelRatio(quality.dpr);

    const sky = paintSky();
    this.shared.push(sky);
    this.scene.background = sky;
    this.scene.fog = new Fog("#cfe6f5", 26, 70);

    const hemi = new HemisphereLight("#e4f2ff", "#3f6b33", 1.25);
    this.scene.add(hemi);
    this.sun = new DirectionalLight("#fff2dc", 2.3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(quality.shadows, quality.shadows);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.025;
    this.scene.add(this.sun, this.sun.target);

    const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.rough = paintRough(aniso);
    this.rough.repeat.set(40, 40);
    this.dot = paintDot();
    this.shared.push(this.rough, this.dot);
    const groundGeo = new PlaneGeometry(160, 160);
    const groundMat = new MeshStandardMaterial({ map: this.rough, roughness: 1, color: "#9fcf8f" });
    this.roughGround = new Mesh(groundGeo, groundMat);
    this.roughGround.rotation.x = -Math.PI / 2;
    this.roughGround.position.y = BASE;
    this.roughGround.receiveShadow = true;
    this.scene.add(this.roughGround);
    this.shared.push(groundGeo, groundMat);

    // Aim guide: dots on the ground, and a pulsing ring around a ball you can hit.
    const dotGeo = new CircleGeometry(0.05, 14);
    dotGeo.rotateX(-Math.PI / 2);
    const dotMat = new MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.95, depthWrite: false });
    this.aimDots = new InstancedMesh(dotGeo, dotMat, 48);
    this.aimDots.instanceMatrix.setUsage(DynamicDrawUsage);
    this.aimDots.count = 0;
    this.aimDots.frustumCulled = false;
    this.aimDots.renderOrder = 3;
    this.scene.add(this.aimDots);
    const ringGeo = new RingGeometry(BALL_R * 1.7, BALL_R * 2.15, 40);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.6, depthWrite: false });
    this.aimRing = new Mesh(ringGeo, ringMat);
    this.aimRing.renderOrder = 2;
    this.scene.add(this.aimRing);
    this.shared.push(dotGeo, dotMat, ringGeo, ringMat);

    // Particles.
    this.pointsGeo = new BufferGeometry();
    this.pointsGeo.setAttribute("position", new BufferAttribute(new Float32Array(600 * 3), 3).setUsage(DynamicDrawUsage));
    this.pointsGeo.setAttribute("color", new BufferAttribute(new Float32Array(600 * 3), 3).setUsage(DynamicDrawUsage));
    const pm = new PointsMaterial({
      size: 0.11,
      map: this.dot,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.points = new Points(this.pointsGeo, pm);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
    this.shared.push(this.pointsGeo, pm);
  }

  /* ---------------------------------------------------------------- */
  /* Sizing & projection                                              */
  /* ---------------------------------------------------------------- */

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    // Portrait screens get a taller field of view so the hole isn't a sliver.
    this.camera.fov = this.camera.aspect < 0.8 ? 50 : 42;
    this.camera.updateProjectionMatrix();
  }

  /** Course point under a screen point (CSS px), on the horizontal plane at height h. */
  screenToGround(px: number, py: number, h: number): Vec | null {
    const ndc = new Vector2((px / this.width) * 2 - 1, -(py / this.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const plane = new Plane(up, -h);
    const hit = this.raycaster.ray.intersectPlane(plane, new Vector3());
    return hit ? { x: hit.x, y: -hit.z } : null;
  }

  /** Screen position (CSS px) of a course point; `z` < 0 or > 1 means behind/beyond the camera. */
  toScreen(x: number, y: number, h: number): { x: number; y: number; visible: boolean } {
    const v = p3(x, y, h, tmpV).project(this.camera);
    return { x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height, visible: v.z > -1 && v.z < 1 };
  }

  /** Pixels per course unit at a point (for sizing touch targets). */
  pixelsPerUnit(x: number, y: number, h: number): number {
    const a = this.toScreen(x, y, h);
    const b = this.toScreen(x + 1, y, h);
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  pan(dx: number, dy: number): void {
    const c = this.view?.course;
    if (!c) return;
    const ppu = this.pixelsPerUnit(this.cam.x, this.cam.y, this.cam.h) || 20;
    this.panX -= dx / ppu;
    this.panY += dy / ppu / Math.max(0.5, Math.sin(this.cam.pitch));
    const w = c.maxX - c.minX;
    const l = c.maxY - c.minY;
    this.panX = Math.max(-w, Math.min(w, this.panX));
    this.panY = Math.max(-l, Math.min(l, this.panY));
  }

  resetPan(): void {
    this.panX = 0;
    this.panY = 0;
  }

  get panned(): boolean {
    return Math.abs(this.panX) + Math.abs(this.panY) > 0.3;
  }

  /* ---------------------------------------------------------------- */
  /* Hole building                                                    */
  /* ---------------------------------------------------------------- */

  private buildHole(index: number, serial: number): HoleView {
    const hole = HOLES[index]!;
    const c = getCompiled(hole);
    const group = new Group();
    const disposables: { dispose(): void }[] = [];
    const own = <T extends { dispose(): void }>(x: T): T => {
      disposables.push(x);
      return x;
    };
    const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const accent = new Color(hole.accent);

    /* Turf */
    const nx = Math.round((c.maxX - c.minX) / TURF_STEP);
    const ny = Math.round((c.maxY - c.minY) / TURF_STEP);
    const W = c.maxX - c.minX;
    const H = c.maxY - c.minY;
    const pos = new Float32Array((nx + 1) * (ny + 1) * 3);
    const uv = new Float32Array((nx + 1) * (ny + 1) * 2);
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const x = c.minX + i * TURF_STEP;
        const y = c.minY + j * TURF_STEP;
        const k = j * (nx + 1) + i;
        pos[k * 3] = x;
        pos[k * 3 + 1] = c.turfHeight(x, y);
        pos[k * 3 + 2] = -y;
        uv[k * 2] = (x - c.minX) / W;
        uv[k * 2 + 1] = (y - c.minY) / H;
      }
    }
    const index3: number[] = [];
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const cx = c.minX + (i + 0.5) * TURF_STEP;
        const cy = c.minY + (j + 0.5) * TURF_STEP;
        if (!c.isFloor(cx, cy)) continue;
        const a = j * (nx + 1) + i;
        const b = a + 1;
        const d = a + nx + 1;
        const e = d + 1;
        index3.push(a, b, e, a, e, d);
      }
    }
    const turfGeo = own(new BufferGeometry());
    turfGeo.setAttribute("position", new BufferAttribute(pos, 3));
    turfGeo.setAttribute("uv", new BufferAttribute(uv, 2));
    turfGeo.setIndex(index3);
    turfGeo.computeVertexNormals();
    const turfTex = own(paintTurf(c, aniso));
    const turfMat = own(new MeshStandardMaterial({ map: turfTex, roughness: 0.93, metalness: 0 }));
    const turf = new Mesh(turfGeo, turfMat);
    turf.receiveShadow = true;
    group.add(turf);

    /* Rails */
    const rails = new Faces();
    for (const e of c.edges) {
      const len = Math.hypot(e.bx - e.ax, e.by - e.ay);
      const dx = (e.bx - e.ax) / len;
      const dy = (e.by - e.ay) / len;
      const s0 = e.extA ? -WALL_T : 0;
      const s1 = len + (e.extB ? WALL_T : 0);
      const n = Math.max(1, Math.ceil((s1 - s0) / 0.5));
      const top = (x: number, y: number) => c.height(x - e.nx * 0.06, y - e.ny * 0.06) + WALL_H;
      const hintIn = new Vector3(-e.nx, 0, e.ny);
      const hintOut = new Vector3(e.nx, 0, -e.ny);
      for (let k = 0; k < n; k++) {
        const sa = s0 + ((s1 - s0) * k) / n;
        const sb = s0 + ((s1 - s0) * (k + 1)) / n;
        const ax = e.ax + dx * sa;
        const ay = e.ay + dy * sa;
        const bx = e.ax + dx * sb;
        const by = e.ay + dy * sb;
        const ta = top(Math.max(e.ax, Math.min(e.bx, ax)), Math.max(e.ay, Math.min(e.by, ay)));
        const tb = top(Math.max(e.ax, Math.min(e.bx, bx)), Math.max(e.ay, Math.min(e.by, by)));
        const iA = p3(ax, ay, ta);
        const iB = p3(bx, by, tb);
        const oA = p3(ax + e.nx * WALL_T, ay + e.ny * WALL_T, ta);
        const oB = p3(bx + e.nx * WALL_T, by + e.ny * WALL_T, tb);
        const iA0 = p3(ax, ay, BASE);
        const iB0 = p3(bx, by, BASE);
        const oA0 = p3(ax + e.nx * WALL_T, ay + e.ny * WALL_T, BASE);
        const oB0 = p3(bx + e.nx * WALL_T, by + e.ny * WALL_T, BASE);
        rails.quad(iA, iB, oB, oA, COLORS.railTop, up);
        rails.quad(iA0, iB0, iB, iA, COLORS.railInner, hintIn);
        rails.quad(oA0, oB0, oB, oA, COLORS.railOuter, hintOut);
        if (k === 0) rails.quad(iA0, oA0, oA, iA, COLORS.railOuter, new Vector3(-dx, 0, dy));
        if (k === n - 1) rails.quad(iB0, oB0, oB, iB, COLORS.railOuter, new Vector3(dx, 0, -dy));
      }
    }
    // Blocks (the windmill house is drawn on its own).
    const houseBlocks = hole.windmill ? 2 : 0;
    const plain = c.blocks.slice(0, c.blocks.length - houseBlocks);
    for (const b of plain) {
      const pts = b.points;
      const topH = Math.max(...pts.map(([x, y]) => c.height(x, y))) + WALL_H;
      const cxm = pts.reduce((s, [x]) => s + x, 0) / pts.length;
      const cym = pts.reduce((s, [, y]) => s + y, 0) / pts.length;
      for (let k = 1; k + 1 < pts.length; k++) {
        rails.tri(p3(pts[0]![0], pts[0]![1], topH), p3(pts[k]![0], pts[k]![1], topH), p3(pts[k + 1]![0], pts[k + 1]![1], topH), COLORS.blockTop, up);
      }
      for (let k = 0; k < pts.length; k++) {
        const [ax, ay] = pts[k]!;
        const [bx, by] = pts[(k + 1) % pts.length]!;
        const hint = new Vector3((ax + bx) / 2 - cxm, 0, -((ay + by) / 2 - cym));
        rails.quad(p3(ax, ay, BASE), p3(bx, by, BASE), p3(bx, by, topH), p3(ax, ay, topH), COLORS.railInner, hint);
      }
    }
    const railGeo = own(rails.build());
    const railMat = own(new MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.02 }));
    const railMesh = new Mesh(railGeo, railMat);
    railMesh.castShadow = true;
    railMesh.receiveShadow = true;
    group.add(railMesh);

    /* Bumpers */
    const bumpers: HoleView["bumpers"] = [];
    const bumperMat = own(new MeshStandardMaterial({ color: accent, roughness: 0.35, metalness: 0.1, emissive: accent, emissiveIntensity: 0.05 }));
    const rubberMat = own(new MeshStandardMaterial({ color: "#ffffff", roughness: 0.5 }));
    for (const b of hole.bumpers ?? []) {
      const g = new Group();
      const body = new Mesh(own(new CylinderGeometry(b.r, b.r * 1.04, 0.26, 28)), bumperMat);
      body.position.y = 0.13;
      body.castShadow = true;
      const ring = new Mesh(own(new TorusGeometry(b.r * 1.02, 0.045, 10, 28)), rubberMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.12;
      const cap = new Mesh(own(new CylinderGeometry(b.r * 0.55, b.r * 0.62, 0.06, 24)), rubberMat);
      cap.position.y = 0.29;
      g.add(body, ring, cap);
      p3(b.x, b.y, c.height(b.x, b.y), g.position);
      group.add(g);
      bumpers.push({ mesh: g, flash: 0 });
    }

    /* Spinners */
    const metal = own(new MeshStandardMaterial({ color: "#d6dbe4", roughness: 0.3, metalness: 0.7 }));
    const armMat = own(new MeshStandardMaterial({ color: accent, roughness: 0.4, metalness: 0.2 }));
    const spinners: Group[] = [];
    for (const s of hole.spinners ?? []) {
      const g = new Group();
      const hub = new Mesh(own(new CylinderGeometry(0.16, 0.18, 0.32, 20)), metal);
      hub.position.y = 0.16;
      hub.castShadow = true;
      g.add(hub);
      for (let k = 0; k < s.arms; k++) {
        const arm = new Mesh(own(new BoxGeometry(s.length, 0.16, 0.12)), armMat);
        arm.position.set(Math.cos((k * 2 * Math.PI) / s.arms) * (s.length / 2), 0.1, -Math.sin((k * 2 * Math.PI) / s.arms) * (s.length / 2));
        arm.rotation.y = (k * 2 * Math.PI) / s.arms;
        arm.castShadow = true;
        g.add(arm);
      }
      p3(s.x, s.y, c.height(s.x, s.y), g.position);
      group.add(g);
      spinners.push(g);
    }

    /* Sliders */
    const stripes = own(paintStripes());
    stripes.repeat.set(2, 1);
    const sliderMat = own(new MeshStandardMaterial({ map: stripes, roughness: 0.5 }));
    const sliders: Mesh[] = [];
    for (const s of hole.sliders ?? []) {
      const m = new Mesh(own(new BoxGeometry(s.hw * 2, 0.34, s.hh * 2)), sliderMat);
      m.castShadow = true;
      group.add(m);
      sliders.push(m);
    }

    /* Windmill */
    let sails: Group | null = null;
    const w = hole.windmill;
    if (w) {
      const house = new Faces();
      const gh = c.height(w.x, w.y0);
      const wallTop = gh + 1.35;
      const left = w.x - w.width / 2;
      const right = w.x + w.width / 2;
      const tl = w.x - w.tunnel / 2;
      const tr = w.x + w.tunnel / 2;
      const box = (x0: number, x1: number, h0: number, h1: number, inner: Color, outer: Color, innerSide: -1 | 0 | 1) => {
        const P = (x: number, y: number, h: number) => p3(x, y, h);
        const faces: [Vector3, Vector3, Vector3, Vector3, Color, Vector3][] = [
          [P(x0, w.y0, h0), P(x1, w.y0, h0), P(x1, w.y0, h1), P(x0, w.y0, h1), outer, new Vector3(0, 0, 1)],
          [P(x0, w.y1, h0), P(x1, w.y1, h0), P(x1, w.y1, h1), P(x0, w.y1, h1), outer, new Vector3(0, 0, -1)],
          [P(x0, w.y0, h0), P(x0, w.y1, h0), P(x0, w.y1, h1), P(x0, w.y0, h1), innerSide === -1 ? inner : outer, new Vector3(-1, 0, 0)],
          [P(x1, w.y0, h0), P(x1, w.y1, h0), P(x1, w.y1, h1), P(x1, w.y0, h1), innerSide === 1 ? inner : outer, new Vector3(1, 0, 0)],
          [P(x0, w.y0, h1), P(x1, w.y0, h1), P(x1, w.y1, h1), P(x0, w.y1, h1), outer, up],
          [P(x0, w.y0, h0), P(x1, w.y0, h0), P(x1, w.y1, h0), P(x0, w.y1, h0), inner, new Vector3(0, -1, 0)],
        ];
        for (const [a, b, cc, d, col, hint] of faces) house.quad(a, b, cc, d, col, hint);
      };
      box(left, tl, BASE, wallTop, COLORS.houseDark, COLORS.house, 1);
      box(tr, right, BASE, wallTop, COLORS.houseDark, COLORS.house, -1);
      box(tl, tr, gh + 0.46, wallTop, COLORS.houseDark, COLORS.house, 0);
      // Gable roof along x.
      const roofCol = new Color(hole.accent).multiplyScalar(0.85);
      const ov = 0.18;
      const ridge = wallTop + 1.05;
      const a0 = p3(left - ov, w.y0 - ov, wallTop - 0.05);
      const a1 = p3(right + ov, w.y0 - ov, wallTop - 0.05);
      const b0 = p3(left - ov, w.y1 + ov, wallTop - 0.05);
      const b1 = p3(right + ov, w.y1 + ov, wallTop - 0.05);
      const r0 = p3(left - ov, (w.y0 + w.y1) / 2, ridge);
      const r1 = p3(right + ov, (w.y0 + w.y1) / 2, ridge);
      house.quad(a0, a1, r1, r0, roofCol, new Vector3(0, 1, 1));
      house.quad(b0, b1, r1, r0, roofCol, new Vector3(0, 1, -1));
      house.tri(a0, b0, r0, COLORS.trim, new Vector3(-1, 0, 0));
      house.tri(a1, b1, r1, COLORS.trim, new Vector3(1, 0, 0));
      // Timber trim band.
      house.quad(p3(left, w.y0 - 0.01, wallTop - 0.14), p3(right, w.y0 - 0.01, wallTop - 0.14), p3(right, w.y0 - 0.01, wallTop - 0.02), p3(left, w.y0 - 0.01, wallTop - 0.02), COLORS.trim, new Vector3(0, 0, 1));
      const houseMesh = new Mesh(own(house.build()), own(new MeshStandardMaterial({ vertexColors: true, roughness: 0.7 })));
      houseMesh.castShadow = true;
      houseMesh.receiveShadow = true;
      group.add(houseMesh);
      // Sails.
      sails = new Group();
      const sailTex = own(paintSail());
      const sailMat = own(new MeshStandardMaterial({ map: sailTex, roughness: 0.8, side: DoubleSide }));
      const sailLen = 1.2;
      for (let k = 0; k < w.sails; k++) {
        const arm = new Group();
        const blade = new Mesh(own(new BoxGeometry(sailLen - 0.1, 0.36, 0.03)), sailMat);
        blade.position.x = 0.1 + (sailLen - 0.1) / 2;
        blade.castShadow = true;
        const spar = new Mesh(own(new BoxGeometry(sailLen, 0.05, 0.05)), own(new MeshStandardMaterial({ color: COLORS.trim })));
        spar.position.x = sailLen / 2;
        arm.add(blade, spar);
        arm.rotation.z = (k * 2 * Math.PI) / w.sails;
        sails.add(arm);
      }
      const hub = new Mesh(own(new CylinderGeometry(0.13, 0.13, 0.16, 16)), metal);
      hub.rotation.x = Math.PI / 2;
      sails.add(hub);
      p3(w.x, w.y0, gh + 1.28, sails.position);
      sails.position.z += 0.14;
      group.add(sails);
    }

    /* Tubes */
    const tubes: CatmullRomCurve3[] = [];
    const glass = own(
      new MeshStandardMaterial({ color: accent, roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.42, depthWrite: false, side: DoubleSide }),
    );
    const rimIn = own(new MeshStandardMaterial({ color: accent, roughness: 0.35, metalness: 0.3 }));
    const rimOut = own(new MeshStandardMaterial({ color: "#f5f5f5", roughness: 0.35, metalness: 0.3 }));
    for (const t of hole.tubes ?? []) {
      const ha = c.height(t.from.x, t.from.y);
      const hb = c.height(t.to.x, t.to.y);
      const dist = Math.hypot(t.to.x - t.from.x, t.to.y - t.from.y);
      const peak = Math.max(ha, hb) + 1.1 + dist * 0.12;
      const mid = { x: (t.from.x + t.to.x) / 2, y: (t.from.y + t.to.y) / 2 };
      const curve = new CatmullRomCurve3([
        p3(t.from.x, t.from.y, ha - 0.05),
        p3(t.from.x, t.from.y, ha + 0.55),
        p3(mid.x, mid.y, peak),
        p3(t.to.x - t.dir.x * 0.1, t.to.y - t.dir.y * 0.1, hb + 0.55),
        p3(t.to.x, t.to.y, hb + BALL_R),
      ]);
      tubes.push(curve);
      const tube = new Mesh(own(new TubeGeometry(curve, 72, 0.19, 14, false)), glass);
      tube.renderOrder = 4;
      group.add(tube);
      for (const [p, h, mat] of [
        [t.from, ha, rimIn],
        [t.to, hb, rimOut],
      ] as const) {
        const ring = new Mesh(own(new TorusGeometry(TUBE_R + 0.05, 0.06, 10, 30)), mat);
        ring.rotation.x = Math.PI / 2;
        p3(p.x, p.y, h + 0.03, ring.position);
        ring.castShadow = true;
        group.add(ring);
      }
    }

    /* Ramps */
    const planks = own(paintPlanks());
    for (const f of hole.heights ?? []) {
      if (f.kind !== "ramp") continue;
      const g = new BufferGeometry();
      const e = 0.004;
      const v = [
        // deck
        [f.x0, f.y0, e], [f.x1, f.y0, e], [f.x1, f.y1, f.a + e], [f.x0, f.y1, f.a + e],
      ];
      const P = (i: number) => p3(v[i]![0]!, v[i]![1]!, v[i]![2]!);
      const deckLen = Math.hypot(f.y1 - f.y0, f.a);
      const positions: number[] = [];
      const uvs: number[] = [];
      const push = (a: Vector3, uu: number, vv: number) => {
        positions.push(a.x, a.y, a.z);
        uvs.push(uu, vv);
      };
      const wdt = f.x1 - f.x0;
      // Deck (two triangles, CCW from above).
      push(P(0), 0, 0); push(P(1), wdt, 0); push(P(2), wdt, deckLen);
      push(P(0), 0, 0); push(P(2), wdt, deckLen); push(P(3), 0, deckLen);
      // Back face (vertical drop).
      const b0 = p3(f.x0, f.y1, BASE);
      const b1 = p3(f.x1, f.y1, BASE);
      push(b1, wdt, 0); push(b0, 0, 0); push(P(3), 0, f.a - BASE);
      push(b1, wdt, 0); push(P(3), 0, f.a - BASE); push(P(2), wdt, f.a - BASE);
      g.setAttribute("position", new Float32BufferAttribute(positions, 3));
      g.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
      g.computeVertexNormals();
      own(g);
      planks.repeat.set(0.5, 0.9);
      const m = new Mesh(g, own(new MeshStandardMaterial({ map: planks, roughness: 0.75, side: DoubleSide })));
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
      // Painted lip at the top edge.
      const lip = new Mesh(own(new BoxGeometry(wdt, 0.05, 0.08)), own(new MeshStandardMaterial({ color: "#ffd23d", roughness: 0.4 })));
      p3((f.x0 + f.x1) / 2, f.y1 - 0.04, f.a + 0.02, lip.position);
      group.add(lip);
    }

    /* Water and boost overlays */
    const water: Mesh[] = [];
    const boost: Mesh[] = [];
    const ripples = own(paintRipples());
    ripples.repeat.set(0.35, 0.35);
    const chevrons = own(paintChevrons());
    for (const s of hole.surfaces ?? []) {
      if (s.type === "water") {
        const geo = own(shapeGeometry(s.shape));
        geo.rotateX(-Math.PI / 2);
        const mat = own(
          new MeshStandardMaterial({ color: "#48c2e4", map: ripples, transparent: true, opacity: 0.72, roughness: 0.08, metalness: 0.15, depthWrite: false }),
        );
        const m = new Mesh(geo, mat);
        m.position.y = WATER_LEVEL;
        m.receiveShadow = true;
        m.renderOrder = 1;
        group.add(m);
        water.push(m);
      } else if (s.type === "boost") {
        const geo = own(shapeGeometry(s.shape, 0.08));
        geo.rotateX(-Math.PI / 2);
        const tex = chevrons.clone();
        own(tex);
        tex.repeat.set(1, 1.2);
        tex.needsUpdate = true;
        const mat = own(new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: AdditiveBlending }));
        const m = new Mesh(geo, mat);
        const center = shapeCenter(s.shape);
        m.position.y = c.height(center.x, center.y) + 0.012;
        m.renderOrder = 2;
        group.add(m);
        boost.push(m);
      }
    }

    /* Flag */
    const flagGroup = new Group();
    const pole = new Mesh(own(new CylinderGeometry(0.02, 0.02, 1.55, 8)), own(new MeshStandardMaterial({ color: "#fafafa", roughness: 0.4 })));
    pole.position.y = 0.72;
    pole.castShadow = true;
    const tip = new Mesh(own(new SphereGeometry(0.045, 12, 8)), own(new MeshStandardMaterial({ color: accent, roughness: 0.3 })));
    tip.position.y = 1.5;
    const clothGeo = own(new PlaneGeometry(0.62, 0.4, 12, 2));
    clothGeo.translate(0.31, 0, 0);
    const clothTex = own(paintFlag(hole.accent, hole.number));
    const cloth = new Mesh(clothGeo, own(new MeshStandardMaterial({ map: clothTex, side: DoubleSide, roughness: 0.8 })));
    cloth.position.set(0.02, 1.26, 0);
    cloth.castShadow = true;
    flagGroup.add(pole, tip, cloth);
    p3(hole.cup.x, hole.cup.y, c.height(hole.cup.x, hole.cup.y), flagGroup.position);
    group.add(flagGroup);
    const base = Float32Array.from(clothGeo.attributes.position!.array as Float32Array);

    /* Scenery */
    this.decorate(group, c, own);

    this.scene.add(group);

    // Shadow camera hugging the hole.
    const cx = (c.minX + c.maxX) / 2;
    const cy = (c.minY + c.maxY) / 2;
    const span = Math.max(W, H) / 2 + 3;
    this.sun.position.set(cx - 7, 14, -cy + 9);
    this.sun.target.position.set(cx, 0, -cy);
    const sc = this.sun.shadow.camera;
    sc.left = -span;
    sc.right = span;
    sc.top = span;
    sc.bottom = -span;
    sc.near = 1;
    sc.far = 45;
    sc.updateProjectionMatrix();
    this.roughGround.position.set(cx, BASE, -cy);
    this.rough.offset.set(cx / 4, cy / 4);

    return {
      serial,
      hole,
      course: c,
      group,
      disposables,
      bumpers,
      spinners,
      sliders,
      sails,
      tubes,
      water,
      boost,
      flag: { group: flagGroup, cloth, base, lift: 0 },
      turf,
    };
  }

  /** Trees, bushes, flowers and rocks around the hole (instanced). */
  private decorate(group: Group, c: CompiledHole, own: <T extends { dispose(): void }>(x: T) => T): void {
    const rand = rng(c.hole.number * 131 + 7);
    const spots: { x: number; y: number }[] = [];
    const margin = 1.3;
    const clear = (x: number, y: number, r: number) =>
      x < c.minX - margin - r || x > c.maxX + margin + r || y < c.minY - margin - r || y > c.maxY + margin + r;
    for (let i = 0; i < 400 && spots.length < 70; i++) {
      const x = c.minX - 11 + rand() * (c.maxX - c.minX + 22);
      const y = c.minY - 6 + rand() * (c.maxY - c.minY + 18);
      if (!clear(x, y, 0.8)) continue;
      if (spots.some((s) => Math.hypot(s.x - x, s.y - y) < 1.4)) continue;
      spots.push({ x, y });
    }
    const trees = spots.filter((_, i) => i % 3 !== 2);
    const bushes = spots.filter((_, i) => i % 3 === 2);
    const trunkGeo = own(new CylinderGeometry(0.1, 0.16, 1, 7));
    const crownGeo = own(new IcosahedronGeometry(0.8, 0));
    const trunks = new InstancedMesh(trunkGeo, own(new MeshStandardMaterial({ color: "#7a5230", roughness: 0.9 })), trees.length);
    const crowns = new InstancedMesh(crownGeo, own(new MeshStandardMaterial({ roughness: 0.85, flatShading: true })), trees.length * 2);
    const leafColors = ["#2f8f3e", "#3fa34a", "#267a37", "#58b04a", "#1f6b33"];
    const col = new Color();
    trees.forEach((t, i) => {
      const s = 0.8 + rand() * 0.7;
      tmpObj.position.set(t.x, BASE + 0.5 * s, -t.y);
      tmpObj.scale.set(s, s, s);
      tmpObj.rotation.set(0, rand() * 6, 0);
      tmpObj.updateMatrix();
      trunks.setMatrixAt(i, tmpObj.matrix);
      for (let k = 0; k < 2; k++) {
        const cs = s * (k ? 0.7 : 1);
        tmpObj.position.set(t.x + (k ? 0.15 : 0), BASE + s * (1.2 + k * 0.75), -t.y);
        tmpObj.scale.set(cs, cs * 1.1, cs);
        tmpObj.rotation.set(rand(), rand() * 6, rand());
        tmpObj.updateMatrix();
        crowns.setMatrixAt(i * 2 + k, tmpObj.matrix);
        crowns.setColorAt(i * 2 + k, col.set(leafColors[Math.floor(rand() * leafColors.length)]!));
      }
    });
    trunks.castShadow = crowns.castShadow = true;
    const bushGeo = own(new IcosahedronGeometry(0.45, 1));
    const bushMesh = new InstancedMesh(bushGeo, own(new MeshStandardMaterial({ roughness: 0.9, flatShading: true })), bushes.length * 3);
    const flowerGeo = own(new SphereGeometry(0.07, 6, 4));
    const flowers = new InstancedMesh(flowerGeo, own(new MeshStandardMaterial({ roughness: 0.6 })), bushes.length * 6);
    const petals = ["#ff5d8f", "#ffd23d", "#ffffff", "#b388ff", "#ff8a3d"];
    bushes.forEach((b, i) => {
      for (let k = 0; k < 3; k++) {
        const s = 0.6 + rand() * 0.6;
        tmpObj.position.set(b.x + (rand() - 0.5) * 0.8, BASE + 0.2 * s, -b.y + (rand() - 0.5) * 0.8);
        tmpObj.scale.set(s, s * 0.8, s);
        tmpObj.rotation.set(0, rand() * 6, 0);
        tmpObj.updateMatrix();
        bushMesh.setMatrixAt(i * 3 + k, tmpObj.matrix);
        bushMesh.setColorAt(i * 3 + k, col.set(leafColors[Math.floor(rand() * leafColors.length)]!).multiplyScalar(0.9));
      }
      for (let k = 0; k < 6; k++) {
        tmpObj.position.set(b.x + (rand() - 0.5) * 1.3, BASE + 0.38 + rand() * 0.15, -b.y + (rand() - 0.5) * 1.3);
        tmpObj.scale.set(1, 1, 1);
        tmpObj.updateMatrix();
        flowers.setMatrixAt(i * 6 + k, tmpObj.matrix);
        flowers.setColorAt(i * 6 + k, col.set(petals[Math.floor(rand() * petals.length)]!));
      }
    });
    bushMesh.castShadow = true;
    group.add(trunks, crowns, bushMesh, flowers);
  }

  private disposeHole(view: HoleView): void {
    this.scene.remove(view.group);
    for (const d of view.disposables) d.dispose();
  }

  /* ---------------------------------------------------------------- */
  /* Balls                                                            */
  /* ---------------------------------------------------------------- */

  private ball(seat: Seat): BallView {
    let b = this.balls.get(seat.id);
    if (b) return b;
    const tex = paintBall(seat.color);
    const geo = new SphereGeometry(BALL_R, 28, 18);
    const mat = new MeshStandardMaterial({ map: tex, roughness: 0.32, metalness: 0.02, transparent: !seat.isMe, opacity: seat.isMe ? 1 : 0.62 });
    const mesh = new Mesh(geo, mat);
    mesh.castShadow = seat.isMe;
    mesh.renderOrder = seat.isMe ? 5 : 4;
    const shadowGeo = new PlaneGeometry(BALL_R * 3.2, BALL_R * 3.2);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = new MeshBasicMaterial({ color: "#000000", alphaMap: this.dot, transparent: true, opacity: 0.4, depthWrite: false });
    const shadow = new Mesh(shadowGeo, shadowMat);
    shadow.renderOrder = 1;
    this.scene.add(mesh, shadow);
    this.shared.push(tex, geo, mat, shadowGeo, shadowMat);
    b = { mesh, shadow, last: new Vector3(Number.NaN, 0, 0), seatId: seat.id };
    this.balls.set(seat.id, b);
    return b;
  }

  private placeBall(b: BallView, x: number, y: number, z: number, visible: boolean, scale = 1): void {
    b.mesh.visible = visible;
    b.shadow.visible = visible;
    if (!visible) {
      b.last.set(Number.NaN, 0, 0);
      return;
    }
    const pos = p3(x, y, z + BALL_R * scale, tmpV2);
    if (!Number.isNaN(b.last.x)) {
      const dx = pos.x - b.last.x;
      const dz = pos.z - b.last.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-5 && d < 1) {
        const axis = tmpV.set(dz, 0, -dx).normalize();
        b.mesh.rotateOnWorldAxis(axis, d / BALL_R);
      }
    }
    b.last.copy(pos);
    b.mesh.position.copy(pos);
    b.mesh.scale.setScalar(scale);
    const c = this.view?.course;
    const ground = c ? c.height(x, y) : 0;
    const lift = Math.max(0, z - ground);
    b.shadow.position.set(pos.x + lift * 0.25, Math.max(ground, WATER_LEVEL) + 0.012, pos.z + lift * 0.1);
    const s = 1 + lift * 1.6;
    b.shadow.scale.set(s, 1, s);
    (b.shadow.material as MeshBasicMaterial).opacity = 0.42 / (1 + lift * 3);
  }

  /* ---------------------------------------------------------------- */
  /* Frame                                                            */
  /* ---------------------------------------------------------------- */

  /** Advances the game and draws a frame. */
  frame(dt: number): void {
    const t0 = performance.now();
    const rt = this.rt;
    rt.frame(dt);
    this.time += dt;

    if (!this.view || this.view.serial !== rt.holeSerial) {
      if (this.view) this.disposeHole(this.view);
      this.view = this.buildHole(rt.holeIndex, rt.holeSerial);
      this.resetPan();
      this.followY = HOLES[rt.holeIndex]!.tee.y;
    }
    const view = this.view;
    const holeT = rt.holeTime;

    this.animateObstacles(view, holeT, dt);
    this.updateBalls(view);
    this.updateAim(view);
    for (const fx of rt.drainFx()) this.onFx(fx, view);
    this.updateParticles(dt);
    this.updateCamera(view, dt);

    this.renderer.render(this.scene, this.camera);
    this.adapt(performance.now() - t0);
  }

  private animateObstacles(view: HoleView, t: number, dt: number): void {
    const hole = view.hole;
    const c = view.course;
    (hole.spinners ?? []).forEach((s, i) => {
      view.spinners[i]!.rotation.y = spinnerAngle(s, t);
    });
    (hole.sliders ?? []).forEach((s, i) => {
      const st = sliderState(s, t);
      p3(st.x, st.y, c.height(st.x, st.y) + 0.17, view.sliders[i]!.position);
    });
    if (hole.windmill && view.sails) view.sails.rotation.z = windmillAngle(hole.windmill, t);
    for (const b of view.bumpers) {
      if (b.flash > 0) {
        b.flash = Math.max(0, b.flash - dt * 4);
        const s = 1 + b.flash * 0.12;
        b.mesh.scale.set(s, 1 + b.flash * 0.05, s);
        const body = b.mesh.children[0] as Mesh;
        (body.material as MeshStandardMaterial).emissiveIntensity = 0.05 + b.flash * 0.9;
      }
    }
    for (const w of view.water) {
      const map = (w.material as MeshStandardMaterial).map;
      if (map) map.offset.set(Math.sin(t * 0.3) * 0.2, t * 0.03);
    }
    for (const b of view.boost) {
      const map = (b.material as MeshBasicMaterial).map;
      if (map) map.offset.y = -t * 1.4;
      (b.material as MeshBasicMaterial).opacity = 0.65 + Math.sin(t * 8) * 0.25;
    }

    // Flag: waves, and lifts out when a ball is closing in.
    const flag = view.flag;
    const sim = this.rt.sim;
    const near = !this.rt.spectator && Math.hypot(sim.x - hole.cup.x, sim.y - hole.cup.y) < 2.2 && sim.status !== "holed";
    flag.lift += ((near ? 1 : 0) - flag.lift) * Math.min(1, dt * 4);
    flag.group.position.y = c.height(hole.cup.x, hole.cup.y) + flag.lift * 0.9;
    flag.group.visible = flag.lift < 0.97;
    const pos = flag.cloth.geometry.attributes.position!;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      const x = flag.base[i]!;
      arr[i + 2] = flag.base[i + 2]! + Math.sin(x * 9 - t * (this.reduced ? 1.5 : 5)) * 0.05 * (x / 0.62);
    }
    pos.needsUpdate = true;
  }

  private updateBalls(view: HoleView): void {
    const rt = this.rt;
    const holeIndex = rt.holeIndex;
    const now = performance.now();
    for (const seat of rt.seats) {
      const b = this.ball(seat);
      if (seat.isMe) {
        const sim = rt.sim;
        if (sim.status === "tube") {
          const curve = view.tubes[sim.tubeIndex];
          const u = rt.tubeProgress(sim);
          if (curve) {
            const p = curve.getPoint(Math.min(1, u));
            this.placeBall(b, p.x, -p.z, p.y - BALL_R, true);
          }
        } else if (sim.status === "holed") {
          const k = Math.min(1, (rt.holeTime - rt.sunkAt) / 0.3);
          this.placeBall(b, sim.x, sim.y, view.course.height(sim.x, sim.y) - k * BALL_R * 2.4, k < 1, 1);
        } else {
          const hidden = sim.status === "water" || rt.phase === "card" || rt.phase === "done";
          this.placeBall(b, sim.x, sim.y, sim.z, !hidden);
        }
        continue;
      }
      const g = seat.ghost;
      const stale = !g || (!seat.isBot && now - g.seenAt > 120_000);
      const show = !!g && !stale && g.hole === holeIndex && g.mode !== 2 && rt.phase !== "card" && rt.phase !== "done";
      if (!g || !show) {
        this.placeBall(b, 0, 0, 0, false);
        continue;
      }
      this.placeBall(b, g.x, g.y, g.z, true);
    }
  }

  /** Screen positions of the other balls, for name tags. */
  ghostTags(): { id: string; x: number; y: number; visible: boolean }[] {
    const out: { id: string; x: number; y: number; visible: boolean }[] = [];
    for (const [id, b] of this.balls) {
      const seat = this.rt.seats.find((s) => s.id === id);
      if (!seat || seat.isMe) continue;
      if (!b.mesh.visible) {
        out.push({ id, x: 0, y: 0, visible: false });
        continue;
      }
      const p = b.mesh.position;
      const s = this.toScreen(p.x, -p.z, p.y + BALL_R * 1.2);
      out.push({ id, x: s.x, y: s.y, visible: s.visible });
    }
    return out;
  }

  /** Where my ball is on screen (for the power ring overlay). */
  myBallScreen(): { x: number; y: number; r: number } | null {
    if (this.rt.spectator) return null;
    const sim = this.rt.sim;
    const s = this.toScreen(sim.x, sim.y, sim.z + BALL_R);
    const ppu = this.pixelsPerUnit(sim.x, sim.y, sim.z);
    return { x: s.x, y: s.y, r: ppu * BALL_R };
  }

  private updateAim(view: HoleView): void {
    const rt = this.rt;
    const sim = rt.sim;
    const canAim = rt.canAim() && !rt.spectator;
    this.aimRing.visible = canAim && !rt.aim.active;
    if (this.aimRing.visible) {
      p3(sim.x, sim.y, sim.z + 0.01, this.aimRing.position);
      const pulse = this.reduced ? 1 : 1 + Math.sin(this.time * 4) * 0.12;
      this.aimRing.scale.setScalar(pulse);
      (this.aimRing.material as MeshBasicMaterial).opacity = 0.45 + Math.sin(this.time * 4) * 0.2;
    }
    if (!canAim || !rt.aim.active || rt.aim.power < 0.02) {
      this.aimDots.count = 0;
      return;
    }
    // Dots along the aim, bending once off the first rail it would meet.
    const c = view.course;
    const length = 0.7 + rt.aim.power * 3.4;
    let x = sim.x;
    let y = sim.y;
    let dx = Math.cos(rt.aim.angle);
    let dy = Math.sin(rt.aim.angle);
    let travelled = 0;
    let bounced = false;
    const step = 0.05;
    let n = 0;
    let nextDot = 0.3;
    const color = new Color();
    const hot = new Color("#ff4d4d");
    const warm = new Color("#ffd23d");
    const cool = new Color("#ffffff");
    while (travelled < length && n < 48) {
      const nx = x + dx * step;
      const ny = y + dy * step;
      const hit = !bounced ? contactNormal(c, nx, ny) : null;
      if (hit) {
        const dot = dx * hit.x + dy * hit.y;
        dx -= 2 * dot * hit.x;
        dy -= 2 * dot * hit.y;
        bounced = true;
        continue;
      }
      x = nx;
      y = ny;
      travelled += step;
      if (travelled >= nextDot) {
        nextDot += 0.24;
        const fade = 1 - travelled / length;
        tmpObj.position.set(x, c.height(x, y) + 0.015, -y);
        tmpObj.scale.setScalar(0.6 + fade * 0.8);
        tmpObj.rotation.set(0, 0, 0);
        tmpObj.updateMatrix();
        this.aimDots.setMatrixAt(n, tmpObj.matrix);
        const p = rt.aim.power;
        color.copy(cool).lerp(p < 0.6 ? warm : hot, p < 0.6 ? p / 0.6 : (p - 0.6) / 0.4);
        this.aimDots.setColorAt(n, color);
        n++;
      }
    }
    this.aimDots.count = n;
    this.aimDots.instanceMatrix.needsUpdate = true;
    if (this.aimDots.instanceColor) this.aimDots.instanceColor.needsUpdate = true;
  }

  /* ---------------------------------------------------------------- */
  /* Effects                                                          */
  /* ---------------------------------------------------------------- */

  private onFx(fx: Fx, view: HoleView): void {
    const c = view.course;
    switch (fx.type) {
      case "bumper": {
        const b = view.bumpers[fx.index];
        if (b) b.flash = 1;
        break;
      }
      case "splash": {
        this.burst(fx.x, fx.y, WATER_LEVEL, 26, ["#dff6ff", "#8fdcff", "#ffffff"], 2.6, 0.9);
        this.ring(fx.x, fx.y, WATER_LEVEL + 0.01, "#e8fbff");
        if (fx.mine) this.shake = Math.max(this.shake, 0.5);
        break;
      }
      case "sand":
        this.burst(fx.x, fx.y, c.height(fx.x, fx.y) + 0.05, 10, ["#f0d79a", "#d8b879"], 1.1, 0.6);
        break;
      case "impact":
        this.burst(fx.x, fx.y, c.height(fx.x, fx.y) + 0.1, 5, ["#ffffff", "#fff4d6"], 1, 0.35);
        if (fx.strength > 6) this.shake = Math.max(this.shake, 0.2);
        break;
      case "land":
        this.burst(fx.x, fx.y, c.height(fx.x, fx.y) + 0.03, Math.min(14, 3 + fx.strength * 3), ["#a8e59b", "#ffffff"], 1.2, 0.5);
        if (fx.strength > 2) this.shake = Math.max(this.shake, 0.35);
        break;
      case "sunk": {
        const cup = view.hole.cup;
        const h = c.height(cup.x, cup.y);
        this.ring(cup.x, cup.y, h + 0.02, fx.ace ? "#ffe066" : "#ffffff");
        if (fx.ace) {
          this.burst(cup.x, cup.y, h + 0.1, 120, ["#ff4d6d", "#ffd23d", "#3fa9ff", "#2ee6a6", "#b388ff", "#ffffff"], 5.5, 2.2);
          this.shake = Math.max(this.shake, 0.4);
        } else if (fx.mine) {
          this.burst(cup.x, cup.y, h + 0.1, 24, ["#ffffff", "#fff4b0"], 2.2, 0.8);
        }
        break;
      }
      case "shot":
        break;
    }
  }

  private burst(x: number, y: number, h: number, count: number, colors: string[], speed: number, life: number): void {
    if (this.reduced) count = Math.ceil(count / 3);
    for (let i = 0; i < count && this.particles.length < 600; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      this.particles.push({
        x,
        y: h,
        z: -y,
        vx: Math.cos(a) * s * 0.6,
        vy: s * (0.6 + Math.random() * 0.8),
        vz: Math.sin(a) * s * 0.6,
        life,
        max: life,
        color: new Color(colors[i % colors.length]!),
        gravity: 7,
      });
    }
  }

  private ring(x: number, y: number, h: number, color: string): void {
    const geo = new RingGeometry(0.2, 0.26, 40);
    geo.rotateX(-Math.PI / 2);
    const mat = new MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false });
    const mesh = new Mesh(geo, mat);
    p3(x, y, h, mesh.position);
    mesh.renderOrder = 3;
    this.scene.add(mesh);
    this.rings.push({ mesh, life: 0.7 });
  }

  private updateParticles(dt: number): void {
    const pos = this.pointsGeo.attributes.position!.array as Float32Array;
    const col = this.pointsGeo.attributes.color!.array as Float32Array;
    let n = 0;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vy -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < BASE) p.life = 0;
    }
    for (const p of this.particles) {
      const k = Math.min(1, p.life / p.max) * 1.2;
      pos[n * 3] = p.x;
      pos[n * 3 + 1] = p.y;
      pos[n * 3 + 2] = p.z;
      col[n * 3] = p.color.r * k;
      col[n * 3 + 1] = p.color.g * k;
      col[n * 3 + 2] = p.color.b * k;
      n++;
    }
    this.pointsGeo.setDrawRange(0, n);
    this.pointsGeo.attributes.position!.needsUpdate = true;
    this.pointsGeo.attributes.color!.needsUpdate = true;
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]!;
      r.life -= dt;
      const k = 1 - r.life / 0.7;
      r.mesh.scale.setScalar(1 + k * 4);
      (r.mesh.material as MeshBasicMaterial).opacity = Math.max(0, 0.9 * (1 - k));
      if (r.life <= 0) {
        this.scene.remove(r.mesh);
        r.mesh.geometry.dispose();
        (r.mesh.material as Material).dispose();
        this.rings.splice(i, 1);
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Camera                                                           */
  /* ---------------------------------------------------------------- */

  /** Distance that fits `w` units across and `l` units along the view. */
  private fitDistance(w: number, l: number, pitch: number): number {
    const vfov = (this.camera.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const byW = w / 2 / Math.tan(hfov / 2);
    const byL = (l * Math.sin(pitch)) / 2 / Math.tan(vfov / 2);
    return Math.max(byW, byL);
  }

  private updateCamera(view: HoleView, dt: number): void {
    const rt = this.rt;
    const c = view.course;
    const hole = view.hole;
    const W = c.maxX - c.minX;
    const L = c.maxY - c.minY;
    const portrait = this.camera.aspect < 0.8;
    const followPitch = portrait ? 0.98 : 0.9;
    const overPitch = 1.18;

    // Follow target: the ball, kept in the lower part of the screen, clamped to the hole.
    const sim = rt.sim;
    const focus = rt.spectator ? leaderGhost(rt) ?? hole.tee : { x: sim.x, y: sim.y };
    const followDist = Math.min(portrait ? 15 : 13, Math.max(portrait ? 8.5 : 9, this.fitDistance(Math.min(W, 7) + 1.4, 8, followPitch)));
    const visibleL = 2 * followDist * Math.tan((this.camera.fov * Math.PI) / 360) / Math.sin(followPitch);
    const ahead = Math.min(visibleL * 0.22, 3);
    const wantY = Math.max(c.minY + visibleL * 0.32, Math.min(c.maxY - visibleL * 0.3, focus.y + ahead));
    const k = 1 - Math.exp(-dt * (rt.phase === "roll" ? 3.2 : 2.2));
    this.followY += (wantY - this.followY) * k;
    const halfW = followDist * Math.tan(Math.atan(Math.tan((this.camera.fov * Math.PI) / 360) * this.camera.aspect)) * 0.9;
    const midX = (c.minX + c.maxX) / 2;
    const wantX = W / 2 <= halfW ? midX : Math.max(c.minX + halfW, Math.min(c.maxX - halfW, focus.x));

    // Overview: the whole hole from higher up.
    const over = rt.overview || rt.spectator;
    this.overviewBlend += ((over ? 1 : 0) - this.overviewBlend) * (1 - Math.exp(-dt * 5));
    const overDist = this.fitDistance(W + 1.6, L + 1.6, overPitch);

    let tx = wantX + this.panX;
    let ty = this.followY + this.panY;
    let dist = followDist;
    let pitch = followPitch;
    const ob = this.overviewBlend;
    tx = tx * (1 - ob) + midX * ob;
    ty = ty * (1 - ob) + ((c.minY + c.maxY) / 2) * ob;
    dist = dist * (1 - ob) + overDist * ob;
    pitch = pitch * (1 - ob) + overPitch * ob;

    // Intro flyover: from high over the cup, down the hole to the tee.
    if (rt.phase === "intro") {
      const u = easeInOut(rt.introProgress);
      const path = hole.flyover;
      const p = samplePath(path, u);
      const startDist = overDist * 0.8;
      const endY = Math.max(c.minY + visibleL * 0.32, Math.min(c.maxY - visibleL * 0.3, hole.tee.y + ahead));
      const blend = smooth01((u - 0.7) / 0.3);
      tx = p.x * (1 - blend) + wantX * blend;
      ty = p.y * (1 - blend) + endY * blend;
      dist = startDist * (1 - u) + followDist * u;
      pitch = 1.25 * (1 - u) + followPitch * u;
      this.followY = ty;
    }

    this.cam = { x: tx, y: ty, h: c.height(tx, ty) * 0.5, dist, pitch };
    let px = tx;
    let py = this.cam.h + Math.sin(pitch) * dist;
    const pz = -ty + Math.cos(pitch) * dist;
    if (this.shake > 0 && !this.reduced) {
      const s = this.shake * 0.12;
      px += (Math.random() - 0.5) * s;
      py += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 2.5);
    }
    this.camera.position.set(px, py, pz);
    this.camera.lookAt(tx, this.cam.h, -ty);
  }

  /* ---------------------------------------------------------------- */
  /* Performance                                                      */
  /* ---------------------------------------------------------------- */

  private adapt(ms: number): void {
    this.frameTimes.push(ms);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes = [];
    if (avg > 14 && this.quality.dpr > 1) {
      this.quality = { ...this.quality, dpr: Math.max(1, this.quality.dpr - 0.25) };
      this.renderer.setPixelRatio(this.quality.dpr);
      this.renderer.setSize(this.width, this.height, false);
    }
  }

  dispose(): void {
    if (this.view) this.disposeHole(this.view);
    for (const d of this.shared) d.dispose();
    for (const r of this.rings) {
      r.mesh.geometry.dispose();
      (r.mesh.material as Material).dispose();
    }
    this.renderer.dispose();
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function shapeGeometry(s: Shape, grow = 0): ShapeGeometry {
  const shape = new ThreeShape();
  if (s.kind === "circle") shape.absarc(s.x, s.y, s.r + grow, 0, Math.PI * 2, false);
  else if (s.kind === "ellipse") shape.absellipse(s.x, s.y, s.rx + grow, s.ry + grow, 0, Math.PI * 2, false, 0);
  else {
    shape.moveTo(s.x0 - grow, s.y0 - grow);
    shape.lineTo(s.x1 + grow, s.y0 - grow);
    shape.lineTo(s.x1 + grow, s.y1 + grow);
    shape.lineTo(s.x0 - grow, s.y1 + grow);
    shape.closePath();
  }
  const g = new ShapeGeometry(shape, 48);
  // ShapeGeometry lies in XY; rotateX(−π/2) later maps y → −z, as course space wants.
  const uv = g.attributes.uv!;
  const p = g.attributes.position!;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), p.getY(i));
  return g;
}

function shapeCenter(s: Shape): Vec {
  return s.kind === "rect" ? { x: (s.x0 + s.x1) / 2, y: (s.y0 + s.y1) / 2 } : { x: s.x, y: s.y };
}

/** Normal of the first static collider the aim ray touches at (x, y), if any. */
function contactNormal(c: CompiledHole, x: number, y: number): Vec | null {
  for (const cap of c.capsules) {
    if (x + BALL_R < cap.minX || x - BALL_R > cap.maxX || y + BALL_R < cap.minY || y - BALL_R > cap.maxY) continue;
    const abx = cap.bx - cap.ax;
    const aby = cap.by - cap.ay;
    const len2 = abx * abx + aby * aby;
    let t = len2 > 0 ? ((x - cap.ax) * abx + (y - cap.ay) * aby) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = cap.ax + abx * t;
    const qy = cap.ay + aby * t;
    const d = Math.hypot(x - qx, y - qy);
    if (d < BALL_R + cap.r) return d > 1e-6 ? { x: (x - qx) / d, y: (y - qy) / d } : null;
  }
  return null;
}

function leaderGhost(rt: GolfRuntime): Vec | null {
  for (const s of rt.seats) if (s.ghost && s.ghost.hole === rt.holeIndex) return { x: s.ghost.x, y: s.ghost.y };
  return null;
}

function samplePath(path: readonly Vec[], u: number): Vec {
  if (path.length === 1) return path[0]!;
  const seg = Math.min(path.length - 2, Math.floor(u * (path.length - 1)));
  const f = u * (path.length - 1) - seg;
  const a = path[seg]!;
  const b = path[seg + 1]!;
  const s = f * f * (3 - 2 * f);
  return { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s };
}

function easeInOut(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

function smooth01(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

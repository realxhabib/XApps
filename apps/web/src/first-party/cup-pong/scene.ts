/**
 * The Cup Pong table in three.js, driven imperatively (no React in the
 * frame loop). Built to hold 60 fps on phones: ~40 draw calls, no shadow
 * maps (blob shadows instead), one PMREM'd room environment for the glossy
 * cups and ball, pooled particles, and frames rendered only while something
 * moves.
 *
 * The camera always sits behind the player whose throw is shown and orbits
 * around the table when the turn changes. Throws are *replayed* from a
 * trajectory (see physics.ts): the scene never simulates anything itself.
 */

import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  DirectionalLight,
  Fog,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  PointLight,
  Points,
  PointsMaterial,
  Raycaster,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Texture,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import {
  BALL_R,
  CUP_BOTTOM_R,
  CUP_H,
  CUP_TOP_R,
  FIRE_BALL_R,
  LIQUID_Y,
  RIM_TUBE,
  TABLE_L,
  TABLE_THICK,
  TABLE_W,
  cupRadiusAt,
  cupWorld,
  other,
  toWorld,
  type Cup,
  type Seat,
  type Vec3,
} from "./geometry";
import { EV_SINK, HAND, samplePath, type PathPoint, type ThrowEvent } from "./physics";
import { seededRandom } from "./logic";
import { blobTexture, floorTexture, glowTexture, tableTexture } from "./textures";

/* ---------------------------------------------------------------------- */
/* Look                                                                   */
/* ---------------------------------------------------------------------- */

const CUP_RED = new Color("#e3182c");
const CUP_INSIDE = new Color("#f7f3ee");
const DRINK = "#43b6ff";
const FIRE = new Color("#ff7a1a");
const BLACK = new Color(0, 0, 0);

/** Camera rig in the thrower's frame. */
const CAM_POS = new Vector3(0, 0.74, -1.02);
const CAM_LOOK = new Vector3(0, -0.05, 1.8);
/** Vertical half field of view: rack in the upper third, ball in hand near the bottom. */
const HALF_FOV = (13.2 * Math.PI) / 180;
const CENTER_Z = TABLE_L / 2;

const ORBIT_MS = 1_050;
const REMOVE_DELAY_MS = 260;
const REMOVE_MS = 720;
const SLIDE_MS = 620;

export interface SceneEvent {
  kind: ThrowEvent["kind"];
  speed: number;
  cup: number;
  thrower: Seat;
}

export interface SceneOptions {
  reducedMotion: boolean;
  onEvent?: (event: SceneEvent) => void;
  /** Called with the measured average fps a few seconds in (for quality). */
  onFps?: (fps: number) => void;
}

interface CupRig {
  key: string;
  seat: Seat;
  id: number;
  group: Group;
  body: Mesh;
  material: MeshStandardMaterial;
  removing: boolean;
  pickable: boolean;
}

interface Tween {
  start: number;
  duration: number;
  update: (k: number) => void;
  done?: () => void;
}

interface Flight {
  seat: Seat;
  path: PathPoint[];
  events: ThrowEvent[];
  fire: boolean;
  start: number;
  next: number;
  end: number;
  sunk: boolean;
  resolve: () => void;
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
}

const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const easeOutBack = (k: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
};

/** A Solo-style cup profile: outside wall with two ridges, rolled lip, inside wall, floor. */
function cupProfile(): { points: Vector2[]; inside: number } {
  const pts: Vector2[] = [];
  pts.push(new Vector2(0.0001, 0.002));
  pts.push(new Vector2(CUP_BOTTOM_R - 0.002, 0));
  pts.push(new Vector2(CUP_BOTTOM_R, 0.004));
  const ridges = [0.034, 0.058];
  for (let y = 0.012; y < CUP_H - 0.006; y += 0.008) {
    let r = cupRadiusAt(y);
    if (ridges.some((ry) => Math.abs(y - ry) < 0.004)) r += 0.0012;
    pts.push(new Vector2(r, y));
  }
  // Rolled lip.
  for (let a = -Math.PI / 2; a <= Math.PI * 1.1; a += Math.PI / 6) {
    pts.push(new Vector2(CUP_TOP_R + Math.cos(a) * RIM_TUBE * 0.9, CUP_H + Math.sin(a) * RIM_TUBE));
  }
  const inside = pts.length;
  for (let y = CUP_H - 0.006; y > 0.008; y -= 0.012) pts.push(new Vector2(cupRadiusAt(y) - 0.0018, y));
  pts.push(new Vector2(CUP_BOTTOM_R - 0.004, 0.006));
  pts.push(new Vector2(0.0001, 0.006));
  return { points: pts, inside };
}

function cupGeometry(): LatheGeometry {
  const { points, inside } = cupProfile();
  const segments = 36;
  const geo = new LatheGeometry(points, segments);
  // Red outside, white lip and inside: colour per profile point.
  const colors = new Float32Array(geo.attributes.position!.count * 3);
  const lipStart = inside - 8;
  for (let i = 0; i <= segments; i++) {
    for (let j = 0; j < points.length; j++) {
      const c = j >= lipStart ? CUP_INSIDE : CUP_RED;
      const idx = (i * points.length + j) * 3;
      colors[idx] = c.r;
      colors[idx + 1] = c.g;
      colors[idx + 2] = c.b;
    }
  }
  geo.setAttribute("color", new BufferAttribute(colors, 3));
  return geo;
}

/* ---------------------------------------------------------------------- */
/* Scene                                                                  */
/* ---------------------------------------------------------------------- */

export class PongScene {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(30, 1, 0.03, 40);
  private readonly opts: SceneOptions;
  private readonly textures: Texture[] = [];
  private readonly disposables: { dispose(): void }[] = [];

  private readonly cupGeo = cupGeometry();
  private readonly drinkGeo = new CircleGeometry(cupRadiusAt(LIQUID_Y) - 0.0015, 28);
  private readonly drinkMat = new MeshStandardMaterial({ color: DRINK, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.9 });
  private readonly shadowGeo = new PlaneGeometry(1, 1);
  private readonly shadowMat: MeshBasicMaterial;
  private readonly cups = new Map<string, CupRig>();

  private readonly ball: Mesh;
  private readonly ballMat = new MeshStandardMaterial({ color: "#fbf8f1", roughness: 0.32, metalness: 0 });
  private readonly ballShadow: Mesh;
  private readonly preview: Points;
  private readonly trail: Points;
  private readonly trailPos: Float32Array;
  private readonly trailCol: Float32Array;
  private trailHead = 0;
  private readonly sparks: Points;
  private readonly sparkPool: Particle[] = [];
  private readonly drops: Points;
  private readonly dropPool: Particle[] = [];

  private width = 1;
  private height = 1;
  private raf = 0;
  private last = 0;
  private dirty = true;
  private disposed = false;
  private readonly tweens: Tween[] = [];
  private flight: Flight | null = null;

  /** Camera orbit angle: 0 behind seat 0, π behind seat 1. */
  private phi = 0;
  private orbit: { from: number; to: number; start: number } | null = null;
  private viewSeat: Seat = 0;
  private readonly camPos = new Vector3();
  private readonly camLook = new Vector3();
  private followY = 0;

  private hand = { visible: true, seat: 0 as Seat, aim: 0, lift: 0, fire: false };
  private pickPulse = false;
  private fpsProbe = { frames: 0, time: 0, reported: false };

  constructor(canvas: HTMLCanvasElement, options: SceneOptions) {
    this.opts = options;
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.setClearColor("#0c0d13");

    const pmrem = new PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.28;
    this.textures.push(env);
    this.scene.background = new Color("#0c0d13");
    this.scene.fog = new Fog("#0c0d13", 4.5, 10);

    this.addLights();
    this.addRoom();
    this.addTable();

    const blob = blobTexture();
    this.textures.push(blob);
    this.shadowMat = new MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false, opacity: 0.55 });

    // Ball + its shadow.
    this.ball = new Mesh(new SphereGeometry(BALL_R, 28, 18), this.ballMat);
    this.scene.add(this.ball);
    this.ballShadow = new Mesh(this.shadowGeo, this.shadowMat.clone());
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.ballShadow.renderOrder = 1;
    this.scene.add(this.ballShadow);

    const glow = glowTexture();
    this.textures.push(glow);

    // Arc preview dots.
    const pg = new BufferGeometry();
    pg.setAttribute("position", new Float32BufferAttribute(new Float32Array(24 * 3), 3));
    pg.setDrawRange(0, 0);
    this.preview = new Points(
      pg,
      new PointsMaterial({ map: glow, size: 0.028, color: "#ffffff", transparent: true, opacity: 0.55, depthWrite: false }),
    );
    this.preview.frustumCulled = false;
    this.scene.add(this.preview);

    // Fire trail.
    const TRAIL = 40;
    this.trailPos = new Float32Array(TRAIL * 3).fill(-99);
    this.trailCol = new Float32Array(TRAIL * 3);
    const tg = new BufferGeometry();
    tg.setAttribute("position", new BufferAttribute(this.trailPos, 3));
    tg.setAttribute("color", new BufferAttribute(this.trailCol, 3));
    this.trail = new Points(
      tg,
      new PointsMaterial({
        map: glow,
        size: 0.07,
        vertexColors: true,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.trail.frustumCulled = false;
    this.trail.visible = false;
    this.scene.add(this.trail);

    // Celebration sparks and water drops (pooled).
    this.sparks = this.particleSystem(90, glow, 0.035, true);
    this.drops = this.particleSystem(60, glow, 0.02, false, DRINK);
    for (let i = 0; i < 90; i++) this.sparkPool.push({ x: 0, y: -99, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1 });
    for (let i = 0; i < 60; i++) this.dropPool.push({ x: 0, y: -99, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1 });

    this.applyCamera(0);
    this.raf = requestAnimationFrame(this.frame);
  }

  /* ------------------------------------------------------------------ */
  /* Building                                                           */
  /* ------------------------------------------------------------------ */

  private addLights() {
    this.scene.add(new HemisphereLight("#fff3e4", "#1c1f2a", 0.55));
    const key = new DirectionalLight("#fff6ea", 1.2);
    key.position.set(0.8, 3.2, CENTER_Z - 0.6);
    key.target.position.set(0, 0, CENTER_Z);
    this.scene.add(key, key.target);
    const rim = new DirectionalLight("#9fb6ff", 0.55);
    rim.position.set(-2, 1.5, CENTER_Z + 2.5);
    this.scene.add(rim);
    const lamp = new PointLight("#ffd9a8", 1.6, 4.5, 1.6);
    lamp.position.set(0, 1.45, CENTER_Z);
    this.scene.add(lamp);
  }

  private addRoom() {
    const floorTex = floorTexture();
    this.textures.push(floorTex);
    const floor = new Mesh(new CircleGeometry(9, 48), new MeshBasicMaterial({ map: floorTex }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -0.76, CENTER_Z);
    this.scene.add(floor);
    this.disposables.push(floor.geometry, floor.material as MeshBasicMaterial);

    // Bar lights out of focus behind both ends of the table (the camera sees one end at a time).
    const glow = glowTexture();
    this.textures.push(glow);
    const colors = ["#ffb45c", "#ff5f7a", "#5cc8ff", "#ffd27a", "#b88cff", "#ff8a3d"];
    const rnd = seededRandom(7);
    for (let i = 0; i < 28; i++) {
      const end = i % 2 === 0 ? 1 : -1;
      const mat = new SpriteMaterial({
        map: glow,
        color: colors[i % colors.length],
        transparent: true,
        opacity: 0.25 + rnd() * 0.35,
        blending: AdditiveBlending,
        depthWrite: false,
        fog: false,
      });
      const s = new Sprite(mat);
      const depth = 2.2 + rnd() * 3;
      s.position.set((rnd() - 0.5) * 5.5, 0.15 + rnd() * 1.6, CENTER_Z + end * (TABLE_L / 2 + depth));
      const size = 0.25 + rnd() * 0.45;
      s.scale.set(size, size, 1);
      this.scene.add(s);
      this.disposables.push(mat);
    }
  }

  private addTable() {
    const top = tableTexture(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));
    this.textures.push(top);
    const side = new MeshStandardMaterial({ color: "#5b3419", roughness: 0.6 });
    // Satin lacquer: at this grazing camera angle a glossy top would mirror the room and wash out.
    const topMat = new MeshStandardMaterial({ map: top, roughness: 0.62, metalness: 0, envMapIntensity: 0.12 });
    // Box faces: +x, -x, +y (top), -y, +z, -z.
    const table = new Mesh(new BoxGeometry(TABLE_W, TABLE_THICK, TABLE_L), [side, side, topMat, side, side, side]);
    table.position.set(0, -TABLE_THICK / 2, CENTER_Z);
    this.scene.add(table);
    this.disposables.push(table.geometry, side, topMat);

    const legMat = new MeshStandardMaterial({ color: "#23262f", roughness: 0.5, metalness: 0.6 });
    const legGeo = new BoxGeometry(0.04, 0.72, 0.04);
    for (const [x, z] of [
      [-1, 0.1],
      [1, 0.1],
      [-1, TABLE_L - 0.1],
      [1, TABLE_L - 0.1],
    ] as const) {
      const leg = new Mesh(legGeo, legMat);
      leg.position.set(x * (TABLE_W / 2 - 0.04), -0.36 - TABLE_THICK, z);
      this.scene.add(leg);
    }
    this.disposables.push(legGeo, legMat);
  }

  private particleSystem(count: number, map: Texture, size: number, additive: boolean, color = "#ffffff"): Points {
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(new Float32Array(count * 3).fill(-99), 3));
    geo.setAttribute("color", new BufferAttribute(new Float32Array(count * 3).fill(1), 3));
    const mat = new PointsMaterial({ map, size, color, vertexColors: true, transparent: true, depthWrite: false });
    if (additive) mat.blending = AdditiveBlending;
    const pts = new Points(geo, mat);
    pts.frustumCulled = false;
    this.scene.add(pts);
    this.disposables.push(geo, mat);
    return pts;
  }

  private makeCup(seat: Seat, cup: Cup): CupRig {
    const group = new Group();
    const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0, side: DoubleSide });
    const body = new Mesh(this.cupGeo, material);
    body.userData.cupKey = `${seat}:${cup.id}`;
    group.add(body);
    const drink = new Mesh(this.drinkGeo, this.drinkMat);
    drink.rotation.x = -Math.PI / 2;
    drink.position.y = LIQUID_Y;
    group.add(drink);
    const shadow = new Mesh(this.shadowGeo, this.shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.0008;
    shadow.scale.setScalar(CUP_BOTTOM_R * 3.4);
    shadow.renderOrder = 1;
    group.add(shadow);
    const p = cupWorld(seat, cup);
    group.position.set(p.x, 0, p.z);
    this.scene.add(group);
    return { key: `${seat}:${cup.id}`, seat, id: cup.id, group, body, material, removing: false, pickable: false };
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                         */
  /* ------------------------------------------------------------------ */

  resize(width: number, height: number, dpr: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.width, this.height, false);
    const aspect = this.width / this.height;
    // A fixed vertical framing; very narrow screens widen it so the far end
    // of the table (with a margin) still fits across.
    const tanH = 0.34 / (TABLE_L - 0.2 - CAM_POS.z);
    const tanV = Math.min(Math.tan((24 * Math.PI) / 180), Math.max(Math.tan(HALF_FOV), tanH / aspect));
    this.camera.fov = (2 * Math.atan(tanV) * 180) / Math.PI;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  setPixelRatio(dpr: number) {
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.width, this.height, false);
    this.dirty = true;
  }

  /** Syncs the cups on the table with both racks: new cups pop in, moved cups slide, missing cups leave. */
  setRacks(racks: readonly [readonly Cup[], readonly Cup[]], animate: boolean) {
    const seen = new Set<string>();
    const now = performance.now();
    racks.forEach((rack, s) => {
      const seat = s as Seat;
      for (const cup of rack) {
        const key = `${seat}:${cup.id}`;
        seen.add(key);
        let rig = this.cups.get(key);
        if (!rig) {
          rig = this.makeCup(seat, cup);
          this.cups.set(key, rig);
          if (animate && !this.opts.reducedMotion) {
            const g = rig.group;
            g.scale.setScalar(0.001);
            this.tween(now + cup.id * 35, 420, (k) => g.scale.setScalar(Math.max(0.001, easeOutBack(k))));
          }
          continue;
        }
        if (rig.removing) continue;
        const target = cupWorld(seat, cup);
        const g = rig.group;
        if (Math.abs(g.position.x - target.x) > 1e-4 || Math.abs(g.position.z - target.z) > 1e-4) {
          if (!animate || this.opts.reducedMotion) {
            g.position.set(target.x, 0, target.z);
          } else {
            const fx = g.position.x;
            const fz = g.position.z;
            this.tween(now, SLIDE_MS, (k) => {
              const e = easeInOut(k);
              g.position.set(fx + (target.x - fx) * e, Math.sin(Math.PI * k) * 0.05, fz + (target.z - fz) * e);
            });
          }
        }
      }
    });
    for (const [key, rig] of this.cups) {
      if (!seen.has(key) && !rig.removing) this.removeCup(rig, animate, false);
    }
    this.dirty = true;
  }

  /** Puts the camera behind `seat` (orbiting around the table unless `instant`). */
  setView(seat: Seat, instant = false) {
    if (seat === this.viewSeat) return;
    this.viewSeat = seat;
    const base = seat === 0 ? 0 : Math.PI;
    if (instant || this.opts.reducedMotion) {
      this.orbit = null;
      this.phi = base;
    } else {
      // Always keep walking the same way round the table.
      const from = this.phi;
      let to = base;
      while (to <= from + 1e-6) to += Math.PI * 2;
      this.orbit = { from, to, start: performance.now() };
    }
    this.dirty = true;
  }

  get orbiting(): boolean {
    return this.orbit !== null;
  }

  /** The ball waiting in the thrower's hand; `aim` −1…1 leans it sideways, `lift` 0…1 raises it while you swipe. */
  setHand(hand: { visible: boolean; seat: Seat; aim: number; lift: number; fire: boolean }) {
    this.hand = { ...hand };
    this.dirty = true;
  }

  /** Arc preview in the given seat's frame (null hides it). */
  setPreview(points: readonly Vec3[] | null, seat: Seat) {
    const geo = this.preview.geometry;
    const attr = geo.attributes.position as BufferAttribute;
    if (!points || points.length === 0) {
      geo.setDrawRange(0, 0);
    } else {
      const n = Math.min(points.length, attr.count);
      for (let i = 0; i < n; i++) {
        const p = toWorld(seat, points[i]!);
        attr.setXYZ(i, p.x, p.y, p.z);
      }
      attr.needsUpdate = true;
      geo.setDrawRange(1, n - 1);
    }
    this.dirty = true;
  }

  /** Makes a seat's cups tappable (and glow) for a bonus pick; null clears. */
  setPickable(defender: Seat | null) {
    this.pickPulse = defender !== null;
    for (const rig of this.cups.values()) {
      rig.pickable = defender !== null && rig.seat === defender && !rig.removing;
      if (!rig.pickable) rig.material.emissive.setRGB(0, 0, 0);
    }
    this.dirty = true;
  }

  /** The id of the pickable cup under a screen point, if any. */
  pickAt(clientX: number, clientY: number, rect: DOMRect): number | null {
    const ray = new Raycaster();
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, this.camera);
    const bodies = [...this.cups.values()].filter((r) => r.pickable).map((r) => r.body);
    const hit = ray.intersectObjects(bodies, false)[0];
    if (hit) return this.cups.get(hit.object.userData.cupKey as string)?.id ?? null;
    // Forgiving: the nearest pickable cup to the tap on screen.
    let best: { id: number; d: number } | null = null;
    const v = new Vector3();
    for (const rig of this.cups.values()) {
      if (!rig.pickable) continue;
      v.set(rig.group.position.x, CUP_H * 0.6, rig.group.position.z).project(this.camera);
      const d = Math.hypot(v.x - ndc.x, (v.y - ndc.y) / (rect.width / rect.height));
      if (!best || d < best.d) best = { id: rig.id, d };
    }
    return best && best.d < 0.12 ? best.id : null;
  }

  /** Replays a throw by `seat`. Resolves after the ball has settled. */
  playThrow(seat: Seat, path: PathPoint[], events: ThrowEvent[], fire: boolean): Promise<void> {
    this.flight?.resolve();
    return new Promise((resolve) => {
      const last = path[path.length - 1]!;
      const sunk = events.some((e) => e.kind === EV_SINK);
      this.flight = {
        seat,
        path,
        events,
        fire,
        start: performance.now(),
        next: 0,
        end: last.t + (sunk ? 380 : 260),
        sunk,
        resolve: () => {
          this.flight = null;
          resolve();
        },
      };
      this.trailPos.fill(-99);
      this.trail.visible = fire;
      this.setPreview(null, seat);
      this.dirty = true;
    });
  }

  /** Celebrates a cup leaving the table (used when a pick or a sync removes it). */
  removeCupById(defender: Seat, id: number, celebrate: boolean) {
    const rig = this.cups.get(`${defender}:${id}`);
    if (rig && !rig.removing) this.removeCup(rig, true, celebrate);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.flight?.resolve();
    for (const rig of this.cups.values()) rig.material.dispose();
    this.cupGeo.dispose();
    this.drinkGeo.dispose();
    this.drinkMat.dispose();
    this.shadowGeo.dispose();
    this.shadowMat.dispose();
    (this.ballShadow.material as MeshBasicMaterial).dispose();
    this.ball.geometry.dispose();
    this.ballMat.dispose();
    this.preview.geometry.dispose();
    (this.preview.material as PointsMaterial).dispose();
    this.trail.geometry.dispose();
    (this.trail.material as PointsMaterial).dispose();
    for (const d of this.disposables) d.dispose();
    for (const t of this.textures) t.dispose();
    this.renderer.dispose();
    // Free the GL context right away (browsers cap how many a page may hold).
    this.renderer.forceContextLoss();
  }

  /* ------------------------------------------------------------------ */
  /* Internals                                                          */
  /* ------------------------------------------------------------------ */

  private tween(start: number, duration: number, update: (k: number) => void, done?: () => void) {
    this.tweens.push({ start, duration, update, done });
    this.dirty = true;
  }

  private removeCup(rig: CupRig, animate: boolean, celebrate: boolean) {
    rig.removing = true;
    rig.pickable = false;
    const finish = () => {
      this.scene.remove(rig.group);
      rig.material.dispose();
      this.cups.delete(rig.key);
      this.dirty = true;
    };
    if (!animate) {
      finish();
      return;
    }
    const g = rig.group;
    const now = performance.now();
    if (this.opts.reducedMotion) {
      this.tween(now, 260, (k) => g.scale.setScalar(Math.max(0.001, 1 - k)), finish);
      return;
    }
    const delay = celebrate ? REMOVE_DELAY_MS : 0;
    if (celebrate) {
      this.tween(now + delay * 0.6, 200, (k) => rig.material.emissive.setRGB(0.9 * k, 0.55 * k, 0.1 * k));
    }
    this.tween(
      now + delay,
      REMOVE_MS,
      (k) => {
        // Hop up, spin, shrink away.
        const hop = Math.sin(Math.min(1, k * 1.25) * Math.PI) * 0.16;
        g.position.y = hop + k * 0.05;
        g.rotation.y = easeInOut(k) * Math.PI * 2.5;
        g.rotation.z = Math.sin(k * Math.PI) * 0.35;
        g.scale.setScalar(Math.max(0.001, k < 0.55 ? 1 + k * 0.25 : (1 - k) * 3.05));
      },
      finish,
    );
    if (celebrate) {
      setTimeout(() => {
        if (!this.disposed) this.burst(this.sparkPool, g.position.x, CUP_H + 0.08, g.position.z, 40, 1.1, 0.9);
      }, delay + REMOVE_MS * 0.45);
    }
  }

  private burst(pool: Particle[], x: number, y: number, z: number, count: number, speed: number, life: number) {
    let spawned = 0;
    for (const p of pool) {
      if (p.life > 0) continue;
      const a = Math.random() * Math.PI * 2;
      const up = 0.4 + Math.random() * 0.8;
      const s = speed * (0.35 + Math.random() * 0.65);
      p.x = x;
      p.y = y;
      p.z = z;
      p.vx = Math.cos(a) * s * 0.6;
      p.vz = Math.sin(a) * s * 0.6;
      p.vy = up * s;
      p.max = life * (0.6 + Math.random() * 0.4);
      p.life = p.max;
      if (++spawned >= count) break;
    }
    this.dirty = true;
  }

  private updateParticles(points: Points, pool: Particle[], dt: number, gravity: number, palette: (t: number) => [number, number, number]) {
    const pos = points.geometry.attributes.position as BufferAttribute;
    const col = points.geometry.attributes.color as BufferAttribute;
    let alive = false;
    pool.forEach((p, i) => {
      if (p.life <= 0) {
        pos.setXYZ(i, 0, -99, 0);
        return;
      }
      alive = true;
      p.life -= dt;
      p.vy -= gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const t = Math.max(0, p.life / p.max);
      const [r, g, b] = palette(t);
      pos.setXYZ(i, p.x, p.y, p.z);
      col.setXYZ(i, r * t, g * t, b * t);
    });
    pos.needsUpdate = true;
    col.needsUpdate = true;
    return alive;
  }

  private cameraAt(phi: number, pos: Vector3, look: Vector3, lift: number) {
    const rot = (v: Vector3, out: Vector3) => {
      const x = v.x;
      const z = v.z - CENTER_Z;
      out.set(x * Math.cos(phi) + z * Math.sin(phi), v.y, CENTER_Z - x * Math.sin(phi) + z * Math.cos(phi));
    };
    rot(CAM_POS, pos);
    pos.y += lift;
    rot(CAM_LOOK, look);
  }

  private applyCamera(now: number) {
    let lift = 0;
    if (this.orbit) {
      const k = Math.min(1, (now - this.orbit.start) / ORBIT_MS);
      const e = easeInOut(k);
      this.phi = this.orbit.from + (this.orbit.to - this.orbit.from) * e;
      lift = Math.sin(Math.PI * e) * 0.55;
      if (k >= 1) {
        this.phi = ((this.orbit.to % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        this.orbit = null;
      }
    }
    const pos = this.camPos;
    const look = this.camLook;
    this.cameraAt(this.phi, pos, look, lift);
    // Follow the ball up a little so lobs stay on screen.
    look.y += this.followY;
    pos.y += this.followY * 0.35;
    this.camera.position.copy(pos);
    this.camera.lookAt(look);
  }

  private readonly frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0.016;
    this.last = now;
    let active = this.dirty || this.orbit !== null || this.flight !== null || this.tweens.length > 0 || this.pickPulse;

    // Tweens.
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const t = this.tweens[i]!;
      if (now < t.start) continue;
      const k = Math.min(1, (now - t.start) / t.duration);
      t.update(k);
      if (k >= 1) {
        this.tweens.splice(i, 1);
        t.done?.();
      }
    }

    // Ball: in flight or in hand.
    let followTarget = 0;
    const flight = this.flight;
    const fire = flight ? flight.fire : this.hand.fire;
    const radius = fire ? FIRE_BALL_R : BALL_R;
    this.ball.scale.setScalar(radius / BALL_R);
    this.ballMat.emissive.copy(fire ? FIRE : BLACK);
    this.ballMat.emissiveIntensity = fire ? 0.9 + Math.sin(now / 60) * 0.25 : 0;
    let ballPos: Vec3 | null = null;
    let insideCup = false;
    if (flight) {
      const t = now - flight.start;
      const local = samplePath(flight.path, t);
      ballPos = toWorld(flight.seat, local);
      while (flight.next < flight.events.length && flight.events[flight.next]!.t <= t) {
        const ev = flight.events[flight.next++]!;
        this.onFlightEvent(flight, ev);
      }
      const lastT = flight.path[flight.path.length - 1]!.t;
      if (flight.sunk && t >= lastT - 150) insideCup = true;
      followTarget = Math.max(0, Math.min(0.32, (local.y - 0.3) * 0.55)) * (t < lastT ? 1 : Math.max(0, 1 - (t - lastT) / 300));
      if (fire) this.pushTrail(ballPos);
      if (t >= flight.end) flight.resolve();
      active = true;
    } else if (this.hand.visible) {
      const bob = this.opts.reducedMotion ? 0 : Math.sin(now / 420) * 0.006;
      const local = { x: HAND.x + this.hand.aim * 0.07, y: HAND.y + bob + this.hand.lift * 0.05, z: HAND.z - this.hand.lift * 0.02 };
      ballPos = toWorld(this.hand.seat, local);
      if (!this.opts.reducedMotion) active = true;
      if (fire) this.pushTrail({ x: ballPos.x, y: ballPos.y + 0.01, z: ballPos.z });
    }
    this.ball.visible = ballPos !== null;
    this.trail.visible = fire && ballPos !== null;
    if (ballPos) {
      this.ball.position.set(ballPos.x, ballPos.y, ballPos.z);
      const overTable = Math.abs(ballPos.x) < TABLE_W / 2 && ballPos.z > 0 && ballPos.z < TABLE_L && ballPos.y > -0.01;
      this.ballShadow.visible = overTable && !insideCup;
      if (overTable) {
        const h = Math.max(0, ballPos.y - radius);
        this.ballShadow.position.set(ballPos.x + h * 0.08, 0.0012, ballPos.z + h * 0.05);
        this.ballShadow.scale.setScalar(radius * 2.6 * (1 + h * 1.6));
        (this.ballShadow.material as MeshBasicMaterial).opacity = 0.62 / (1 + h * 5);
      }
    } else {
      this.ballShadow.visible = false;
    }
    if (this.trail.visible) this.fadeTrail();

    // Camera follow (critically damped towards the target).
    this.followY += (followTarget - this.followY) * Math.min(1, dt * 6);
    if (Math.abs(this.followY) > 1e-4) active = true;

    // The thrower's own cups sit right under the camera: keep the view clean
    // (both racks show while the camera walks around the table).
    const hidden = this.orbit ? null : this.viewSeat;
    for (const rig of this.cups.values()) rig.group.visible = rig.seat !== hidden;

    // Pick glow.
    if (this.pickPulse) {
      const k = 0.35 + Math.sin(now / 180) * 0.25;
      for (const rig of this.cups.values()) if (rig.pickable) rig.material.emissive.setRGB(k, k * 0.8, 0.15 * k);
    }

    const sparksAlive = this.updateParticles(this.sparks, this.sparkPool, dt, 2.2, (t) => [1, 0.55 + 0.4 * t, 0.2 + 0.6 * t]);
    const dropsAlive = this.updateParticles(this.drops, this.dropPool, dt, 5.5, () => [0.7, 0.9, 1]);
    if (sparksAlive || dropsAlive) active = true;

    if (!active) return;
    this.applyCamera(now);
    this.renderer.render(this.scene, this.camera);
    this.dirty = false;

    // FPS probe over the first busy seconds.
    const probe = this.fpsProbe;
    if (!probe.reported && this.opts.onFps) {
      probe.frames++;
      probe.time += dt;
      if (probe.time > 3) {
        probe.reported = true;
        this.opts.onFps(probe.frames / probe.time);
      }
    }
  };

  private onFlightEvent(flight: Flight, ev: ThrowEvent) {
    this.opts.onEvent?.({ kind: ev.kind, speed: ev.speed, cup: ev.cup, thrower: flight.seat });
    if (ev.kind === EV_SINK) {
      const defender = other(flight.seat);
      const rig = this.cups.get(`${defender}:${ev.cup}`);
      if (rig) {
        const p = rig.group.position;
        this.burst(this.dropPool, p.x, LIQUID_Y + 0.01, p.z, 26, 1.2, 0.55);
        this.removeCup(rig, true, true);
      }
    }
  }

  private pushTrail(p: Vec3) {
    const n = this.trailPos.length / 3;
    const i = this.trailHead % n;
    this.trailPos[i * 3] = p.x + (Math.random() - 0.5) * 0.01;
    this.trailPos[i * 3 + 1] = p.y + (Math.random() - 0.5) * 0.01;
    this.trailPos[i * 3 + 2] = p.z + (Math.random() - 0.5) * 0.01;
    this.trailHead++;
  }

  private fadeTrail() {
    const n = this.trailPos.length / 3;
    for (let i = 0; i < n; i++) {
      const age = (((this.trailHead - 1 - i) % n) + n) % n;
      const t = 1 - age / n;
      this.trailCol[i * 3] = t;
      this.trailCol[i * 3 + 1] = (0.25 + 0.45 * t) * t;
      this.trailCol[i * 3 + 2] = 0.05 * t;
    }
    (this.trail.geometry.attributes.position as BufferAttribute).needsUpdate = true;
    (this.trail.geometry.attributes.color as BufferAttribute).needsUpdate = true;
  }
}

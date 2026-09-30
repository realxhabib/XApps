/**
 * The 3D view (plain three.js + postprocessing): the environment, the track,
 * every ship with light trails, pickups, hazards, projectiles, particles,
 * speed lines, the chase camera (intro flyover, look-back, finish orbit) and
 * the post stack (bloom, chromatic aberration on boost, vignette, ACES).
 */

import {
  BloomEffect,
  ChromaticAberrationEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  ShaderPass,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from "postprocessing";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  HalfFloatType,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoToneMapping,
  Object3D,
  OctahedronGeometry,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  Quaternion,
  RingGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Texture,
} from "three";
import { buildEnvironment, type EnvironmentHandle } from "./environments";
import { BOX_LANES } from "./items";
import type { RaceRuntime, Racer } from "./race";
import { buildShip, type ShipModel } from "./ships";
import { paintDot, paintItemFace, rng } from "./textures";
import { frameAt, newFrame, trackPoint, wrapS, type CompiledTrack } from "./track";
import { buildTrackView, type TrackView } from "./trackmesh";

export interface Quality {
  level: "high" | "low";
  dpr: number;
  shadows: number;
}

export function detectQuality(): Quality {
  const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 1.5) : 1;
  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const forced = params?.get("quality");
  const level = forced === "low" ? "low" : forced === "high" ? "high" : coarse ? "low" : "high";
  return { level, dpr: level === "low" ? Math.min(dpr, 1.25) : dpr, shadows: level === "low" ? 0 : 2048 };
}

/* ------------------------------------------------------------------ */
/* Particles                                                          */
/* ------------------------------------------------------------------ */

const PARTICLE_VS = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
uniform float uScale;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.5, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const PARTICLE_FS = /* glsl */ `
uniform sampler2D uMap;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 t = texture2D(uMap, gl_PointCoord);
  gl_FragColor = vec4(vColor * t.a * vAlpha, t.a * vAlpha);
}`;

class Particles {
  readonly points: Points;
  private readonly geo = new BufferGeometry();
  private readonly mat: ShaderMaterial;
  private readonly cap: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly life: Float32Array;
  private readonly max: Float32Array;
  private readonly drag: Float32Array;
  private readonly grow: Float32Array;
  private next = 0;

  constructor(cap: number, map: Texture) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 3);
    this.size = new Float32Array(cap);
    this.alpha = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.max = new Float32Array(cap).fill(1);
    this.drag = new Float32Array(cap);
    this.grow = new Float32Array(cap);
    this.geo.setAttribute("position", new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage));
    this.geo.setAttribute("aColor", new BufferAttribute(this.col, 3).setUsage(DynamicDrawUsage));
    this.geo.setAttribute("aSize", new BufferAttribute(this.size, 1).setUsage(DynamicDrawUsage));
    this.geo.setAttribute("aAlpha", new BufferAttribute(this.alpha, 1).setUsage(DynamicDrawUsage));
    this.mat = new ShaderMaterial({
      vertexShader: PARTICLE_VS,
      fragmentShader: PARTICLE_FS,
      uniforms: { uMap: { value: map }, uScale: { value: 300 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.points = new Points(this.geo, this.mat);
    this.points.frustumCulled = false;
  }

  setScale(px: number): void {
    this.mat.uniforms.uScale!.value = px;
  }

  emit(p: Vector3, v: Vector3, color: Color, size: number, life: number, drag = 1, grow = 0): void {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.col.set([color.r, color.g, color.b], i * 3);
    this.size[i] = size;
    this.life[i] = life;
    this.max[i] = life;
    this.drag[i] = drag;
    this.grow[i] = grow;
  }

  update(dt: number): void {
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i]! <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] = this.life[i]! - dt;
      const k = Math.exp(-this.drag[i]! * dt);
      this.vel[i * 3] = this.vel[i * 3]! * k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1]! * k;
      this.vel[i * 3 + 2] = this.vel[i * 3 + 2]! * k;
      this.pos[i * 3] = this.pos[i * 3]! + this.vel[i * 3]! * dt;
      this.pos[i * 3 + 1] = this.pos[i * 3 + 1]! + this.vel[i * 3 + 1]! * dt;
      this.pos[i * 3 + 2] = this.pos[i * 3 + 2]! + this.vel[i * 3 + 2]! * dt;
      this.size[i] = Math.max(0.01, this.size[i]! + this.grow[i]! * dt);
      const t = Math.max(0, this.life[i]! / this.max[i]!);
      this.alpha[i] = t * t * (3 - 2 * t);
    }
    for (const name of ["position", "aColor", "aSize", "aAlpha"]) (this.geo.getAttribute(name) as BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

/* ------------------------------------------------------------------ */
/* Light trails                                                       */
/* ------------------------------------------------------------------ */

const TRAIL_VS = /* glsl */ `
attribute float aT;
varying float vT;
varying float vSide;
attribute float aSide;
void main() {
  vT = aT;
  vSide = aSide;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const TRAIL_FS = /* glsl */ `
uniform vec3 uColor;
uniform float uStrength;
varying float vT;
varying float vSide;
void main() {
  float edge = 1.0 - abs(vSide);
  float a = pow(1.0 - vT, 1.6) * edge * uStrength;
  gl_FragColor = vec4(uColor * (1.0 + (1.0 - vT) * 1.5) * a, a);
}`;

class Trail {
  readonly mesh: Mesh;
  private readonly n: number;
  private readonly pts: Vector3[];
  private readonly geo = new BufferGeometry();
  private readonly mat: ShaderMaterial;
  private readonly posArr: Float32Array;
  private primed = false;

  constructor(n: number, color: Color) {
    this.n = n;
    this.pts = Array.from({ length: n }, () => new Vector3());
    this.posArr = new Float32Array(n * 2 * 3);
    const t = new Float32Array(n * 2);
    const side = new Float32Array(n * 2);
    const index: number[] = [];
    for (let i = 0; i < n; i++) {
      t[i * 2] = i / (n - 1);
      t[i * 2 + 1] = i / (n - 1);
      side[i * 2] = -1;
      side[i * 2 + 1] = 1;
      if (i < n - 1) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    this.geo.setAttribute("position", new BufferAttribute(this.posArr, 3).setUsage(DynamicDrawUsage));
    this.geo.setAttribute("aT", new BufferAttribute(t, 1));
    this.geo.setAttribute("aSide", new BufferAttribute(side, 1));
    this.geo.setIndex(index);
    this.mat = new ShaderMaterial({
      vertexShader: TRAIL_VS,
      fragmentShader: TRAIL_FS,
      uniforms: { uColor: { value: color.clone() }, uStrength: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    this.mesh = new Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
  }

  reset(): void {
    this.primed = false;
  }

  update(head: Vector3, up: Vector3, right: Vector3, width: number, strength: number, color: Color): void {
    if (!this.primed) {
      for (const p of this.pts) p.copy(head);
      this.primed = true;
    }
    for (let i = this.n - 1; i > 0; i--) this.pts[i]!.lerp(this.pts[i - 1]!, 0.55);
    this.pts[0]!.copy(head);
    for (let i = 0; i < this.n; i++) {
      const p = this.pts[i]!;
      const w = width * (1 - (i / this.n) * 0.6);
      // Ribbon lies flat-ish (mix of right and up) so it reads from the chase camera.
      const ox = right.x * w * 0.8 + up.x * w * 0.35;
      const oy = right.y * w * 0.8 + up.y * w * 0.35;
      const oz = right.z * w * 0.8 + up.z * w * 0.35;
      this.posArr.set([p.x - ox, p.y - oy, p.z - oz, p.x + ox, p.y + oy, p.z + oz], i * 6);
    }
    (this.geo.getAttribute("position") as BufferAttribute).needsUpdate = true;
    this.mat.uniforms.uStrength!.value = strength;
    (this.mat.uniforms.uColor!.value as Color).copy(color);
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

/* ------------------------------------------------------------------ */
/* Scene                                                              */
/* ------------------------------------------------------------------ */

interface ShipView {
  racer: Racer;
  model: ShipModel;
  key: string;
  trail: Trail;
  drone: Group;
}

interface ProjectileView {
  mesh: Object3D;
  kind: string;
}

const DRIFT_SPARK = [new Color("#ffffff"), new Color("#48b4ff"), new Color("#ff9a2e"), new Color("#c35cff")];
const UP = new Vector3(0, 1, 0);

export class RaceScene {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(66, 1, 0.3, 6000);
  private readonly rt: RaceRuntime;
  private readonly reduced: boolean;
  private readonly quality: Quality;
  private readonly composer: EffectComposer;
  private readonly bloom: BloomEffect;
  private readonly chroma: ChromaticAberrationEffect;
  private readonly sun: DirectionalLight;
  private readonly hemi: HemisphereLight;
  private env: EnvironmentHandle | null = null;
  private trackView: TrackView | null = null;
  private serial = -1;
  private track: CompiledTrack | null = null;
  private readonly ships = new Map<number, ShipView>();
  private readonly particles: Particles;
  private readonly dot: Texture;
  private readonly shared: { dispose(): void }[] = [];
  private time = 0;
  private shake = 0;
  private readonly fr = newFrame();
  private readonly camPos = new Vector3();
  private readonly camLook = new Vector3();
  private readonly camUp = new Vector3(0, 1, 0);
  private readonly camFwd = new Vector3(0, 0, -1);
  private camInit = false;
  private fov = 66;
  private width = 1;
  private height = 1;

  /* Per-track dynamic objects */
  private pickupGroup = new Group();
  private boxMeshes: Mesh[][] = [];
  private coinMesh: InstancedMesh | null = null;
  private hazardViews: Object3D[] = [];
  private meteorMarks: Mesh[] = [];
  private readonly projectileViews = new Map<string, ProjectileView>();
  private speedLines: InstancedMesh;
  private readonly speedLineData: { x: number; y: number; z: number; len: number }[] = [];
  private empRing: Mesh;
  private empLife = 0;

  /* Shared geometry & materials */
  private readonly boxGeo = new OctahedronGeometry(1.1, 0);
  private readonly boxInnerGeo = new IcosahedronGeometry(0.55, 0);
  private readonly boxMat: MeshStandardMaterial;
  private readonly boxInnerMat = new MeshBasicMaterial({ color: new Color("#ffffff").multiplyScalar(2), toneMapped: false });
  private readonly itemFace: Texture;
  private readonly coinGeo = new CylinderGeometry(0.75, 0.75, 0.18, 20);
  private readonly coinMat = new MeshStandardMaterial({ color: "#ffcf3f", metalness: 1, roughness: 0.22, emissive: "#ff9a00", emissiveIntensity: 0.55 });
  private readonly rockGeo: BufferGeometry;
  private readonly rockMat = new MeshStandardMaterial({ color: "#6e625c", roughness: 0.92, metalness: 0.05, flatShading: true });
  private readonly glowMats = new Map<string, MeshBasicMaterial>();

  constructor(canvas: HTMLCanvasElement, rt: RaceRuntime, reduced: boolean, quality: Quality) {
    this.rt = rt;
    this.reduced = reduced;
    this.quality = quality;
    this.renderer = new WebGLRenderer({ canvas, antialias: false, stencil: false, depth: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(quality.dpr);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NoToneMapping;
    if (quality.shadows > 0) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = PCFSoftShadowMap;
    }

    this.sun = new DirectionalLight("#ffffff", 2.4);
    if (quality.shadows > 0) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(quality.shadows, quality.shadows);
      const cam = this.sun.shadow.camera;
      cam.left = -45;
      cam.right = 45;
      cam.top = 45;
      cam.bottom = -45;
      cam.near = 1;
      cam.far = 260;
      this.sun.shadow.bias = -0.0004;
      this.sun.shadow.normalBias = 0.04;
    }
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new HemisphereLight("#ffffff", "#333333", 0.6);
    this.scene.add(this.hemi);

    this.dot = paintDot();
    this.itemFace = paintItemFace();
    this.boxMat = new MeshStandardMaterial({
      map: this.itemFace,
      transparent: true,
      opacity: 0.82,
      roughness: 0.1,
      metalness: 0.3,
      emissive: new Color("#ffffff"),
      emissiveMap: this.itemFace,
      emissiveIntensity: 0.6,
    });
    const rock = new IcosahedronGeometry(1, 2);
    const rp = rock.getAttribute("position") as BufferAttribute;
    const rr = rng(7);
    const v = new Vector3();
    for (let i = 0; i < rp.count; i++) {
      v.fromBufferAttribute(rp, i);
      const n = 0.78 + 0.3 * Math.sin(v.x * 3.1 + v.y * 1.7) * Math.cos(v.z * 2.3) + rr() * 0.08;
      v.multiplyScalar(n);
      rp.setXYZ(i, v.x, v.y, v.z);
    }
    rock.computeVertexNormals();
    this.rockGeo = rock;
    this.shared.push(this.dot, this.itemFace, this.boxGeo, this.boxInnerGeo, this.boxMat, this.boxInnerMat, this.coinGeo, this.coinMat, this.rockGeo, this.rockMat);

    this.particles = new Particles(quality.level === "low" ? 1600 : 4000, this.dot);
    this.scene.add(this.particles.points);
    this.scene.add(this.pickupGroup);

    // Speed lines: thin streaks around the view that rush past when fast.
    const lineGeo = new PlaneGeometry(0.035, 1);
    lineGeo.rotateX(Math.PI / 2);
    const lineMat = new MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
    this.speedLines = new InstancedMesh(lineGeo, lineMat, 70);
    this.speedLines.frustumCulled = false;
    const lr = rng(3);
    for (let i = 0; i < 70; i++) {
      const a = lr() * Math.PI * 2;
      const r = 2.2 + lr() * 3.5;
      this.speedLineData.push({ x: Math.cos(a) * r, y: Math.sin(a) * r * 0.65, z: -lr() * 40, len: 1.2 + lr() * 2.5 });
    }
    this.camera.add(this.speedLines);
    this.scene.add(this.camera);
    this.shared.push(lineGeo, lineMat);

    const ringGeo = new RingGeometry(0.8, 1, 64);
    const ringMat = new MeshBasicMaterial({ color: new Color("#b56bff").multiplyScalar(3), transparent: true, opacity: 0, side: DoubleSide, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
    this.empRing = new Mesh(ringGeo, ringMat);
    this.scene.add(this.empRing);
    this.shared.push(ringGeo, ringMat);

    // Post-processing.
    this.composer = new EffectComposer(this.renderer, { frameBufferType: HalfFloatType, multisampling: quality.level === "low" ? 0 : 4 });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Additive stacks can overflow half floats (Inf/NaN), which bloom would smear over the whole frame.
    this.composer.addPass(
      new ShaderPass(
        new ShaderMaterial({
          uniforms: { inputBuffer: { value: null } },
          vertexShader: "varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }",
          fragmentShader:
            "uniform sampler2D inputBuffer; varying vec2 vUv; void main() { vec4 c = texture2D(inputBuffer, vUv); bvec4 bad = isnan(c); if (any(bad) || any(isinf(c))) c = vec4(0.0); gl_FragColor = clamp(c, 0.0, 24.0); }",
          depthWrite: false,
          depthTest: false,
        }),
        "inputBuffer",
      ),
    );
    this.bloom = new BloomEffect({ mipmapBlur: true, intensity: 1.1, luminanceThreshold: 0.72, luminanceSmoothing: 0.25, radius: 0.72 });
    this.chroma = new ChromaticAberrationEffect({ offset: new Vector2(0, 0), radialModulation: true, modulationOffset: 0.25 });
    const vignette = new VignetteEffect({ offset: 0.28, darkness: 0.55 });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    if (quality.level === "low") {
      this.composer.addPass(new EffectPass(this.camera, this.bloom, vignette, tone));
    } else {
      // Convolution effects (chromatic aberration, SMAA) each need their own pass.
      this.composer.addPass(new EffectPass(this.camera, this.bloom, this.chroma));
      this.composer.addPass(new EffectPass(this.camera, vignette, tone, new SMAAEffect()));
    }
  }

  resize(w: number, h: number): void {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    this.renderer.setSize(this.width, this.height, false);
    this.composer.setSize(this.width, this.height);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.particles.setScale(this.height * this.quality.dpr * 0.9);
  }

  /* ---------------------------------------------------------------- */
  /* Track build                                                      */
  /* ---------------------------------------------------------------- */

  private rebuild(): void {
    const rt = this.rt;
    this.disposeTrack();
    const track = rt.track;
    this.track = track;
    this.env = buildEnvironment(track.def.theme, track.outline, this.renderer, this.quality.level);
    this.scene.add(this.env.group);
    this.scene.background = this.env.background;
    this.scene.environment = this.env.environment;
    this.scene.environmentIntensity = 0.75;
    this.scene.fog = this.env.fog;
    this.sun.color.copy(this.env.sunColor);
    this.sun.intensity = this.env.sunIntensity;
    this.hemi.color.copy(this.env.hemi.sky);
    this.hemi.groundColor.copy(this.env.hemi.ground);
    this.hemi.intensity = this.env.hemi.intensity;
    this.bloom.intensity = this.env.bloom.strength;
    this.bloom.luminanceMaterial.threshold = this.env.bloom.threshold;
    this.bloom.mipmapBlurPass.radius = this.env.bloom.radius;
    this.exposure = this.env.exposure;

    this.trackView = buildTrackView(track, this.quality.level);
    this.scene.add(this.trackView.group);

    // Item capsules.
    this.pickupGroup = new Group();
    this.scene.add(this.pickupGroup);
    this.boxMeshes = track.itemRows.map((s) => {
      const i = Math.floor(wrapS(s, track.length) / track.step) % track.count;
      return BOX_LANES.map((lane) => {
        const m = new Mesh(this.boxGeo, this.boxMat);
        const inner = new Mesh(this.boxInnerGeo, this.boxInnerMat);
        m.add(inner);
        trackPoint(track, s, lane * track.halfWidth[i]!, 1.5, m.position);
        this.pickupGroup.add(m);
        return m;
      });
    });
    this.coinMesh = new InstancedMesh(this.coinGeo, this.coinMat, Math.max(1, track.coins.length));
    this.coinMesh.castShadow = this.quality.shadows > 0;
    this.pickupGroup.add(this.coinMesh);

    // Hazards.
    this.hazardViews = track.hazards.map((h) => this.buildHazard(h.item.kind, h.item.kind === "asteroid" ? h.item.size : 1));
    this.meteorMarks = track.hazards.map((h) => {
      const mat = new MeshBasicMaterial({ color: new Color("#ff3b1f").multiplyScalar(2.5), transparent: true, opacity: 0, side: DoubleSide, depthWrite: false, toneMapped: false, blending: AdditiveBlending });
      const mark = new Mesh(new RingGeometry(4.4, 5.5, 40), mat);
      mark.visible = h.item.kind === "meteor";
      this.scene.add(mark);
      return mark;
    });
    for (const v of this.hazardViews) this.scene.add(v);

    // Ships.
    for (const view of this.ships.values()) this.removeShip(view);
    this.ships.clear();
    for (const r of rt.racers) this.addShip(r);
    this.camInit = false;
  }

  private exposure = 1;

  private glow(color: string, k = 2.5): MeshBasicMaterial {
    const key = `${color}:${k}`;
    let m = this.glowMats.get(key);
    if (!m) {
      m = new MeshBasicMaterial({ color: new Color(color).multiplyScalar(k), toneMapped: false });
      this.glowMats.set(key, m);
      this.shared.push(m);
    }
    return m;
  }

  private buildHazard(kind: string, size: number): Object3D {
    const g = new Group();
    if (kind === "asteroid") {
      const rock = new Mesh(this.rockGeo, this.rockMat);
      rock.scale.setScalar(size * 0.75);
      rock.castShadow = this.quality.shadows > 0;
      g.add(rock);
      // Glowing ore veins.
      const vein = new Mesh(this.rockGeo, this.glow("#ff6a2a", 1.6));
      vein.scale.setScalar(size * 0.62);
      g.add(vein);
    } else if (kind === "dust") {
      const mat = new MeshBasicMaterial({ color: new Color("#d9864f"), transparent: true, opacity: 0.35, depthWrite: false, side: DoubleSide });
      for (let k = 0; k < 4; k++) {
        const cone = new Mesh(new CylinderGeometry(3.4 - k * 0.5, 0.6 + k * 0.2, 9 + k * 2, 18, 1, true), mat);
        cone.position.y = 4.5 + k;
        g.add(cone);
      }
    } else if (kind === "arc") {
      const post = new CylinderGeometry(0.35, 0.5, 5, 10);
      const postMat = new MeshStandardMaterial({ color: "#2a2340", metalness: 0.8, roughness: 0.3 });
      for (const side of [-1, 0, 1]) {
        const p = new Mesh(post, postMat);
        p.position.set(0, 2.5, 0);
        p.userData.side = side;
        g.add(p);
        const orb = new Mesh(new SphereGeometry(0.6, 12, 10), this.glow("#6af0ff", 3));
        orb.position.y = 5.2;
        p.add(orb);
      }
      const beam = new Mesh(new CylinderGeometry(0.22, 0.22, 1, 8, 1, true), this.glow("#8ff4ff", 4));
      beam.name = "beam";
      g.add(beam);
      const beam2 = new Mesh(new CylinderGeometry(0.6, 0.6, 1, 8, 1, true), new MeshBasicMaterial({ color: new Color("#36f3ff").multiplyScalar(1.5), transparent: true, opacity: 0.35, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
      beam2.name = "beam2";
      g.add(beam2);
    } else if (kind === "meteor") {
      const rock = new Mesh(this.rockGeo, this.rockMat);
      rock.scale.setScalar(2.2);
      g.add(rock);
      const fire = new Mesh(new SphereGeometry(2.8, 16, 12), new MeshBasicMaterial({ color: new Color("#ff6a1a").multiplyScalar(2.5), transparent: true, opacity: 0.7, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
      g.add(fire);
      const tail = new Mesh(new ConeGeometry(2.4, 16, 16, 1, true), new MeshBasicMaterial({ color: new Color("#ffb347").multiplyScalar(2), transparent: true, opacity: 0.45, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
      tail.position.y = 9;
      g.add(tail);
    }
    return g;
  }

  private addShip(r: Racer): void {
    const model = buildShip(r.design, r.livery, this.quality.level);
    model.root.traverse((o) => {
      if ((o as Mesh).isMesh) (o as Mesh).castShadow = this.quality.shadows > 0;
    });
    this.scene.add(model.root);
    const trail = new Trail(this.quality.level === "low" ? 14 : 24, new Color(r.livery.glow));
    this.scene.add(trail.mesh);
    const drone = this.buildDrone();
    drone.visible = false;
    this.scene.add(drone);
    this.ships.set(r.idx, { racer: r, model, key: `${r.designIndex}:${r.liveryIndex}`, trail, drone });
  }

  private buildDrone(): Group {
    const g = new Group();
    const bodyMat = new MeshStandardMaterial({ color: "#f2f4f8", metalness: 0.4, roughness: 0.35 });
    const body = new Mesh(new SphereGeometry(0.9, 16, 12), bodyMat);
    body.scale.y = 0.55;
    g.add(body);
    for (const [x, z] of [
      [1.3, 1.3],
      [-1.3, 1.3],
      [1.3, -1.3],
      [-1.3, -1.3],
    ] as const) {
      const rotor = new Mesh(new TorusGeometry(0.55, 0.08, 6, 20), this.glow("#6fd6ff", 2));
      rotor.rotation.x = Math.PI / 2;
      rotor.position.set(x, 0.1, z);
      g.add(rotor);
    }
    const beam = new Mesh(
      new ConeGeometry(2.2, 6, 20, 1, true),
      new MeshBasicMaterial({ color: new Color("#6fd6ff").multiplyScalar(1.5), transparent: true, opacity: 0.25, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false }),
    );
    beam.position.y = -3;
    g.add(beam);
    return g;
  }

  private removeShip(view: ShipView): void {
    this.scene.remove(view.model.root, view.trail.mesh, view.drone);
    view.model.dispose();
    view.trail.dispose();
    view.drone.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        const mat = m.material as MeshBasicMaterial;
        if (![...this.glowMats.values()].includes(mat)) mat.dispose();
      }
    });
  }

  private disposeTrack(): void {
    if (this.env) {
      this.scene.remove(this.env.group);
      this.env.dispose();
      this.env = null;
    }
    if (this.trackView) {
      this.scene.remove(this.trackView.group);
      this.trackView.dispose();
      this.trackView = null;
    }
    this.scene.remove(this.pickupGroup);
    this.coinMesh?.dispose();
    this.coinMesh = null;
    for (const v of this.hazardViews) {
      this.scene.remove(v);
      v.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh && m.geometry !== this.rockGeo) m.geometry.dispose();
      });
    }
    this.hazardViews = [];
    for (const m of this.meteorMarks) {
      this.scene.remove(m);
      m.geometry.dispose();
      (m.material as MeshBasicMaterial).dispose();
    }
    this.meteorMarks = [];
    for (const [id, pv] of this.projectileViews) {
      this.scene.remove(pv.mesh);
      this.projectileViews.delete(id);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Frame                                                            */
  /* ---------------------------------------------------------------- */

  frame(dt: number): void {
    const rt = this.rt;
    this.time += dt;
    if (rt.raceSerial !== this.serial) {
      this.serial = rt.raceSerial;
      if (this.track !== rt.track || !this.env) this.rebuild();
      else {
        // Ships changed (a remote player's pick arrived).
        for (const r of rt.racers) {
          const view = this.ships.get(r.idx);
          if (view && view.key !== `${r.designIndex}:${r.liveryIndex}`) {
            this.removeShip(view);
            this.ships.delete(r.idx);
            this.addShip(r);
          }
        }
      }
    }
    const track = this.track!;
    this.updateShips(dt);
    this.updatePickups();
    this.updateHazards();
    this.updateProjectiles();
    this.handleFx();
    this.particles.update(dt);
    this.updateCamera(dt);
    this.updateSpeedLines(dt);
    this.env?.update(this.time, dt, this.camera);
    const focus = rt.focus.ship.pos;
    this.trackView?.update(this.time, focus, { phase: rt.phase, t: rt.phase === "race" ? rt.raceTime : rt.phaseTime, length: rt.phaseLength });

    // Sun + shadow box follow the focus ship.
    if (this.env) {
      this.sun.position.copy(focus).addScaledVector(this.env.sunDirection, 120);
      this.sun.target.position.copy(focus);
    }
    if (this.empLife > 0) {
      this.empLife -= dt;
      const k = 1 - this.empLife / 1.1;
      this.empRing.scale.setScalar(4 + k * 90);
      (this.empRing.material as MeshBasicMaterial).opacity = Math.max(0, 1 - k);
    } else (this.empRing.material as MeshBasicMaterial).opacity = 0;

    void track;
    this.renderer.toneMappingExposure = this.exposure;
    this.composer.render(dt);
  }

  private readonly m4 = new Matrix4();
  private readonly q = new Quaternion();
  private readonly v1 = new Vector3();
  private readonly v2 = new Vector3();
  private readonly v3 = new Vector3();
  private readonly c1 = new Color();

  private updateShips(dt: number): void {
    const rt = this.rt;
    const alpha = rt.alpha;
    const focusIdx = rt.focus.idx;
    for (const view of this.ships.values()) {
      const r = view.racer;
      const ship = r.ship;
      const model = view.model;
      const root = model.root;
      const f = ship.frame;
      const pos = this.v1.copy(r.prevPos).lerp(ship.pos, alpha);
      // Hover bob.
      const bob = ship.airborne ? 0 : Math.sin(this.time * 7 + r.idx) * 0.06;
      pos.addScaledVector(f.up, 0.35 + bob);
      root.position.copy(pos);
      const right = this.v2.crossVectors(ship.fwd, f.up).normalize();
      const back = this.v3.copy(ship.fwd).negate();
      this.m4.makeBasis(right, f.up, back);
      root.quaternion.setFromRotationMatrix(this.m4);
      // Body: lean, pitch in the air, spins and tricks.
      const pitch = ship.airborne ? Math.max(-0.35, Math.min(0.3, ship.vh * 0.02)) : 0;
      model.body.rotation.set(pitch, ship.spinAngle, -ship.lean - (ship.trick > 0 ? ship.trick * Math.PI * 2 : 0), "YXZ");
      const boosting = ship.boost > 0 || ship.state === "warp" ? 1 : 0;
      const throttle = r.isMe ? (r.finished ? 0.7 : rt.input.throttle) : ship.speed > 5 ? 0.9 : 0.2;
      model.setThrottle(Math.max(0.15, throttle), boosting, this.time);
      model.setDriftGlow(ship.driftDir !== 0 ? ship.driftTier : 0);
      model.setShield(ship.shield > 0, this.time);
      model.setGhost(ship.cloak > 0 ? (r.isMe ? 0.4 : 0.12) : 1);
      root.visible = ship.state !== "fall" || ship.h > -30;
      root.scale.setScalar(ship.shocked > 0 ? 0.6 : 1);

      // Tow drone.
      view.drone.visible = ship.state === "tow";
      if (view.drone.visible) {
        view.drone.position.copy(pos).addScaledVector(f.up, 5);
        view.drone.quaternion.copy(root.quaternion);
        view.drone.rotateY(this.time * 2);
      }

      // Light trail from the tail.
      const tail = this.v3.copy(pos).addScaledVector(ship.fwd, -1.7).addScaledVector(f.up, 0.2);
      const speed01 = Math.min(1.4, Math.max(0, ship.speed) / ship.tune.top);
      const trailColor = this.c1.set(ship.driftDir !== 0 && ship.driftTier > 0 ? DRIFT_SPARK[ship.driftTier]! : new Color(r.livery.glow));
      view.trail.update(tail, f.up, right, 0.22 + boosting * 0.2, (ship.cloak > 0 ? 0.05 : 1) * Math.min(1, speed01) * (0.12 + boosting * 0.6 + (ship.driftTier > 0 && ship.driftDir !== 0 ? 0.35 : 0)), trailColor);

      // Particles: exhaust, drift sparks, offroad dust.
      const nearCam = root.position.distanceToSquared(this.camera.position) < 120 * 120;
      if (!nearCam || this.reduced) continue;
      if (boosting || ship.speed > 10) {
        const flame = boosting ? new Color("#9fd8ff") : new Color(r.livery.glow);
        const rate = boosting ? 3 : 1;
        for (let k = 0; k < rate; k++) {
          const ex = model.exhausts[Math.floor(Math.random() * model.exhausts.length)] ?? new Vector3(0, 0.4, 1.5);
          const wp = ex.clone().applyMatrix4(root.matrixWorld);
          const vel = ship.fwd.clone().multiplyScalar(-(8 + Math.random() * 8) + ship.speed * 0.6).addScaledVector(f.up, Math.random() * 1.5);
          this.particles.emit(wp, vel, flame, boosting ? 1.3 : 0.7, 0.18 + Math.random() * 0.12, 3, -2);
        }
      }
      if (ship.driftDir !== 0 && !ship.airborne) {
        const col = DRIFT_SPARK[ship.driftTier]!;
        for (const side of [-1, 1]) {
          const wp = pos.clone().addScaledVector(ship.fwd, -1.3).addScaledVector(right, side * 1.0).addScaledVector(f.up, -0.2);
          for (let k = 0; k < (ship.driftTier > 0 ? 3 : 1); k++) {
            const vel = new Vector3((Math.random() - 0.5) * 6, 0, (Math.random() - 0.5) * 6)
              .addScaledVector(f.up, 2 + Math.random() * 5)
              .addScaledVector(ship.fwd, ship.speed * 0.7 - 6)
              .addScaledVector(right, side * 3);
            this.particles.emit(wp, vel, col, ship.driftTier > 0 ? 0.5 + ship.driftTier * 0.12 : 0.35, 0.25 + Math.random() * 0.2, 2);
          }
        }
      }
      if (ship.offroad && ship.speed > 12 && (rt.track.def.theme === "mars" || rt.track.def.theme === "luna")) {
        const dust = rt.track.def.theme === "mars" ? new Color("#6b3a22") : new Color("#4a4c52");
        const wp = pos.clone().addScaledVector(ship.fwd, -1.6);
        const vel = new Vector3((Math.random() - 0.5) * 4, 2 + Math.random() * 2, (Math.random() - 0.5) * 4).addScaledVector(ship.fwd, ship.speed * 0.4);
        this.particles.emit(wp, vel, dust, 2.2, 0.9, 1.5, 3);
      }
      if (r.idx === focusIdx && ship.state === "warp") {
        const wp = pos.clone().addScaledVector(ship.fwd, 3).add(new Vector3((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 5));
        this.particles.emit(wp, ship.fwd.clone().multiplyScalar(-60), new Color("#ff7ae0"), 0.8, 0.25, 0);
      }
      void dt;
    }
  }

  private updatePickups(): void {
    const rt = this.rt;
    const track = this.track!;
    this.boxMeshes.forEach((row, ri) => {
      row.forEach((m, k) => {
        const left = rt.boxes[ri]?.[k] ?? 0;
        const grow = left > 0 ? 0 : 1;
        m.visible = left <= 0 || left < 0.35;
        const scale = left > 0 ? Math.max(0, 1 - left / 0.35) * 0.001 : 1;
        m.scale.setScalar(Math.max(0.001, scale * grow + (1 - grow) * 0.001));
        m.rotation.set(this.time * 0.9 + k, this.time * 1.3 + ri, 0);
        (m.children[0] as Mesh).rotation.set(-this.time * 2, this.time * 1.7, 0);
      });
    });
    const coins = this.coinMesh;
    if (coins) {
      const f = this.fr;
      track.coins.forEach((c, k) => {
        const hidden = (rt.coins[k] ?? 0) > 0;
        frameAt(track, c.s, f);
        const d = c.d * f.halfWidth;
        this.v1.copy(f.pos).addScaledVector(f.right, d).addScaledVector(f.up, 1.2 + Math.sin(this.time * 3 + k) * 0.15);
        this.m4.makeBasis(f.right, f.up, this.v2.copy(f.fwd).negate());
        this.q.setFromRotationMatrix(this.m4);
        const spin = new Quaternion().setFromAxisAngle(UP, this.time * 3 + k * 0.4);
        const tilt = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);
        this.q.multiply(spin).multiply(tilt);
        this.m4.compose(this.v1, this.q, this.v2.setScalar(hidden ? 0.0001 : 1));
        coins.setMatrixAt(k, this.m4);
      });
      coins.instanceMatrix.needsUpdate = true;
    }
  }

  private updateHazards(): void {
    const rt = this.rt;
    const track = this.track!;
    const f = this.fr;
    rt.hazards.forEach((h, k) => {
      const view = this.hazardViews[k];
      const kind = track.hazards[k]?.item.kind;
      if (!view || !kind) return;
      frameAt(track, h.s, f);
      this.m4.makeBasis(f.right, f.up, this.v2.copy(f.fwd).negate());
      view.quaternion.setFromRotationMatrix(this.m4);
      if (kind === "asteroid") {
        view.position.copy(f.pos).addScaledVector(f.right, h.d).addScaledVector(f.up, h.h);
        view.children[0]!.rotation.set(this.time * 0.3, 0, h.angle);
        view.children[1]!.rotation.copy(view.children[0]!.rotation);
      } else if (kind === "dust") {
        view.position.copy(f.pos).addScaledVector(f.right, h.d);
        view.rotation.y += 0;
        view.children.forEach((c, i) => (c.rotation.y = this.time * (3 + i)));
        if (!this.reduced && Math.random() < 0.6) {
          const p = view.position.clone().add(new Vector3((Math.random() - 0.5) * 5, Math.random() * 10, (Math.random() - 0.5) * 5));
          this.particles.emit(p, new Vector3((Math.random() - 0.5) * 8, 3, (Math.random() - 0.5) * 8), new Color("#7a4326"), 3, 1.2, 1, 2);
        }
      } else if (kind === "arc") {
        view.position.copy(f.pos);
        const posts = view.children.filter((c) => c.userData.side !== undefined);
        const hw = f.halfWidth;
        posts.forEach((p) => {
          const side = p.userData.side as number;
          p.position.set(side === 0 ? 0 : side * (f.wallOffset + 0.8), 2.5, 0);
          p.visible = side !== 0;
        });
        const beam = view.getObjectByName("beam")!;
        const beam2 = view.getObjectByName("beam2")!;
        const live = h.radius > 0;
        const x0 = h.side * (f.wallOffset + 0.8);
        const x1 = h.side * 0.3;
        const len = Math.abs(x0 - x1);
        for (const b of [beam, beam2]) {
          b.visible = live || (h.warn > 0 && Math.sin(this.time * 40) > 0);
          b.position.set((x0 + x1) / 2, 1.4 + Math.sin(this.time * 30) * 0.15, 0);
          b.rotation.set(0, 0, Math.PI / 2);
          b.scale.set(live ? 1 + Math.random() * 0.4 : 0.4, len, live ? 1 : 0.4);
        }
        void hw;
      } else if (kind === "meteor") {
        const ground = this.v1.copy(f.pos).addScaledVector(f.right, h.d);
        view.position.copy(ground).addScaledVector(f.up, h.h + 1).addScaledVector(f.right, h.h * 0.3);
        view.visible = h.h > 0.5;
        view.children[0]!.rotation.set(this.time * 2, this.time, 0);
        const mark = this.meteorMarks[k]!;
        mark.position.copy(ground).addScaledVector(f.up, 0.15);
        mark.quaternion.copy(view.quaternion);
        mark.rotateX(-Math.PI / 2);
        const pulse = 0.5 + 0.5 * Math.sin(this.time * (6 + h.warn * 20));
        (mark.material as MeshBasicMaterial).opacity = h.warn > 0.25 ? h.warn * (0.4 + 0.6 * pulse) : 0;
        mark.scale.setScalar(1.2 - h.warn * 0.2);
        if (h.radius > 0 && !mark.userData.boomed) {
          mark.userData.boomed = true;
          this.burst(ground.clone().addScaledVector(f.up, 1), new Color("#ff7a2a"), 40, 22, 2.4);
          this.burst(ground.clone().addScaledVector(f.up, 1), new Color("#ffe0a0"), 20, 12, 1.4);
          const d = ground.distanceTo(this.camera.position);
          if (d < 60) this.shake = Math.max(this.shake, 0.6 * (1 - d / 60));
        }
        if (h.radius <= 0) mark.userData.boomed = false;
      }
    });
  }

  private updateProjectiles(): void {
    const rt = this.rt;
    const track = this.track!;
    const live = new Set<string>();
    const f = this.fr;
    for (const p of rt.projectiles) {
      live.add(p.id);
      let view = this.projectileViews.get(p.id);
      if (!view) {
        view = { mesh: this.buildProjectile(p.kind), kind: p.kind };
        this.projectileViews.set(p.id, view);
        this.scene.add(view.mesh);
      }
      frameAt(track, p.s, f);
      view.mesh.position.copy(f.pos).addScaledVector(f.right, p.d).addScaledVector(f.up, p.h);
      this.m4.makeBasis(f.right, f.up, this.v2.copy(f.fwd).negate().multiplyScalar(Math.sign(p.vs) || 1));
      view.mesh.quaternion.setFromRotationMatrix(this.m4);
      if (p.kind === "mine") {
        view.mesh.rotation.y += 0.05;
        view.mesh.scale.setScalar(1 + Math.sin(this.time * 8) * 0.08);
      } else if (p.kind === "singularity") {
        const inner = view.mesh.children[1];
        if (inner) inner.rotation.z = this.time * 4;
        view.mesh.scale.setScalar(p.boom >= 0 ? 1 + p.boom * 9 : 1);
        view.mesh.lookAt(this.camera.position);
      } else if (!this.reduced) {
        this.particles.emit(view.mesh.position.clone(), new Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2), p.kind === "seeker" ? new Color("#ff8a3a") : new Color("#5affa0"), 0.9, 0.35, 1, -1);
      }
    }
    for (const [id, view] of this.projectileViews) {
      if (live.has(id)) continue;
      this.scene.remove(view.mesh);
      view.mesh.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
      this.projectileViews.delete(id);
    }
  }

  private buildProjectile(kind: string): Object3D {
    const g = new Group();
    if (kind === "seeker") {
      const body = new Mesh(new CylinderGeometry(0.28, 0.35, 1.8, 12), new MeshStandardMaterial({ color: "#e8e8ee", metalness: 0.7, roughness: 0.3 }));
      body.rotation.x = Math.PI / 2;
      g.add(body);
      const nose = new Mesh(new ConeGeometry(0.28, 0.7, 12), this.glow("#ff2a4a", 2));
      nose.rotation.x = -Math.PI / 2;
      nose.position.z = -1.2;
      g.add(nose);
      const flame = new Mesh(new ConeGeometry(0.3, 1.4, 10), this.glow("#ffb347", 3));
      flame.rotation.x = -Math.PI / 2;
      flame.position.z = 1.5;
      g.add(flame);
    } else if (kind === "bolt") {
      g.add(new Mesh(new SphereGeometry(0.75, 16, 12), this.glow("#5affa0", 2.5)));
      const ring = new Mesh(new TorusGeometry(1.1, 0.12, 8, 24), this.glow("#b6ffd9", 2));
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
    } else if (kind === "mine") {
      const core = new Mesh(new IcosahedronGeometry(0.9, 0), new MeshStandardMaterial({ color: "#3a3a44", metalness: 0.8, roughness: 0.35 }));
      g.add(core);
      for (let k = 0; k < 6; k++) {
        const spike = new Mesh(new ConeGeometry(0.2, 0.8, 6), this.glow("#ffe23d", 2.5));
        const dir = new Vector3(Math.sin(k * 1.05) * Math.cos(k * 2.1), Math.cos(k * 1.05), Math.sin(k * 1.05) * Math.sin(k * 2.1)).normalize();
        spike.position.copy(dir.clone().multiplyScalar(0.95));
        spike.quaternion.setFromUnitVectors(UP, dir);
        g.add(spike);
      }
      const halo = new Mesh(new RingGeometry(1.4, 1.8, 32), new MeshBasicMaterial({ color: new Color("#ffe23d").multiplyScalar(2), transparent: true, opacity: 0.5, side: DoubleSide, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
      halo.rotation.x = -Math.PI / 2;
      halo.position.y = -0.3;
      g.add(halo);
    } else {
      const hole = new Mesh(new SphereGeometry(1.4, 24, 16), new MeshBasicMaterial({ color: "#000000" }));
      g.add(hole);
      const disk = new Mesh(new RingGeometry(1.6, 3.6, 48), new MeshBasicMaterial({ color: new Color("#a066ff").multiplyScalar(2.5), transparent: true, opacity: 0.8, side: DoubleSide, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
      g.add(disk);
      const halo = new Mesh(new SphereGeometry(1.8, 24, 16), new MeshBasicMaterial({ color: new Color("#5a2aff").multiplyScalar(1.5), transparent: true, opacity: 0.3, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
      g.add(halo);
    }
    return g;
  }

  private burst(p: Vector3, color: Color, count: number, speed: number, size: number): void {
    if (this.reduced) count = Math.ceil(count / 3);
    for (let k = 0; k < count; k++) {
      const dir = new Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize();
      this.particles.emit(p, dir.multiplyScalar(speed * (0.3 + Math.random() * 0.7)), color, size * (0.6 + Math.random() * 0.8), 0.5 + Math.random() * 0.5, 2.2, size * 0.5);
    }
  }

  private handleFx(): void {
    const rt = this.rt;
    const focus = rt.focus;
    for (const e of rt.drainFx()) {
      switch (e.type) {
        case "boom":
          this.burst(e.pos, new Color("#ff8a2a"), e.big ? 70 : 30, e.big ? 26 : 16, e.big ? 3 : 1.8);
          this.burst(e.pos, new Color("#fff1b0"), e.big ? 30 : 12, e.big ? 16 : 10, 1.4);
          this.shakeNear(e.pos, e.big ? 0.9 : 0.4);
          break;
        case "sparks":
          for (let k = 0; k < 14 * e.strength + 4; k++) {
            const v = new Vector3((Math.random() - 0.5) * 10, Math.random() * 7, (Math.random() - 0.5) * 10);
            this.particles.emit(e.pos, v, new Color("#ffd27a"), 0.4, 0.3 + Math.random() * 0.2, 2);
          }
          if (this.isFocusPos(e.pos)) this.shake = Math.max(this.shake, e.strength * 0.5);
          break;
        case "box":
          this.burst(e.pos, new Color("#ff9ef0"), 16, 10, 1);
          this.burst(e.pos, new Color("#9ef4ff"), 16, 10, 1);
          break;
        case "coin":
          this.burst(e.pos, new Color("#ffd23f"), 12, 6, 0.8);
          break;
        case "turbo":
        case "pad": {
          const r = rt.racers[e.racer];
          if (!r) break;
          const tier = e.type === "turbo" ? e.tier : 2;
          this.burst(r.ship.pos.clone().addScaledVector(r.ship.fwd, -1.5), DRIFT_SPARK[Math.min(3, tier)]!, 20, 12, 1);
          if (r === focus) this.fovKick = 1;
          break;
        }
        case "land": {
          const r = rt.racers[e.racer];
          if (r && e.strength > 0.25) {
            this.burst(r.ship.pos, rt.track.def.theme === "mars" ? new Color("#7a4326") : new Color("#aab4d0"), 14, 8, 2);
            if (r === focus) this.shake = Math.max(this.shake, e.strength * 0.5);
          }
          break;
        }
        case "shieldPop": {
          const r = rt.racers[e.racer];
          if (r) this.burst(r.ship.pos, new Color("#72d8ff"), 30, 14, 1.2);
          break;
        }
        case "emp": {
          const r = rt.racers[e.from];
          if (r) {
            this.empRing.position.copy(r.ship.pos).addScaledVector(r.ship.frame.up, 1);
            this.empRing.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), r.ship.frame.up);
            this.empLife = 1.1;
          }
          break;
        }
        case "warp": {
          const r = rt.racers[e.racer];
          if (r) this.burst(r.ship.pos, new Color("#ff5ad1"), 40, 20, 1.4);
          if (r === focus) this.fovKick = 1.5;
          break;
        }
        case "hit": {
          const r = rt.racers[e.racer];
          if (r === focus) this.shake = Math.max(this.shake, 0.8);
          break;
        }
        case "finish": {
          const r = rt.racers[e.racer];
          if (r === focus) {
            for (let k = 0; k < 5; k++) {
              const p = r.ship.pos.clone().addScaledVector(r.ship.frame.up, 6 + Math.random() * 6).addScaledVector(r.ship.fwd, 10 + Math.random() * 10);
              const hue = new Color().setHSL(Math.random(), 1, 0.6);
              this.burst(p, hue, 40, 18, 1.2);
            }
          }
          break;
        }
        default:
          break;
      }
    }
  }

  private fovKick = 0;

  private isFocusPos(p: Vector3): boolean {
    return p.distanceToSquared(this.rt.focus.ship.pos) < 16;
  }

  private shakeNear(p: Vector3, amount: number): void {
    const d = p.distanceTo(this.rt.focus.ship.pos);
    if (d < 50) this.shake = Math.max(this.shake, amount * (1 - d / 50));
  }

  /* ---------------------------------------------------------------- */
  /* Camera                                                           */
  /* ---------------------------------------------------------------- */

  private updateCamera(dt: number): void {
    const rt = this.rt;
    const track = this.track!;
    const r = rt.focus;
    const ship = r.ship;
    const f = ship.frame;
    const pos = this.v1.copy(r.prevPos).lerp(ship.pos, rt.alpha).addScaledVector(f.up, 0.35);
    const speed01 = Math.min(1.5, Math.max(0, ship.speed) / Math.max(1, ship.tune.top));
    const boosting = ship.boost > 0 || ship.state === "warp";
    const k = (rate: number) => 1 - Math.exp(-rate * dt);

    // Where the chase camera wants to be.
    const travel = this.v2.copy(ship.fwd).lerp(ship.vdir, ship.driftDir !== 0 ? 0.55 : 0.25).normalize();
    if (!this.camInit) {
      this.camFwd.copy(travel);
      this.camUp.copy(f.up);
    }
    this.camFwd.lerp(travel, k(ship.state === "spin" ? 1.5 : 6)).normalize();
    this.camUp.lerp(f.up, k(4)).normalize();
    const dist = 7.4 + speed01 * 1.6 + (boosting ? 1.2 : 0);
    const height = 2.6 + speed01 * 0.4;
    const lookBack = rt.input.lookBack && rt.phase === "race";
    const chasePos = new Vector3().copy(pos).addScaledVector(this.camFwd, lookBack ? dist : -dist).addScaledVector(this.camUp, height);
    const chaseLook = new Vector3().copy(pos).addScaledVector(this.camFwd, lookBack ? -10 : 9).addScaledVector(this.camUp, 1.2);
    let targetPos = chasePos;
    let targetLook = chaseLook;
    let targetUp = this.camUp;
    let rate = 14;

    if (rt.phase === "intro") {
      // Sweep down the track toward the grid, then settle behind you.
      const p = rt.introProgress;
      const e = p * p * (3 - 2 * p);
      const s = ship.s + 260 * (1 - e) + 12;
      const fr = newFrame();
      frameAt(track, wrapS(s, track.length), fr);
      const side = Math.sin(p * Math.PI) * 18;
      const swoop = new Vector3().copy(fr.pos).addScaledVector(fr.right, side).addScaledVector(fr.up, 6 + 30 * (1 - e));
      const look = new Vector3().copy(pos).lerp(fr.pos, 0.5 * (1 - e));
      const blend = Math.max(0, (p - 0.7) / 0.3);
      targetPos = swoop.lerp(chasePos, blend * blend);
      targetLook = look.lerp(chaseLook, blend);
      targetUp = UP.clone().lerp(this.camUp, blend);
      rate = p < 0.05 ? 1000 : 10;
    } else if (rt.phase === "countdown") {
      rate = 10;
    } else if (rt.phase === "finished" || rt.phase === "results" || rt.phase === "podium") {
      const a = this.time * 0.35;
      const orbit = new Vector3(Math.cos(a) * 9, 0, Math.sin(a) * 9);
      targetPos = new Vector3().copy(pos).add(orbit.applyQuaternion(new Quaternion().setFromUnitVectors(UP, f.up))).addScaledVector(f.up, 3.2);
      targetLook = pos.clone().addScaledVector(f.up, 0.8);
      targetUp = f.up;
      rate = 3;
    }

    if (!this.camInit) {
      this.camPos.copy(targetPos);
      this.camLook.copy(targetLook);
      this.camInit = true;
    }
    this.camPos.lerp(targetPos, k(rate));
    this.camLook.lerp(targetLook, k(rate * 1.4));
    this.camera.position.copy(this.camPos);
    if (this.shake > 0.01 && !this.reduced) {
      const s = this.shake * 0.35;
      this.camera.position.add(new Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));
    }
    this.shake *= Math.exp(-6 * dt);
    this.camera.up.copy(targetUp);
    this.camera.lookAt(this.camLook);

    this.fovKick = Math.max(0, this.fovKick - dt * 1.6);
    const fovTarget = 64 + speed01 * 7 + (boosting ? 9 : 0) + this.fovKick * 5;
    this.fov += (fovTarget - this.fov) * k(4);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();

    // Boost chromatic fringe.
    const fringe = (boosting ? 0.0022 : 0) + this.fovKick * 0.0012 + rt.empFlash * 0.004;
    this.chroma.offset.set(fringe, fringe * 0.6);
  }

  private updateSpeedLines(dt: number): void {
    const rt = this.rt;
    const ship = rt.focus.ship;
    const speed01 = Math.max(0, ship.speed) / Math.max(1, ship.tune.top);
    const boosting = ship.boost > 0 || ship.state === "warp";
    const target = rt.phase === "race" ? Math.max(0, speed01 - 0.75) * 1.2 + (boosting ? 0.45 : 0) : 0;
    const mat = this.speedLines.material as MeshBasicMaterial;
    mat.opacity += (Math.min(0.3, target * 0.6) - mat.opacity) * (1 - Math.exp(-6 * dt));
    this.speedLines.visible = mat.opacity > 0.01 && !this.reduced;
    if (!this.speedLines.visible) return;
    const v = ship.speed * (boosting ? 1.6 : 1.1);
    this.speedLineData.forEach((l, i) => {
      l.z += v * dt;
      if (l.z > 2) l.z = -40 - Math.random() * 10;
      this.m4.makeScale(1, 1, l.len * (0.5 + speed01));
      this.m4.setPosition(l.x, l.y, l.z);
      this.speedLines.setMatrixAt(i, this.m4);
    });
    this.speedLines.instanceMatrix.needsUpdate = true;
  }

  /** Screen positions for name tags over other racers. */
  tags(): { idx: number; x: number; y: number; visible: boolean; dist: number }[] {
    const out: { idx: number; x: number; y: number; visible: boolean; dist: number }[] = [];
    const focus = this.rt.focus;
    for (const view of this.ships.values()) {
      const r = view.racer;
      if (r === focus) continue;
      const p = view.model.root.position.clone().addScaledVector(r.ship.frame.up, 2.6);
      const dist = p.distanceTo(this.camera.position);
      const ndc = p.clone().project(this.camera);
      const visible = ndc.z < 1 && dist < 90 && Math.abs(ndc.x) < 1.1 && Math.abs(ndc.y) < 1.1 && r.ship.cloak <= 0 && this.rt.phase !== "intro";
      out.push({ idx: r.idx, x: ((ndc.x + 1) / 2) * this.width, y: ((1 - ndc.y) / 2) * this.height, visible, dist });
    }
    return out;
  }

  dispose(): void {
    this.disposeTrack();
    for (const view of this.ships.values()) this.removeShip(view);
    this.ships.clear();
    this.particles.dispose();
    for (const s of this.shared) s.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}

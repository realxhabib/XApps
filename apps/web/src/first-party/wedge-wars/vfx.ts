/**
 * Pooled, instanced particles and decals. Every effect in the match —
 * sparks, flames, smoke, debris, scorch marks, tire marks — is one draw call
 * per kind, backed by fixed-size typed arrays (no per-frame allocation).
 *
 * Sparks are velocity-aligned HDR streaks (they bloom); fire/glow and smoke
 * are camera-facing sprites with a tiny custom shader (per-instance alpha +
 * rotation); debris are lit metal chunks that bounce; decals lie on the floor.
 */

import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  Euler,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  type Texture,
} from "three";
import { scorch as scorchTex, smokePuff, softDot } from "./textures";

const SPRITE_VERT = /* glsl */ `
attribute vec2 aParams;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vUv = uv;
  vAlpha = aParams.x;
  #ifdef USE_INSTANCING_COLOR
    vColor = instanceColor;
  #else
    vColor = vec3(1.0);
  #endif
  vec3 center = vec3(instanceMatrix[3]);
  float size = length(vec3(instanceMatrix[0]));
  vec4 mv = modelViewMatrix * vec4(center, 1.0);
  float c = cos(aParams.y);
  float s = sin(aParams.y);
  mv.xy += vec2(position.x * c - position.y * s, position.x * s + position.y * c) * size;
  gl_Position = projectionMatrix * mv;
}
`;

const SPRITE_FRAG = /* glsl */ `
uniform sampler2D map;
uniform float intensity;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 t = texture2D(map, vUv);
  float a = t.a * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * intensity, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function spriteMaterial(map: Texture, additive: boolean, intensity: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { map: { value: map }, intensity: { value: intensity } },
    vertexShader: SPRITE_VERT,
    fragmentShader: SPRITE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: additive ? AdditiveBlending : NormalBlending,
  });
}

/** Struct-of-arrays particle pool. */
class Pool {
  readonly n: number;
  count = 0;
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly pz: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vz: Float32Array;
  readonly life: Float32Array;
  readonly max: Float32Array;
  readonly size: Float32Array;
  readonly grow: Float32Array;
  readonly rot: Float32Array;
  readonly spin: Float32Array;
  readonly r: Float32Array;
  readonly g: Float32Array;
  readonly b: Float32Array;
  readonly kind: Uint8Array;
  constructor(n: number) {
    this.n = n;
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.vz = new Float32Array(n);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n);
    this.size = new Float32Array(n);
    this.grow = new Float32Array(n);
    this.rot = new Float32Array(n);
    this.spin = new Float32Array(n);
    this.r = new Float32Array(n);
    this.g = new Float32Array(n);
    this.b = new Float32Array(n);
    this.kind = new Uint8Array(n);
  }
  /** Index for a new particle (recycles the oldest slot when full). */
  spawn(): number {
    if (this.count < this.n) return this.count++;
    // Full: overwrite the one closest to death.
    let best = 0;
    let bestLeft = Infinity;
    for (let i = 0; i < this.n; i += 7) {
      const left = this.max[i]! - this.life[i]!;
      if (left < bestLeft) {
        bestLeft = left;
        best = i;
      }
    }
    return best;
  }
  kill(i: number): void {
    const last = --this.count;
    if (i === last) return;
    this.px[i] = this.px[last]!;
    this.py[i] = this.py[last]!;
    this.pz[i] = this.pz[last]!;
    this.vx[i] = this.vx[last]!;
    this.vy[i] = this.vy[last]!;
    this.vz[i] = this.vz[last]!;
    this.life[i] = this.life[last]!;
    this.max[i] = this.max[last]!;
    this.size[i] = this.size[last]!;
    this.grow[i] = this.grow[last]!;
    this.rot[i] = this.rot[last]!;
    this.spin[i] = this.spin[last]!;
    this.r[i] = this.r[last]!;
    this.g[i] = this.g[last]!;
    this.b[i] = this.b[last]!;
    this.kind[i] = this.kind[last]!;
  }
}

const FIRE_HOT = new Color(1.0, 0.62, 0.16);
const FIRE_MID = new Color(1.0, 0.26, 0.03);
const FIRE_END = new Color(0.32, 0.04, 0.01);
const _c = new Color();
const _m = new Matrix4();
const _dir = new Vector3();
const _x = new Vector3();
const _y = new Vector3();
const UP = new Vector3(0, 1, 0);

export interface VfxOptions {
  scale: number;
}

export class Vfx {
  readonly sparkMesh: InstancedMesh;
  readonly fireMesh: InstancedMesh;
  readonly smokeMesh: InstancedMesh;
  readonly debrisMesh: InstancedMesh;
  readonly scorchMesh: InstancedMesh;
  readonly skidMesh: InstancedMesh;
  private readonly sparks: Pool;
  private readonly fire: Pool;
  private readonly smoke: Pool;
  private readonly debris: Pool;
  private readonly fireParams: InstancedBufferAttribute;
  private readonly smokeParams: InstancedBufferAttribute;
  private scorchNext = 0;
  private skidNext = 0;
  private readonly scale: number;
  private readonly debrisRot: Float32Array;

  constructor(options: VfxOptions) {
    const s = (this.scale = Math.max(0.3, options.scale));
    this.sparks = new Pool(Math.round(600 * s));
    this.fire = new Pool(Math.round(700 * s));
    this.smoke = new Pool(Math.round(420 * s));
    this.debris = new Pool(90);
    this.debrisRot = new Float32Array(90 * 3);

    this.sparkMesh = new InstancedMesh(
      new BoxGeometry(1, 1, 1),
      new MeshBasicMaterial({ color: new Color(1, 0.5, 0.14).multiplyScalar(5.5), blending: AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }),
      this.sparks.n,
    );
    this.sparkMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.sparkMesh.frustumCulled = false;
    this.sparkMesh.count = 0;

    const quad = new PlaneGeometry(1, 1);
    this.fireParams = new InstancedBufferAttribute(new Float32Array(this.fire.n * 2), 2).setUsage(DynamicDrawUsage);
    const fireGeo = quad.clone();
    fireGeo.setAttribute("aParams", this.fireParams);
    this.fireMesh = new InstancedMesh(fireGeo, spriteMaterial(softDot(), true, 1.6), this.fire.n);
    this.fireMesh.instanceColor = new InstancedBufferAttribute(new Float32Array(this.fire.n * 3), 3).setUsage(DynamicDrawUsage);
    this.fireMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.fireMesh.frustumCulled = false;
    this.fireMesh.count = 0;
    this.fireMesh.renderOrder = 5;

    this.smokeParams = new InstancedBufferAttribute(new Float32Array(this.smoke.n * 2), 2).setUsage(DynamicDrawUsage);
    const smokeGeo = quad.clone();
    smokeGeo.setAttribute("aParams", this.smokeParams);
    this.smokeMesh = new InstancedMesh(smokeGeo, spriteMaterial(smokePuff(), false, 1), this.smoke.n);
    this.smokeMesh.instanceColor = new InstancedBufferAttribute(new Float32Array(this.smoke.n * 3), 3).setUsage(DynamicDrawUsage);
    this.smokeMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.smokeMesh.frustumCulled = false;
    this.smokeMesh.count = 0;
    this.smokeMesh.renderOrder = 4;

    this.debrisMesh = new InstancedMesh(
      new BoxGeometry(1, 1, 1),
      new MeshStandardMaterial({ color: "#ffffff", metalness: 0.85, roughness: 0.4 }),
      this.debris.n,
    );
    this.debrisMesh.instanceColor = new InstancedBufferAttribute(new Float32Array(this.debris.n * 3), 3).setUsage(DynamicDrawUsage);
    this.debrisMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.debrisMesh.castShadow = true;
    this.debrisMesh.frustumCulled = false;
    this.debrisMesh.count = 0;

    const flat = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.scorchMesh = new InstancedMesh(
      flat,
      new MeshBasicMaterial({ color: "#050505", alphaMap: scorchTex(), transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }),
      64,
    );
    this.scorchMesh.count = 0;
    this.scorchMesh.frustumCulled = false;
    this.scorchMesh.renderOrder = 1;
    this.skidMesh = new InstancedMesh(
      flat.clone(),
      new MeshBasicMaterial({ color: "#060607", transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }),
      900,
    );
    this.skidMesh.count = 0;
    this.skidMesh.frustumCulled = false;
    this.skidMesh.renderOrder = 1;
  }

  get objects() {
    return [this.skidMesh, this.scorchMesh, this.debrisMesh, this.sparkMesh, this.smokeMesh, this.fireMesh];
  }

  /* Emitters ------------------------------------------------------------- */

  /** A burst of sparks around normal (nx, ny, nz); power ~0.3 (scrape) .. 2 (KO). */
  sparksAt(x: number, y: number, z: number, nx: number, ny: number, nz: number, power: number): void {
    const n = Math.round((10 + power * 26) * this.scale);
    const p = this.sparks;
    for (let k = 0; k < n; k++) {
      const i = p.spawn();
      const sp = (3 + Math.random() * 11) * (0.6 + power * 0.5);
      let dx = nx + (Math.random() - 0.5) * 1.6;
      let dy = ny + Math.random() * 0.9;
      let dz = nz + (Math.random() - 0.5) * 1.6;
      const len = Math.hypot(dx, dy, dz) || 1;
      dx /= len;
      dy /= len;
      dz /= len;
      p.px[i] = x;
      p.py[i] = y;
      p.pz[i] = z;
      p.vx[i] = dx * sp;
      p.vy[i] = dy * sp;
      p.vz[i] = dz * sp;
      p.life[i] = 0;
      p.max[i] = 0.25 + Math.random() * 0.45;
      p.size[i] = 0.011 + Math.random() * 0.014;
    }
    // Flash.
    this.glow(x, y, z, 0.9 + power * 0.9, 0.09, 1, 0.8, 0.5);
    if (power > 0.6) this.smokeAt(x, y, z, 2, 0.5);
  }

  /** A short-lived additive glow sprite. */
  glow(x: number, y: number, z: number, size: number, life: number, r: number, g: number, b: number): void {
    const p = this.fire;
    const i = p.spawn();
    p.px[i] = x;
    p.py[i] = y;
    p.pz[i] = z;
    p.vx[i] = p.vy[i] = p.vz[i] = 0;
    p.life[i] = 0;
    p.max[i] = life;
    p.size[i] = size;
    p.grow[i] = 0.5;
    p.rot[i] = Math.random() * 6.28;
    p.spin[i] = 0;
    p.r[i] = r;
    p.g[i] = g;
    p.b[i] = b;
    p.kind[i] = 1;
  }

  /** Flame puffs from a nozzle along (dx, dy, dz) (with the truck's velocity added). */
  flame(x: number, y: number, z: number, dx: number, dy: number, dz: number, vx: number, vy: number, vz: number, count = 2): void {
    const p = this.fire;
    for (let k = 0; k < count; k++) {
      const i = p.spawn();
      const sp = 11 + Math.random() * 5;
      p.px[i] = x + dx * Math.random() * 0.3;
      p.py[i] = y + dy * Math.random() * 0.3;
      p.pz[i] = z + dz * Math.random() * 0.3;
      p.vx[i] = dx * sp + (Math.random() - 0.5) * 2.4 + vx;
      p.vy[i] = dy * sp + (Math.random() - 0.3) * 1.6 + vy;
      p.vz[i] = dz * sp + (Math.random() - 0.5) * 2.4 + vz;
      p.life[i] = 0;
      p.max[i] = 0.3 + Math.random() * 0.18;
      p.size[i] = 0.12 + Math.random() * 0.06;
      p.grow[i] = 3.2;
      p.rot[i] = Math.random() * 6.28;
      p.spin[i] = (Math.random() - 0.5) * 6;
      p.kind[i] = 0;
    }
  }

  /** Vent / burning / exhaust fire: rising flame puffs. */
  fireColumn(x: number, y: number, z: number, spread: number, up: number, count = 2, size = 0.4): void {
    const p = this.fire;
    for (let k = 0; k < count; k++) {
      const i = p.spawn();
      p.px[i] = x + (Math.random() - 0.5) * spread;
      p.py[i] = y;
      p.pz[i] = z + (Math.random() - 0.5) * spread;
      p.vx[i] = (Math.random() - 0.5) * 1.2;
      p.vy[i] = up * (0.6 + Math.random() * 0.6);
      p.vz[i] = (Math.random() - 0.5) * 1.2;
      p.life[i] = 0;
      p.max[i] = 0.4 + Math.random() * 0.3;
      p.size[i] = size;
      p.grow[i] = 1.6;
      p.rot[i] = Math.random() * 6.28;
      p.spin[i] = (Math.random() - 0.5) * 3;
      p.kind[i] = 0;
    }
  }

  /** Smoke puffs; `dark` 0 (grey dust) .. 1 (black oil smoke). */
  smokeAt(x: number, y: number, z: number, count: number, dark: number, rise = 1.2, size = 0.6): void {
    const p = this.smoke;
    const n = Math.max(1, Math.round(count * this.scale));
    for (let k = 0; k < n; k++) {
      const i = p.spawn();
      p.px[i] = x + (Math.random() - 0.5) * 0.4;
      p.py[i] = y;
      p.pz[i] = z + (Math.random() - 0.5) * 0.4;
      p.vx[i] = (Math.random() - 0.5) * 0.8;
      p.vy[i] = rise * (0.5 + Math.random() * 0.8);
      p.vz[i] = (Math.random() - 0.5) * 0.8;
      p.life[i] = 0;
      p.max[i] = 1.2 + Math.random() * 1.4;
      p.size[i] = size * (0.7 + Math.random() * 0.6);
      p.grow[i] = 1.4;
      p.rot[i] = Math.random() * 6.28;
      p.spin[i] = (Math.random() - 0.5) * 0.8;
      const v = 0.42 - dark * 0.36;
      p.r[i] = v;
      p.g[i] = v * 0.98;
      p.b[i] = v * 0.95;
      p.kind[i] = 0;
    }
  }

  /** Dust kicked up at floor level (tires, landings). */
  dust(x: number, z: number, amount: number): void {
    this.smokeAt(x, 0.15, z, amount, 0, 0.6, 0.5);
  }

  debrisAt(x: number, y: number, z: number, power: number, color: string): void {
    const p = this.debris;
    const i = p.spawn();
    const a = Math.random() * Math.PI * 2;
    const sp = 2 + Math.random() * 5 * power;
    p.px[i] = x;
    p.py[i] = y;
    p.pz[i] = z;
    p.vx[i] = Math.cos(a) * sp;
    p.vy[i] = 3 + Math.random() * 5 * power;
    p.vz[i] = Math.sin(a) * sp;
    p.life[i] = 0;
    p.max[i] = 4 + Math.random() * 2;
    p.size[i] = 0.08 + Math.random() * 0.18;
    p.grow[i] = 0.3 + Math.random() * 0.7; // aspect
    p.rot[i] = Math.random() * 6;
    p.spin[i] = (Math.random() - 0.5) * 14;
    _c.set(color);
    p.r[i] = _c.r;
    p.g[i] = _c.g;
    p.b[i] = _c.b;
    this.debrisRot[i * 3] = Math.random() * 6;
    this.debrisRot[i * 3 + 1] = Math.random() * 6;
    this.debrisRot[i * 3 + 2] = Math.random() * 6;
  }

  explosion(x: number, y: number, z: number): void {
    for (let k = 0; k < 14; k++) this.fireColumn(x, y, z, 1.2, 4, 1, 0.9);
    this.glow(x, y + 0.3, z, 5, 0.25, 1, 0.7, 0.35);
    this.smokeAt(x, y + 0.3, z, 14, 0.9, 2.2, 1.1);
    this.sparksAt(x, y, z, 0, 1, 0, 2);
    this.scorchAt(x, z, 3.4);
  }

  scorchAt(x: number, z: number, size: number): void {
    const i = this.scorchNext++ % this.scorchMesh.instanceMatrix.count;
    _m.makeRotationY(Math.random() * 6.28);
    _m.scale(_x.set(size, 1, size));
    _m.setPosition(x, 0.012 + (i % 8) * 0.0005, z);
    this.scorchMesh.setMatrixAt(i, _m);
    this.scorchMesh.count = Math.min(this.scorchMesh.instanceMatrix.count, Math.max(this.scorchMesh.count, i + 1));
    this.scorchMesh.instanceMatrix.needsUpdate = true;
  }

  /** One tire-mark quad under a wheel. */
  skid(x: number, z: number, yaw: number, length: number): void {
    const cap = this.skidMesh.instanceMatrix.count;
    const i = this.skidNext++ % cap;
    _m.makeRotationY(yaw);
    _m.scale(_x.set(0.28, 1, Math.max(0.05, length)));
    _m.setPosition(x, 0.01 + (i % 16) * 0.0002, z);
    this.skidMesh.setMatrixAt(i, _m);
    this.skidMesh.count = Math.min(cap, Math.max(this.skidMesh.count, i + 1));
    this.skidMesh.instanceMatrix.needsUpdate = true;
  }

  /* Simulation ------------------------------------------------------------ */

  update(dt: number): void {
    this.updateSparks(dt);
    this.updateFire(dt);
    this.updateSmoke(dt);
    this.updateDebris(dt);
  }

  private updateSparks(dt: number): void {
    const p = this.sparks;
    const arr = this.sparkMesh.instanceMatrix.array as Float32Array;
    for (let i = 0; i < p.count; ) {
      p.life[i]! += dt;
      if (p.life[i]! >= p.max[i]!) {
        p.kill(i);
        continue;
      }
      p.vy[i]! -= 16 * dt;
      p.px[i]! += p.vx[i]! * dt;
      p.py[i]! += p.vy[i]! * dt;
      p.pz[i]! += p.vz[i]! * dt;
      if (p.py[i]! < 0.02 && p.vy[i]! < 0) {
        p.py[i] = 0.02;
        p.vy[i] = -p.vy[i]! * 0.35;
        p.vx[i]! *= 0.6;
        p.vz[i]! *= 0.6;
      }
      i++;
    }
    for (let i = 0; i < p.count; i++) {
      const speed = Math.hypot(p.vx[i]!, p.vy[i]!, p.vz[i]!) || 1;
      _dir.set(p.vx[i]! / speed, p.vy[i]! / speed, p.vz[i]! / speed);
      _x.crossVectors(_dir, Math.abs(_dir.y) > 0.95 ? _y.set(1, 0, 0) : UP).normalize();
      _y.crossVectors(_x, _dir);
      const fade = 1 - p.life[i]! / p.max[i]!;
      const w = p.size[i]! * (0.4 + fade * 0.6);
      const len = Math.min(0.42, speed * 0.022) * fade + 0.02;
      const o = i * 16;
      arr[o] = _x.x * w;
      arr[o + 1] = _x.y * w;
      arr[o + 2] = _x.z * w;
      arr[o + 3] = 0;
      arr[o + 4] = _y.x * w;
      arr[o + 5] = _y.y * w;
      arr[o + 6] = _y.z * w;
      arr[o + 7] = 0;
      arr[o + 8] = _dir.x * len;
      arr[o + 9] = _dir.y * len;
      arr[o + 10] = _dir.z * len;
      arr[o + 11] = 0;
      arr[o + 12] = p.px[i]!;
      arr[o + 13] = p.py[i]!;
      arr[o + 14] = p.pz[i]!;
      arr[o + 15] = 1;
    }
    this.sparkMesh.count = p.count;
    this.sparkMesh.instanceMatrix.needsUpdate = true;
  }

  private writeSprite(arr: Float32Array, i: number, x: number, y: number, z: number, size: number): void {
    const o = i * 16;
    arr[o] = size;
    arr[o + 1] = 0;
    arr[o + 2] = 0;
    arr[o + 3] = 0;
    arr[o + 4] = 0;
    arr[o + 5] = size;
    arr[o + 6] = 0;
    arr[o + 7] = 0;
    arr[o + 8] = 0;
    arr[o + 9] = 0;
    arr[o + 10] = size;
    arr[o + 11] = 0;
    arr[o + 12] = x;
    arr[o + 13] = y;
    arr[o + 14] = z;
    arr[o + 15] = 1;
  }

  private updateFire(dt: number): void {
    const p = this.fire;
    for (let i = 0; i < p.count; ) {
      p.life[i]! += dt;
      if (p.life[i]! >= p.max[i]!) {
        p.kill(i);
        continue;
      }
      const drag = Math.exp(-2.2 * dt);
      p.vx[i]! *= drag;
      p.vz[i]! *= drag;
      p.vy[i] = p.vy[i]! * drag + 3.2 * dt;
      p.px[i]! += p.vx[i]! * dt;
      p.py[i]! += p.vy[i]! * dt;
      p.pz[i]! += p.vz[i]! * dt;
      if (p.py[i]! < 0.05) {
        p.py[i] = 0.05;
        p.vy[i] = Math.abs(p.vy[i]!) * 0.2;
      }
      p.rot[i]! += p.spin[i]! * dt;
      i++;
    }
    const arr = this.fireMesh.instanceMatrix.array as Float32Array;
    const col = this.fireMesh.instanceColor!.array as Float32Array;
    const par = this.fireParams.array as Float32Array;
    for (let i = 0; i < p.count; i++) {
      const t = p.life[i]! / p.max[i]!;
      const size = p.size[i]! * (1 + t * p.grow[i]!);
      this.writeSprite(arr, i, p.px[i]!, p.py[i]!, p.pz[i]!, size);
      if (p.kind[i] === 1) {
        col[i * 3] = p.r[i]!;
        col[i * 3 + 1] = p.g[i]!;
        col[i * 3 + 2] = p.b[i]!;
        par[i * 2] = 1 - t;
      } else {
        if (t < 0.35) _c.copy(FIRE_HOT).lerp(FIRE_MID, t / 0.35);
        else _c.copy(FIRE_MID).lerp(FIRE_END, (t - 0.35) / 0.65);
        col[i * 3] = _c.r;
        col[i * 3 + 1] = _c.g;
        col[i * 3 + 2] = _c.b;
        par[i * 2] = (1 - t) * (1 - t) * Math.min(1, t * 14) * 0.85;
      }
      par[i * 2 + 1] = p.rot[i]!;
    }
    this.fireMesh.count = p.count;
    this.fireMesh.instanceMatrix.needsUpdate = true;
    this.fireMesh.instanceColor!.needsUpdate = true;
    this.fireParams.needsUpdate = true;
  }

  private updateSmoke(dt: number): void {
    const p = this.smoke;
    for (let i = 0; i < p.count; ) {
      p.life[i]! += dt;
      if (p.life[i]! >= p.max[i]!) {
        p.kill(i);
        continue;
      }
      const drag = Math.exp(-1.2 * dt);
      p.vx[i]! *= drag;
      p.vz[i]! *= drag;
      p.vy[i]! *= Math.exp(-0.6 * dt);
      p.px[i]! += p.vx[i]! * dt;
      p.py[i]! += p.vy[i]! * dt;
      p.pz[i]! += p.vz[i]! * dt;
      p.rot[i]! += p.spin[i]! * dt;
      i++;
    }
    const arr = this.smokeMesh.instanceMatrix.array as Float32Array;
    const col = this.smokeMesh.instanceColor!.array as Float32Array;
    const par = this.smokeParams.array as Float32Array;
    for (let i = 0; i < p.count; i++) {
      const t = p.life[i]! / p.max[i]!;
      this.writeSprite(arr, i, p.px[i]!, p.py[i]!, p.pz[i]!, p.size[i]! * (1 + t * p.grow[i]!));
      col[i * 3] = p.r[i]!;
      col[i * 3 + 1] = p.g[i]!;
      col[i * 3 + 2] = p.b[i]!;
      par[i * 2] = (1 - t) * Math.min(1, t * 5) * 0.75;
      par[i * 2 + 1] = p.rot[i]!;
    }
    this.smokeMesh.count = p.count;
    this.smokeMesh.instanceMatrix.needsUpdate = true;
    this.smokeMesh.instanceColor!.needsUpdate = true;
    this.smokeParams.needsUpdate = true;
  }

  private updateDebris(dt: number): void {
    const p = this.debris;
    for (let i = 0; i < p.count; ) {
      p.life[i]! += dt;
      if (p.life[i]! >= p.max[i]!) {
        // keep rotation data in step with the swap-remove
        const last = p.count - 1;
        this.debrisRot[i * 3] = this.debrisRot[last * 3]!;
        this.debrisRot[i * 3 + 1] = this.debrisRot[last * 3 + 1]!;
        this.debrisRot[i * 3 + 2] = this.debrisRot[last * 3 + 2]!;
        p.kill(i);
        continue;
      }
      p.vy[i]! -= 18 * dt;
      p.px[i]! += p.vx[i]! * dt;
      p.py[i]! += p.vy[i]! * dt;
      p.pz[i]! += p.vz[i]! * dt;
      const floor = p.size[i]! * 0.3;
      if (p.py[i]! < floor) {
        p.py[i] = floor;
        if (p.vy[i]! < -1.5) {
          p.vy[i] = -p.vy[i]! * 0.35;
          p.spin[i]! *= 0.6;
        } else {
          p.vy[i] = 0;
          p.spin[i]! *= Math.exp(-6 * dt);
        }
        const f = Math.exp(-4 * dt);
        p.vx[i]! *= f;
        p.vz[i]! *= f;
      }
      this.debrisRot[i * 3]! += p.spin[i]! * dt;
      this.debrisRot[i * 3 + 2]! += p.spin[i]! * 0.7 * dt;
      i++;
    }
    const col = this.debrisMesh.instanceColor!.array as Float32Array;
    for (let i = 0; i < p.count; i++) {
      const t = p.life[i]! / p.max[i]!;
      const shrink = t > 0.85 ? 1 - (t - 0.85) / 0.15 : 1;
      const s = p.size[i]! * shrink;
      _m.makeRotationFromEuler(_euler.set(this.debrisRot[i * 3]!, this.debrisRot[i * 3 + 1]!, this.debrisRot[i * 3 + 2]!));
      _m.scale(_x.set(s, s * 0.25, s * p.grow[i]!));
      _m.setPosition(p.px[i]!, p.py[i]!, p.pz[i]!);
      this.debrisMesh.setMatrixAt(i, _m);
      col[i * 3] = p.r[i]!;
      col[i * 3 + 1] = p.g[i]!;
      col[i * 3 + 2] = p.b[i]!;
    }
    this.debrisMesh.count = p.count;
    this.debrisMesh.instanceMatrix.needsUpdate = true;
    this.debrisMesh.instanceColor!.needsUpdate = true;
  }

  dispose(): void {
    for (const m of this.objects) {
      m.geometry.dispose();
      (m.material as { dispose(): void }).dispose();
    }
  }
}

const _euler = new Euler();

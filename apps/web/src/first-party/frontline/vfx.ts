/**
 * Pooled effects in a few draw calls: tracers (camera-facing streaks that
 * fly along the bullet path), sparks (additive points with gravity), dust
 * and blood puffs (alpha points), and bullet-hole decals (an instanced quad
 * ring buffer aligned to the surface normal).
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  NormalBlending,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  Scene,
  Vector3,
  type Texture,
} from "three";
import type { Impact } from "./game";

interface Tracer {
  ox: number;
  oy: number;
  oz: number;
  dx: number;
  dy: number;
  dz: number;
  len: number;
  t: number;
  speed: number;
  width: number;
}

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  age: number;
  r: number;
  g: number;
  b: number;
  a: number;
  grav: number;
  drag: number;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _x = new Vector3();
const _y = new Vector3();
const _z = new Vector3();
const _cam = new Vector3();
const _o = new Object3D();

class PointPool {
  readonly points: Points;
  private readonly list: Particle[] = [];
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly geo = new BufferGeometry();

  constructor(
    readonly max: number,
    tex: Texture,
    size: number,
    additive: boolean,
  ) {
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    const pa = new BufferAttribute(this.pos, 3);
    pa.setUsage(DynamicDrawUsage);
    const ca = new BufferAttribute(this.col, 4);
    ca.setUsage(DynamicDrawUsage);
    this.geo.setAttribute("position", pa);
    this.geo.setAttribute("color", ca);
    this.geo.setDrawRange(0, 0);
    const mat = new PointsMaterial({
      map: tex,
      size,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: additive ? AdditiveBlending : NormalBlending,
    });
    this.points = new Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  spawn(p: Omit<Particle, "age">): void {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push({ ...p, age: 0 });
  }

  update(dt: number): void {
    let n = 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i]!;
      p.age += dt;
      if (p.age >= p.life) {
        this.list.splice(i, 1);
        continue;
      }
      p.vy -= p.grav * dt;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy *= d;
      p.vz *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.02) {
        p.y = 0.02;
        p.vy = Math.abs(p.vy) * 0.3;
      }
    }
    for (const p of this.list) {
      const k = 1 - p.age / p.life;
      this.pos[n * 3] = p.x;
      this.pos[n * 3 + 1] = p.y;
      this.pos[n * 3 + 2] = p.z;
      this.col[n * 4] = p.r;
      this.col[n * 4 + 1] = p.g;
      this.col[n * 4 + 2] = p.b;
      this.col[n * 4 + 3] = p.a * k;
      n++;
    }
    this.geo.setDrawRange(0, n);
    this.geo.attributes.position!.needsUpdate = true;
    this.geo.attributes.color!.needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    (this.points.material as PointsMaterial).dispose();
  }
}

export class Vfx {
  private readonly tracers: Tracer[] = [];
  private readonly tracerMesh: InstancedMesh;
  private readonly sparks: PointPool;
  private readonly puffs: PointPool;
  private readonly decals: InstancedMesh;
  private decalIndex = 0;
  private decalCount = 0;
  private scale = 1;
  private readonly geometries: BufferGeometry[] = [];

  constructor(
    scene: Scene,
    tex: { streak: Texture; dot: Texture; hole: Texture },
    opts: { decals: number; particles: number },
  ) {
    // Unit quad: length along +x, width along y, facing +z (turned toward the camera per tracer).
    const quad = new PlaneGeometry(1, 1);
    this.geometries.push(quad);
    this.tracerMesh = new InstancedMesh(quad, new MeshBasicMaterial({ map: tex.streak, transparent: true, blending: AdditiveBlending, depthWrite: false, color: 0xffe0a8 }), 48);
    this.tracerMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.tracerMesh.count = 0;
    this.tracerMesh.frustumCulled = false;
    this.tracerMesh.renderOrder = 4;
    scene.add(this.tracerMesh);
    this.sparks = new PointPool(220, tex.dot, 0.06, true);
    this.puffs = new PointPool(160, tex.dot, 0.35, false);
    scene.add(this.sparks.points, this.puffs.points);
    const dg = new PlaneGeometry(0.13, 0.13);
    this.geometries.push(dg);
    this.decals = new InstancedMesh(dg, new MeshBasicMaterial({ map: tex.hole, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), Math.max(8, opts.decals));
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    this.decals.renderOrder = 2;
    scene.add(this.decals);
    this.scale = opts.particles;
  }

  setBudget(particles: number): void {
    this.scale = particles;
  }

  /** A bullet's visible path from the muzzle to where it stopped. */
  tracer(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, width = 0.035): void {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1.5) return;
    if (this.tracers.length >= 48) this.tracers.shift();
    this.tracers.push({ ox: from.x, oy: from.y, oz: from.z, dx: dx / len, dy: dy / len, dz: dz / len, len, t: 0, speed: 380 + Math.random() * 60, width });
  }

  impact(i: Impact): void {
    const n = this.scale;
    if (i.surface === "flesh") {
      for (let k = 0; k < Math.ceil(6 * n); k++) {
        this.puffs.spawn({ x: i.x, y: i.y, z: i.z, vx: i.nx * 1.2 + (Math.random() - 0.5) * 1.6, vy: i.ny * 1.2 + Math.random() * 1.2, vz: i.nz * 1.2 + (Math.random() - 0.5) * 1.6, life: 0.35 + Math.random() * 0.25, r: 0.55, g: 0.06, b: 0.05, a: 0.85, grav: 4, drag: 4 });
      }
      return;
    }
    const hard = i.surface === "metal" || i.surface === "container";
    const sparks = Math.ceil((hard ? 9 : 3) * n);
    for (let k = 0; k < sparks; k++) {
      const s = 3 + Math.random() * 5;
      this.sparks.spawn({ x: i.x, y: i.y, z: i.z, vx: i.nx * s + (Math.random() - 0.5) * 4, vy: i.ny * s + Math.random() * 3, vz: i.nz * s + (Math.random() - 0.5) * 4, life: 0.18 + Math.random() * 0.25, r: 1, g: 0.75 + Math.random() * 0.2, b: 0.35, a: 1, grav: 12, drag: 2 });
    }
    const dustColor = i.surface === "wood" ? [0.55, 0.42, 0.3] : i.surface === "ground" || i.surface === "concrete" ? [0.78, 0.72, 0.62] : [0.6, 0.6, 0.6];
    for (let k = 0; k < Math.ceil((hard ? 2 : 5) * n); k++) {
      this.puffs.spawn({ x: i.x + i.nx * 0.05, y: i.y + i.ny * 0.05, z: i.z + i.nz * 0.05, vx: i.nx * (0.8 + Math.random()) + (Math.random() - 0.5), vy: i.ny * (0.8 + Math.random()) + Math.random() * 0.6, vz: i.nz * (0.8 + Math.random()) + (Math.random() - 0.5), life: 0.5 + Math.random() * 0.5, r: dustColor[0]!, g: dustColor[1]!, b: dustColor[2]!, a: 0.55, grav: -0.3, drag: 3 });
    }
    this.decal(i);
  }

  private decal(i: Impact): void {
    _p.set(i.x + i.nx * 0.005, i.y + i.ny * 0.005, i.z + i.nz * 0.005);
    _z.set(i.nx, i.ny, i.nz);
    _o.position.copy(_p);
    _o.lookAt(_p.x + _z.x, _p.y + _z.y, _p.z + _z.z);
    _o.rotateZ(Math.random() * Math.PI * 2);
    const s = 0.7 + Math.random() * 0.6;
    _o.scale.set(s, s, s);
    _o.updateMatrix();
    this.decals.setMatrixAt(this.decalIndex, _o.matrix);
    this.decalIndex = (this.decalIndex + 1) % this.decals.instanceMatrix.count;
    this.decalCount = Math.min(this.decals.instanceMatrix.count, this.decalCount + 1);
    this.decals.count = this.decalCount;
    this.decals.instanceMatrix.needsUpdate = true;
  }

  /** A small dust kick (landing, footsteps in the sand). */
  dust(x: number, y: number, z: number, amount: number): void {
    for (let k = 0; k < Math.ceil(amount * this.scale); k++) {
      const a = Math.random() * Math.PI * 2;
      this.puffs.spawn({ x, y: y + 0.05, z, vx: Math.cos(a) * 1.2, vy: 0.4 + Math.random() * 0.5, vz: Math.sin(a) * 1.2, life: 0.6 + Math.random() * 0.4, r: 0.8, g: 0.74, b: 0.64, a: 0.4, grav: -0.2, drag: 3 });
    }
  }

  update(dt: number, camera: PerspectiveCamera): void {
    camera.getWorldPosition(_cam);
    let n = 0;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i]!;
      t.t += dt * t.speed;
      if (t.t - 7 > t.len) {
        this.tracers.splice(i, 1);
      }
    }
    for (const t of this.tracers) {
      const head = Math.min(t.len, t.t);
      const tail = Math.max(0, t.t - 7);
      const seg = head - tail;
      if (seg <= 0.05) continue;
      const mid = (head + tail) / 2;
      _p.set(t.ox + t.dx * mid, t.oy + t.dy * mid, t.oz + t.dz * mid);
      // Billboard around the tracer's axis.
      _x.set(t.dx, t.dy, t.dz);
      _z.copy(_cam).sub(_p);
      _y.crossVectors(_z, _x).normalize();
      if (_y.lengthSq() < 1e-6) continue;
      _z.crossVectors(_x, _y).normalize();
      _m.makeBasis(_x, _y, _z);
      _q.setFromRotationMatrix(_m);
      const dist = _p.distanceTo(_cam);
      _s.set(seg, t.width * Math.max(1, dist * 0.06), 1);
      _m.compose(_p, _q, _s);
      this.tracerMesh.setMatrixAt(n++, _m);
      if (n >= 48) break;
    }
    this.tracerMesh.count = n;
    this.tracerMesh.instanceMatrix.needsUpdate = true;
    this.sparks.update(dt);
    this.puffs.update(dt);
  }

  dispose(): void {
    this.geometries.forEach((g) => g.dispose());
    (this.tracerMesh.material as MeshBasicMaterial).dispose();
    (this.decals.material as MeshBasicMaterial).dispose();
    this.sparks.dispose();
    this.puffs.dispose();
    this.tracerMesh.removeFromParent();
    this.decals.removeFromParent();
    this.sparks.points.removeFromParent();
    this.puffs.points.removeFromParent();
  }
}

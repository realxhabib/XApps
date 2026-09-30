/**
 * The first-person weapon: its own small scene and camera, drawn over the
 * world after a depth clear so it never clips into walls. Each gun is a
 * handful of boxes and cylinders with gloved hands. Motion is layered
 * springs: walk bob, look sway (the gun lags your aim), aim-down-sights
 * (the sights come to the center of the screen), sprint carry, recoil kick,
 * reload dip, swap drop, and a muzzle flash with a quick light.
 */

import {
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  Color,
  Euler,
  Matrix4,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Scene,
  type BufferGeometry,
  type Material,
  type Texture,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { WeaponId } from "./weapons";

const _e = new Euler();
const _m4 = new Matrix4();
const _col = new Color();

interface GunModel {
  group: Group;
  /** Where the muzzle is, in the gun's frame. */
  muzzle: [number, number, number];
  /** Sight height above the gun origin (ADS brings it to the view center). */
  sightY: number;
  /** Magazine mesh (drops during reloads). */
  mag: Mesh | null;
  /** How far ahead of the camera the gun sits when aimed. */
  adsZ: number;
}

const HIP: [number, number, number] = [0.14, -0.15, -0.42];

export class ViewModel {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(54, 1, 0.01, 10);
  private readonly root = new Group();
  private readonly guns = new Map<WeaponId, GunModel>();
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private current: WeaponId | null = null;
  private readonly flash: Mesh;
  private readonly flashLight: PointLight;
  private flashUntil = 0;
  // Springs.
  private swayX = 0;
  private swayY = 0;
  private swayVX = 0;
  private swayVY = 0;
  private kick = 0;
  private kickV = 0;
  private kickRot = 0;
  private sprint = 0;
  private bobT = 0;

  constructor(flashTex: Texture) {
    this.scene.add(new HemisphereLight(0xdfe9ff, 0x6b5a45, 1.6));
    this.scene.add(new AmbientLight(0xffffff, 0.35));
    const sun = new DirectionalLight(0xfff0d8, 1.8);
    sun.position.set(0.6, 1, 0.4);
    this.scene.add(sun);
    this.flashLight = new PointLight(0xffb060, 0, 2.5, 2);
    this.flashLight.position.set(0, -0.05, -0.8);
    this.scene.add(this.flashLight);
    this.scene.add(this.root);
    const flashMat = new MeshBasicMaterial({ map: flashTex, blending: AdditiveBlending, transparent: true, depthWrite: false });
    this.materials.push(flashMat);
    const flashGeo = new PlaneGeometry(0.22, 0.22);
    this.geometries.push(flashGeo);
    this.flash = new Mesh(flashGeo, flashMat);
    this.flash.visible = false;
    this.flash.renderOrder = 5;
    this.root.add(this.flash);
    for (const id of ["ar", "smg", "sniper", "shotgun", "pistol"] as WeaponId[]) {
      const m = this.build(id);
      m.group.visible = false;
      this.root.add(m.group);
      this.guns.set(id, m);
    }
  }

  /** One vertex-colored material for every gun and hand. */
  private readonly shared = new MeshLambertMaterial({ vertexColors: true });

  private build(id: WeaponId): GunModel {
    const g = new Group();
    const metal = 0x2a2d31;
    const metal2 = 0x3c4046;
    const accent = id === "sniper" ? 0x6b6448 : id === "shotgun" ? 0x7a5234 : id === "smg" ? 0x31353b : 0x4a4c3c;
    const glove = 0x2b2721;
    const sleeve = 0x5b6245;
    // Static parts are merged into one mesh (one draw call per gun); the magazine stays separate (it moves).
    const parts: BufferGeometry[] = [];
    const place = (geo: BufferGeometry, color: number, x: number, y: number, z: number, rx = 0, ry = 0): BufferGeometry => {
      _e.set(rx, ry, 0);
      _m4.makeRotationFromEuler(_e);
      _m4.setPosition(x, y, z);
      geo.applyMatrix4(_m4);
      _col.setHex(color);
      const n = geo.getAttribute("position").count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        arr[i * 3] = _col.r;
        arr[i * 3 + 1] = _col.g;
        arr[i * 3 + 2] = _col.b;
      }
      geo.setAttribute("color", new BufferAttribute(arr, 3));
      return geo;
    };
    const boxm = (w: number, h: number, d: number, x: number, y: number, z: number, color: number, rx = 0) => {
      parts.push(place(new BoxGeometry(w, h, d), color, x, y, z, rx));
    };
    const magBox = (w: number, h: number, d: number, x: number, y: number, z: number, color: number, rx = 0): Mesh => {
      const geo = place(new BoxGeometry(w, h, d), color, 0, 0, 0, rx);
      this.geometries.push(geo);
      const m = new Mesh(geo, this.shared);
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };
    const cyl = (r: number, len: number, x: number, y: number, z: number, color: number) => {
      parts.push(place(new CylinderGeometry(r, r, len, 10).rotateX(Math.PI / 2), color, x, y, z));
    };
    let mag: Mesh | null = null;
    let muzzle: [number, number, number] = [0, 0.02, -0.6];
    let sightY = 0.07;
    let adsZ = -0.22;
    // Rear sight: two posts with a gap you look through; the front post's top is the aim point (sightY).
    const rear = (y0: number, top: number, z: number, gap = 0.011) => {
      boxm(0.007, top - y0, 0.012, -gap, (y0 + top) / 2, z, metal);
      boxm(0.007, top - y0, 0.012, gap, (y0 + top) / 2, z, metal);
    };
    const front = (y0: number, top: number, z: number) => boxm(0.005, top - y0, 0.008, 0, (y0 + top) / 2, z, metal);
    if (id === "ar") {
      boxm(0.05, 0.07, 0.34, 0, 0, -0.1, metal);
      boxm(0.055, 0.06, 0.2, 0, 0.005, -0.33, accent);
      cyl(0.011, 0.2, 0, 0.012, -0.53, metal2);
      boxm(0.04, 0.055, 0.12, 0, -0.018, 0.1, accent);
      boxm(0.035, 0.08, 0.05, 0, -0.07, 0.03, metal, 0.25);
      mag = magBox(0.035, 0.13, 0.06, 0, -0.1, -0.13, metal2, -0.2);
      boxm(0.02, 0.012, 0.3, 0, 0.041, -0.14, metal2);
      rear(0.047, 0.072, 0.0);
      front(0.035, 0.066, -0.42);
      muzzle = [0, 0.012, -0.64];
      sightY = 0.066;
      adsZ = -0.3;
    } else if (id === "smg") {
      boxm(0.05, 0.075, 0.26, 0, 0, -0.08, metal);
      cyl(0.012, 0.12, 0, 0.012, -0.27, metal2);
      boxm(0.03, 0.03, 0.1, 0, -0.01, 0.08, metal2);
      boxm(0.035, 0.09, 0.05, 0, -0.075, 0.0, accent, 0.2);
      mag = magBox(0.03, 0.17, 0.045, 0, -0.12, -0.12, metal2);
      rear(0.037, 0.066, 0.02, 0.01);
      front(0.037, 0.06, -0.2);
      muzzle = [0, 0.012, -0.35];
      sightY = 0.06;
      adsZ = -0.28;
    } else if (id === "sniper") {
      boxm(0.05, 0.07, 0.4, 0, 0, -0.08, accent);
      cyl(0.012, 0.42, 0, 0.012, -0.5, metal);
      boxm(0.045, 0.07, 0.16, 0, -0.02, 0.16, accent);
      boxm(0.035, 0.08, 0.05, 0, -0.07, 0.04, accent, 0.25);
      mag = magBox(0.035, 0.06, 0.07, 0, -0.06, -0.08, metal2);
      cyl(0.022, 0.26, 0, 0.075, -0.1, metal);
      cyl(0.028, 0.05, 0, 0.075, -0.24, metal);
      cyl(0.026, 0.04, 0, 0.075, 0.03, metal);
      boxm(0.03, 0.012, 0.02, 0.035, 0.02, 0.02, metal2);
      muzzle = [0, 0.012, -0.72];
      sightY = 0.075;
      adsZ = -0.16;
    } else if (id === "shotgun") {
      boxm(0.05, 0.07, 0.3, 0, 0, -0.06, metal);
      cyl(0.015, 0.46, 0, 0.018, -0.42, metal2);
      cyl(0.013, 0.4, 0, -0.014, -0.4, metal);
      mag = magBox(0.055, 0.05, 0.14, 0, -0.018, -0.36, accent);
      boxm(0.045, 0.07, 0.14, 0, -0.03, 0.14, accent, 0.1);
      boxm(0.035, 0.08, 0.05, 0, -0.07, 0.05, accent, 0.25);
      rear(0.035, 0.056, 0.02, 0.01);
      front(0.033, 0.05, -0.62);
      muzzle = [0, 0.018, -0.66];
      sightY = 0.05;
      adsZ = -0.3;
    } else {
      boxm(0.035, 0.045, 0.2, 0, 0.02, -0.06, metal);
      boxm(0.032, 0.035, 0.18, 0, -0.015, -0.05, metal2);
      mag = magBox(0.03, 0.11, 0.05, 0, -0.07, 0.01, accent, 0.25);
      rear(0.042, 0.058, 0.02, 0.008);
      front(0.042, 0.054, -0.145);
      muzzle = [0, 0.022, -0.17];
      sightY = 0.054;
      adsZ = -0.34;
    }
    // Hands: the trigger hand on the grip, the support hand forward (pistol: both on the grip).
    const hand = (x: number, y: number, z: number, rx: number, ry: number) => {
      parts.push(place(new BoxGeometry(0.06, 0.06, 0.1), glove, x, y, z, rx, ry));
      parts.push(place(new BoxGeometry(0.075, 0.075, 0.3), sleeve, x + Math.sin(ry) * 0.18, y - 0.06, z + 0.18, rx - 0.35, ry));
    };
    if (id === "pistol") {
      hand(0.005, -0.06, 0.03, 0.25, 0);
      hand(-0.03, -0.07, 0.02, 0.25, 0.4);
    } else {
      hand(0.005, -0.07, 0.03, 0.25, 0);
      hand(-0.015, -0.035, id === "smg" ? -0.2 : id === "shotgun" ? -0.36 : -0.3, 0.1, 0.35);
    }
    const merged = mergeGeometries(parts)!;
    parts.forEach((p) => p.dispose());
    this.geometries.push(merged);
    g.add(new Mesh(merged, this.shared));
    return { group: g, muzzle, sightY, mag, adsZ };
  }

  setWeapon(id: WeaponId): void {
    if (this.current === id) return;
    if (this.current) this.guns.get(this.current)!.group.visible = false;
    this.current = id;
    this.guns.get(id)!.group.visible = true;
  }

  fired(now: number, strength: number): void {
    this.kickV += 3.2 * strength;
    this.kickRot += 0.07 * strength;
    this.flashUntil = now + 45;
    this.flash.rotation.z = Math.random() * Math.PI;
    const s = 0.8 + Math.random() * 0.5;
    this.flash.scale.set(s, s, 1);
  }

  /** The weapon's own FOV: 54° tall, widened on portrait screens so the gun isn't cropped. */
  private baseFov = 54;

  /** Portrait screens pull the gun in toward the middle so it isn't cut off at the edge. */
  private hipX = HIP[0];

  resize(aspect: number): void {
    this.hipX = HIP[0] * Math.max(0.45, Math.min(1, aspect));
    this.baseFov = Math.max(54, (2 * Math.atan(Math.tan((22 * Math.PI) / 180) / aspect) * 180) / Math.PI);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Poses the gun for this frame. `look` = this frame's view rotation
   * (radians) for sway; `reload` / `swap` are 0…1 progress (or −1 when not
   * doing it).
   */
  update(o: { now: number; dt: number; ads: number; sprinting: boolean; moving: number; walkPhase: number; grounded: boolean; lookX: number; lookY: number; reload: number; swap: number; hideScoped: boolean; reduceMotion: boolean }): void {
    const gun = this.current ? this.guns.get(this.current) : undefined;
    if (!gun) return;
    const dt = Math.min(0.05, o.dt);
    // Sway: the gun lags the look a little (spring).
    const k = 90;
    const damp = 14;
    this.swayVX += (-o.lookX * 1.4 - this.swayX) * k * dt - this.swayVX * damp * dt;
    this.swayVY += (o.lookY * 1.4 - this.swayY) * k * dt - this.swayVY * damp * dt;
    this.swayX += this.swayVX * dt;
    this.swayY += this.swayVY * dt;
    this.swayX = Math.max(-0.06, Math.min(0.06, this.swayX));
    this.swayY = Math.max(-0.05, Math.min(0.05, this.swayY));
    // Recoil spring.
    this.kickV += -this.kick * 220 * dt - this.kickV * 22 * dt;
    this.kick += this.kickV * dt;
    this.kickRot = Math.max(0, this.kickRot - dt * 0.9);
    this.sprint += ((o.sprinting ? 1 : 0) - this.sprint) * Math.min(1, dt * 9);
    this.bobT = o.walkPhase;
    const ads = o.ads;
    const hip = 1 - ads;
    const bobAmt = (o.reduceMotion ? 0.3 : 1) * o.moving * (o.grounded ? 1 : 0.2) * (1 - ads * 0.85);
    const bx = Math.sin(this.bobT * Math.PI) * 0.012 * bobAmt;
    const by = -Math.abs(Math.cos(this.bobT * Math.PI)) * 0.01 * bobAmt;
    const x = this.hipX * hip + bx + this.swayX * (0.4 + hip * 0.6) + 0.06 * this.sprint;
    const y = (HIP[1] * hip + -gun.sightY * ads) + by + this.swayY * (0.4 + hip * 0.6) - 0.04 * this.sprint;
    const z = HIP[2] * hip + gun.adsZ * ads + Math.max(0, this.kick) * 0.06;
    let rx = this.kickRot * (1 - ads * 0.6) - 0.35 * this.sprint;
    const ry = 0.55 * this.sprint;
    let rz = 0.25 * this.sprint;
    let dy = 0;
    // Reload: dip, roll, and the magazine drops out and back in.
    if (o.reload >= 0) {
      const r = o.reload;
      const w = Math.sin(Math.min(1, r * 1.15) * Math.PI);
      dy -= 0.07 * w;
      rz += 0.5 * w;
      rx += 0.25 * w;
      if (gun.mag) {
        const out = r < 0.45 ? Math.min(1, r / 0.25) : Math.max(0, 1 - (r - 0.45) / 0.25);
        gun.mag.position.y = gunMagY(this.current!) - 0.18 * out;
        gun.mag.visible = !(r > 0.3 && r < 0.5);
      }
    } else if (gun.mag) {
      gun.mag.position.y = gunMagY(this.current!);
      gun.mag.visible = true;
    }
    // Swap: drop out and come back up.
    if (o.swap >= 0) {
      const s = 1 - o.swap;
      dy -= 0.25 * s * s;
      rx -= 0.6 * s * s;
    }
    this.root.position.set(x, y + dy, z);
    this.root.rotation.set(rx, ry, rz);
    // Muzzle flash.
    const flashing = o.now < this.flashUntil;
    this.flash.visible = flashing && !o.hideScoped;
    this.flash.position.set(gun.muzzle[0], gun.muzzle[1], gun.muzzle[2] - 0.02);
    this.flashLight.intensity = flashing ? 0.8 : 0;
    this.root.visible = !o.hideScoped;
    // Aiming narrows the view model's FOV a touch too (feels like leaning into the sights).
    const fov = this.baseFov - 8 * ads;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  dispose(): void {
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    this.shared.dispose();
  }
}

function gunMagY(id: WeaponId): number {
  return id === "ar" ? -0.1 : id === "smg" ? -0.12 : id === "sniper" ? -0.06 : id === "shotgun" ? -0.018 : -0.07;
}

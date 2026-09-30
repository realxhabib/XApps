/**
 * The map in three.js: every box merged into one mesh per surface (a
 * handful of draw calls for the whole yard), with world-space UVs so
 * textures keep their scale, and a baked-looking vertical gradient in the
 * vertex colors (darker where walls meet the ground). The floor is one
 * textured plane with baked contact/sun shadows; a gradient sky dome, a
 * sun glow and distant port silhouettes sit outside the walls.
 */

import {
  BackSide,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  AdditiveBlending,
  type Material,
  type Texture,
} from "three";
import type { MapDef } from "./map";
import type { Box, Surface } from "./physics";
import { concreteTexture, containerTexture, groundTexture, metalTexture, softDot, woodTexture } from "./textures";

interface Buffers {
  pos: number[];
  nor: number[];
  uv: number[];
  col: number[];
}

const buffers = (): Buffers => ({ pos: [], nor: [], uv: [], col: [] });

/** Meters per texture repeat, per surface. */
const UV_SCALE: Record<Surface, number> = {
  ground: 4,
  concrete: 2,
  container: 1,
  wood: 1,
  metal: 1,
  sand: 3,
  tarp: 1,
  glass: 1,
};

const _c = new Color();

function pushBox(buf: Buffers, b: Box, seed: number): void {
  const base = _c.setHex(b.color);
  // A little per-box variation so repeated colors don't look copy-pasted.
  const vary = 0.92 + ((seed * 9301 + 49297) % 233280) / 233280 * 0.14;
  const r0 = base.r * vary;
  const g0 = base.g * vary;
  const b0 = base.b * vary;
  const s = UV_SCALE[b.surface];
  const grounded = b.y0 < 0.05;
  const h = b.y1 - b.y0;
  const aoBottom = grounded ? 0.7 : 0.88;
  const face = (
    corners: [number, number, number][],
    n: [number, number, number],
    uvOf: (p: [number, number, number]) => [number, number],
    shadeOf: (p: [number, number, number]) => number,
  ) => {
    const [a, bb, c, d] = corners as [[number, number, number], [number, number, number], [number, number, number], [number, number, number]];
    for (const p of [a, bb, c, a, c, d]) {
      buf.pos.push(p[0], p[1], p[2]);
      buf.nor.push(n[0], n[1], n[2]);
      const [u, v] = uvOf(p);
      buf.uv.push(u / s, v / s);
      const k = shadeOf(p);
      buf.col.push(r0 * k, g0 * k, b0 * k);
    }
  };
  const vert = (p: [number, number, number]) => {
    const t = h > 0 ? (p[1] - b.y0) / h : 1;
    // Darker toward the bottom; quick ramp near the ground for contact.
    return aoBottom + (1 - aoBottom) * Math.min(1, Math.pow(t, 0.55) * 1.05);
  };
  const { x0, y0, z0, x1, y1, z1 } = b;
  const ribsX = b.ribs === "x";
  const ribsZ = b.ribs === "z";
  // +x
  face(
    [
      [x1, y0, z1],
      [x1, y0, z0],
      [x1, y1, z0],
      [x1, y1, z1],
    ],
    [1, 0, 0],
    (p) => [ribsX ? p[2] * 0.25 : -p[2], p[1]],
    vert,
  );
  // −x
  face(
    [
      [x0, y0, z0],
      [x0, y0, z1],
      [x0, y1, z1],
      [x0, y1, z0],
    ],
    [-1, 0, 0],
    (p) => [ribsX ? p[2] * 0.25 : p[2], p[1]],
    vert,
  );
  // +z
  face(
    [
      [x0, y0, z1],
      [x1, y0, z1],
      [x1, y1, z1],
      [x0, y1, z1],
    ],
    [0, 0, 1],
    (p) => [ribsZ ? p[0] * 0.25 : p[0], p[1]],
    vert,
  );
  // −z
  face(
    [
      [x1, y0, z0],
      [x0, y0, z0],
      [x0, y1, z0],
      [x1, y1, z0],
    ],
    [0, 0, -1],
    (p) => [ribsZ ? p[0] * 0.25 : -p[0], p[1]],
    vert,
  );
  // Top.
  face(
    [
      [x0, y1, z1],
      [x1, y1, z1],
      [x1, y1, z0],
      [x0, y1, z0],
    ],
    [0, 1, 0],
    (p) => [p[0], -p[2]],
    () => (b.surface === "container" ? 0.96 : 1),
  );
  // Bottom only when it floats (seen from below).
  if (!grounded) {
    face(
      [
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y0, z1],
        [x0, y0, z1],
      ],
      [0, -1, 0],
      (p) => [p[0], p[2]],
      () => 0.7,
    );
  }
}

function toGeometry(buf: Buffers): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(buf.pos, 3));
  g.setAttribute("normal", new Float32BufferAttribute(buf.nor, 3));
  g.setAttribute("uv", new Float32BufferAttribute(buf.uv, 2));
  g.setAttribute("color", new Float32BufferAttribute(buf.col, 3));
  g.computeBoundingSphere();
  return g;
}

export interface WorldView {
  group: Group;
  /** Meshes that cast/receive the sun's shadow map. */
  setShadows(on: boolean): void;
  setSkyline(on: boolean): void;
  dispose(): void;
}

export function buildWorld(map: MapDef, opts: { shadows: boolean; groundPx: number; skyline: boolean }): WorldView {
  const group = new Group();
  const textures: Texture[] = [];
  const materials: Material[] = [];
  const geometries: BufferGeometry[] = [];
  const tex = (t: Texture) => {
    textures.push(t);
    return t;
  };
  const mats: Record<string, Texture> = {
    container: tex(containerTexture()),
    concrete: tex(concreteTexture()),
    wood: tex(woodTexture()),
    metal: tex(metalTexture()),
  };
  const bySurface = new Map<string, Buffers>();
  map.boxes.forEach((b, i) => {
    const key = b.surface === "container" ? "container" : b.surface === "wood" ? "wood" : b.surface === "metal" ? "metal" : "concrete";
    let buf = bySurface.get(key);
    if (!buf) {
      buf = buffers();
      bySurface.set(key, buf);
    }
    pushBox(buf, b, i + 1);
  });
  const solids: Mesh[] = [];
  for (const [key, buf] of bySurface) {
    const geo = toGeometry(buf);
    geometries.push(geo);
    const mat = new MeshLambertMaterial({ map: mats[key], vertexColors: true });
    materials.push(mat);
    const mesh = new Mesh(geo, mat);
    mesh.castShadow = opts.shadows;
    mesh.receiveShadow = opts.shadows;
    mesh.matrixAutoUpdate = false;
    solids.push(mesh);
    group.add(mesh);
  }

  // Floor.
  const { bounds } = map;
  const W = bounds.x1 - bounds.x0;
  const H = bounds.z1 - bounds.z0;
  let groundTex = tex(groundTexture(map, opts.groundPx, !opts.shadows));
  const groundMat = new MeshLambertMaterial({ map: groundTex });
  materials.push(groundMat);
  const groundGeo = new PlaneGeometry(W, H).rotateX(-Math.PI / 2);
  geometries.push(groundGeo);
  const ground = new Mesh(groundGeo, groundMat);
  ground.position.set((bounds.x0 + bounds.x1) / 2, 0, (bounds.z0 + bounds.z1) / 2);
  ground.receiveShadow = opts.shadows;
  ground.updateMatrix();
  ground.matrixAutoUpdate = false;
  group.add(ground);
  // Beyond the walls: a dusty apron so the horizon isn't empty.
  const apronGeo = new PlaneGeometry(600, 600).rotateX(-Math.PI / 2);
  geometries.push(apronGeo);
  const apronMat = new MeshLambertMaterial({ color: 0xb8a78a });
  materials.push(apronMat);
  const apron = new Mesh(apronGeo, apronMat);
  apron.position.y = -0.02;
  apron.updateMatrix();
  apron.matrixAutoUpdate = false;
  group.add(apron);

  // Skyline.
  const skyBuf = buffers();
  map.skyline.forEach((b, i) => pushBox(skyBuf, b, i + 100));
  const skyGeo = toGeometry(skyBuf);
  geometries.push(skyGeo);
  const skylineMat = new MeshLambertMaterial({ map: mats.container, vertexColors: true });
  materials.push(skylineMat);
  const skyline = new Mesh(skyGeo, skylineMat);
  skyline.visible = opts.skyline;
  skyline.matrixAutoUpdate = false;
  group.add(skyline);

  // Sky dome: vertical gradient in vertex colors.
  const domeGeo = new SphereGeometry(400, 24, 14);
  geometries.push(domeGeo);
  const top = new Color(map.sky.top);
  const horizon = new Color(map.sky.horizon);
  const below = new Color(map.sky.ground);
  const pos = domeGeo.getAttribute("position");
  const cols: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 400;
    const c = y >= 0 ? horizon.clone().lerp(top, Math.pow(y, 0.6)) : horizon.clone().lerp(below, Math.min(1, -y * 4));
    cols.push(c.r, c.g, c.b);
  }
  domeGeo.setAttribute("color", new Float32BufferAttribute(cols, 3));
  const domeMat = new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false });
  materials.push(domeMat);
  const dome = new Mesh(domeGeo, domeMat);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  group.add(dome);
  // Sun glow.
  const glowTex = tex(softDot(0.05, "255,244,214"));
  const glowMat = new SpriteMaterial({ map: glowTex, blending: AdditiveBlending, depthWrite: false, fog: false, opacity: 0.85 });
  materials.push(glowMat);
  const sun = new Sprite(glowMat);
  const [sx, sy, sz] = map.sun;
  const len = Math.hypot(sx, sy, sz);
  sun.position.set((sx / len) * 380, (sy / len) * 380, (sz / len) * 380);
  sun.scale.set(90, 90, 1);
  sun.renderOrder = -9;
  group.add(sun);

  return {
    group,
    setShadows(on: boolean) {
      for (const m of solids) {
        m.castShadow = on;
        m.receiveShadow = on;
      }
      ground.receiveShadow = on;
      const next = groundTexture(map, opts.groundPx, !on);
      groundMat.map = next;
      groundMat.needsUpdate = true;
      groundTex.dispose();
      groundTex = next;
    },
    setSkyline(on: boolean) {
      skyline.visible = on;
    },
    dispose() {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
      groundTex.dispose();
    },
  };
}

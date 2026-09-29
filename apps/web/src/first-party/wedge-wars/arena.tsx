"use client";

/**
 * The combat arena: worn steel floor (with a KO pit cut out), hazard-striped
 * borders, bulletproof glass walls on steel posts with LED rails, stadium
 * light towers with volumetric beams, an overhead truss and scoreboard cube,
 * stands with a crowd, and the hazards (pop-up saws, flame vents, the
 * pulverizer). Colliders live in `ArenaColliders` (inside <Physics>).
 */

import { useFrame } from "@react-three/fiber";
import { CuboidCollider, RigidBody, type RapierRigidBody } from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  Vector2,
  Vector3,
  type Texture,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { ARENA, pulverizerLevel, sawLevel, ventState, type HazardLayout } from "./logic";
import type { TierSettings } from "./quality";
import { beamGradient, brushedSteel, floorAlbedo, floorDetail, glassSmudge, hazardStripes, ledBanner, softDot } from "./textures";

const H = ARENA.half;
const P = ARENA.pit;

/* ---------------------------------------------------------------------- */
/* Physics                                                                */
/* ---------------------------------------------------------------------- */

export function ArenaColliders({ layout }: { layout: HazardLayout }) {
  const floorT = 1;
  const side = H - P.half; // width of the slabs left/right of the pit
  return (
    <>
      <RigidBody type="fixed" colliders={false} userData={{ floor: true }} friction={0.9}>
        {/* Floor slabs around the pit (top at y = 0). */}
        <CuboidCollider args={[side / 2, floorT / 2, H]} position={[-(P.half + side / 2), -floorT / 2, 0]} />
        <CuboidCollider args={[side / 2, floorT / 2, H]} position={[P.half + side / 2, -floorT / 2, 0]} />
        <CuboidCollider args={[P.half, floorT / 2, side / 2]} position={[0, -floorT / 2, -(P.half + side / 2)]} />
        <CuboidCollider args={[P.half, floorT / 2, side / 2]} position={[0, -floorT / 2, P.half + side / 2]} />
        {/* Pit walls + bottom. */}
        <CuboidCollider args={[0.2, 4, P.half]} position={[-P.half - 0.2, -4, 0]} />
        <CuboidCollider args={[0.2, 4, P.half]} position={[P.half + 0.2, -4, 0]} />
        <CuboidCollider args={[P.half, 4, 0.2]} position={[0, -4, -P.half - 0.2]} />
        <CuboidCollider args={[P.half, 4, 0.2]} position={[0, -4, P.half + 0.2]} />
        <CuboidCollider args={[P.half, 0.5, P.half]} position={[0, -8.5, 0]} />
      </RigidBody>
      <RigidBody type="fixed" colliders={false} userData={{ wall: true }} friction={0.2} restitution={0.25}>
        <CuboidCollider args={[H + 1, 4, 0.5]} position={[0, 3.5, -H - 0.5]} />
        <CuboidCollider args={[H + 1, 4, 0.5]} position={[0, 3.5, H + 0.5]} />
        <CuboidCollider args={[0.5, 4, H + 1]} position={[-H - 0.5, 3.5, 0]} />
        <CuboidCollider args={[0.5, 4, H + 1]} position={[H + 0.5, 3.5, 0]} />
        {/* Pulverizer gantry posts. */}
        <CuboidCollider args={[0.3, 3.5, 0.3]} position={[layout.pulverizer.x, 3.5, layout.pulverizer.z - 2.9]} />
        <CuboidCollider args={[0.3, 3.5, 0.3]} position={[layout.pulverizer.x, 3.5, layout.pulverizer.z + 2.9]} />
      </RigidBody>
    </>
  );
}

/** The pulverizer head is a kinematic body: it physically shoves trucks when it slams. */
export function PulverizerBody({ layout, clock }: { layout: HazardLayout; clock: () => number }) {
  const body = useRef<RapierRigidBody>(null);
  const pv = layout.pulverizer;
  useFrame(() => {
    const b = body.current;
    if (!b) return;
    const level = pulverizerLevel(clock(), pv.phase);
    b.setNextKinematicTranslation({ x: pv.x, y: 0.62 + level * 4.4, z: pv.z });
  });
  return (
    <RigidBody ref={body} type="kinematicPosition" colliders={false} position={[pv.x, 4, pv.z]} userData={{ wall: true }}>
      <CuboidCollider args={[1.7, 0.6, 1.7]} />
    </RigidBody>
  );
}

/* ---------------------------------------------------------------------- */
/* Visuals                                                                */
/* ---------------------------------------------------------------------- */

function floorGeometry() {
  const s = new Shape();
  s.moveTo(-H, -H);
  s.lineTo(H, -H);
  s.lineTo(H, H);
  s.lineTo(-H, H);
  s.closePath();
  const hole = new Shape();
  hole.moveTo(P.x - P.half, P.z - P.half);
  hole.lineTo(P.x - P.half, P.z + P.half);
  hole.lineTo(P.x + P.half, P.z + P.half);
  hole.lineTo(P.x + P.half, P.z - P.half);
  hole.closePath();
  s.holes.push(hole);
  const g = new ShapeGeometry(s, 1);
  const pos = g.getAttribute("position");
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) + H) / (2 * H);
    uv[i * 2 + 1] = (pos.getY(i) + H) / (2 * H);
  }
  g.setAttribute("uv", new BufferAttribute(uv, 2));
  g.rotateX(-Math.PI / 2);
  return g;
}

function sawBladeGeometry() {
  const teeth = 28;
  const r = 0.85;
  const s = new Shape();
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2;
    const a1 = ((i + 0.6) / teeth) * Math.PI * 2;
    const a2 = ((i + 1) / teeth) * Math.PI * 2;
    const p0 = [Math.cos(a0) * r, Math.sin(a0) * r];
    const p1 = [Math.cos(a1) * (r + 0.12), Math.sin(a1) * (r + 0.12)];
    const p2 = [Math.cos(a2) * r, Math.sin(a2) * r];
    if (i === 0) s.moveTo(p0[0]!, p0[1]!);
    s.lineTo(p1[0]!, p1[1]!);
    s.lineTo(p2[0]!, p2[1]!);
  }
  const hole = new Shape();
  hole.absarc(0, 0, 0.12, 0, Math.PI * 2, true);
  s.holes.push(hole);
  return new ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: false }).translate(0, 0, -0.0175);
}

/** Light-tower truss: 4 legs + zigzag braces, merged into one geometry. */
function trussGeometry(height: number, w: number) {
  const parts = [];
  for (const [x, z] of [
    [-w, -w],
    [w, -w],
    [w, w],
    [-w, w],
  ] as const) {
    parts.push(new BoxGeometry(0.09, height, 0.09).translate(x, height / 2, z));
  }
  const step = w * 2;
  for (let y = 0; y < height - step; y += step) {
    for (const face of [0, 1, 2, 3]) {
      const len = Math.hypot(step, w * 2);
      const b = new BoxGeometry(0.05, len, 0.05);
      b.rotateZ(Math.atan2(w * 2, step) * (face % 2 ? 1 : -1));
      if (face >= 2) b.rotateY(Math.PI / 2);
      const off = face === 0 ? [0, -w] : face === 1 ? [0, w] : face === 2 ? [-w, 0] : [w, 0];
      b.translate(off[0]!, y + step / 2, off[1]!);
      parts.push(b);
    }
  }
  return mergeGeometries(parts.map((p) => p.toNonIndexed())) ?? new BoxGeometry(0.2, height, 0.2);
}

const beamVert = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vView;
varying float vDist;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vView = normalize(cameraPosition - wp.xyz);
  vDist = distance(cameraPosition, wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const beamFrag = /* glsl */ `
uniform sampler2D map;
uniform vec3 color;
uniform float opacity;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vView;
varying float vDist;
void main() {
  float edge = pow(abs(dot(vN, vView)), 2.2);
  float fall = texture2D(map, vec2(0.5, 1.0 - vUv.y)).a;
  float near = smoothstep(3.0, 16.0, vDist);
  gl_FragColor = vec4(color, edge * fall * near * opacity);
}`;


function beamMaterial(color: string, opacity: number) {
  return new ShaderMaterial({
    uniforms: { map: { value: beamGradient() }, color: { value: new Color(color) }, opacity: { value: opacity } },
    vertexShader: beamVert,
    fragmentShader: beamFrag,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
}

interface ArenaScene {
  root: Group;
  update: (t: number, dt: number) => void;
  dispose: () => void;
}

/** Builds the whole static arena + animated hazard parts as one scene graph. */
function buildArena(layout: HazardLayout, tier: TierSettings): ArenaScene {
  const root = new Group();
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => {
    disposables.push(x);
    return x;
  };

  // Floor.
  const detail = floorDetail();
  detail.normal.repeat.set(10, 10);
  detail.roughness.repeat.set(10, 10);
  const floorMat = keep(
    new MeshStandardMaterial({
      map: floorAlbedo(layout),
      normalMap: detail.normal,
      normalScale: new Vector2(0.8, 0.8),
      roughnessMap: detail.roughness,
      roughness: 0.9,
      metalness: 0.7,
      envMapIntensity: 0.32,
    }),
  );
  const floor = new Mesh(keep(floorGeometry()), floorMat);
  floor.receiveShadow = true;
  root.add(floor);

  // Outer apron beyond the walls (so the camera never sees a void).
  const apronShape = new Shape();
  apronShape.moveTo(-70, -70);
  apronShape.lineTo(70, -70);
  apronShape.lineTo(70, 70);
  apronShape.lineTo(-70, 70);
  apronShape.closePath();
  const apronHole = new Shape();
  apronHole.moveTo(-H, -H);
  apronHole.lineTo(-H, H);
  apronHole.lineTo(H, H);
  apronHole.lineTo(H, -H);
  apronHole.closePath();
  apronShape.holes.push(apronHole);
  const apron = new Mesh(keep(new ShapeGeometry(apronShape).rotateX(-Math.PI / 2)), keep(new MeshStandardMaterial({ color: "#0c0e12", roughness: 0.9 })));
  apron.position.y = -0.02;
  apron.receiveShadow = true;
  root.add(apron);

  // KO pit: dark walls, glowing rim, hot bottom.
  const pitWall = keep(new MeshStandardMaterial({ color: "#1b1d22", roughness: 0.6, metalness: 0.8, normalMap: brushedSteel().normal }));
  const rimMat = keep(new MeshBasicMaterial({ color: new Color("#ff5a1f").multiplyScalar(6), toneMapped: false }));
  const stripMat = keep(new MeshBasicMaterial({ color: new Color("#ff3b0a").multiplyScalar(2.5), toneMapped: false }));
  for (const [x, z, ry] of [
    [P.x - P.half, P.z, 0],
    [P.x + P.half, P.z, 0],
    [P.x, P.z - P.half, Math.PI / 2],
    [P.x, P.z + P.half, Math.PI / 2],
  ] as const) {
    const w = new Mesh(keep(new BoxGeometry(0.3, 8, P.half * 2 + 0.3)), pitWall);
    w.position.set(x + (ry ? 0 : Math.sign(x - P.x) * 0.15), -4, z + (ry ? Math.sign(z - P.z) * 0.15 : 0));
    w.rotation.y = ry;
    root.add(w);
    const rim = new Mesh(keep(new BoxGeometry(0.14, 0.05, P.half * 2 + 0.3)), rimMat);
    rim.position.set(x - (ry ? 0 : Math.sign(x - P.x) * 0.07), 0.02, z - (ry ? Math.sign(z - P.z) * 0.07 : 0));
    rim.rotation.y = ry;
    root.add(rim);
    for (let i = 0; i < 5; i++) {
      const s = new Mesh(keep(new BoxGeometry(0.02, 0.06, P.half * 2)), stripMat);
      s.position.set(x - (ry ? 0 : Math.sign(x - P.x) * 0.02), -0.6 - i * 1.2, z - (ry ? Math.sign(z - P.z) * 0.02 : 0));
      s.rotation.y = ry;
      root.add(s);
    }
  }
  const pitBottom = new Mesh(keep(new PlaneGeometry(P.half * 2, P.half * 2).rotateX(-Math.PI / 2)), keep(new MeshBasicMaterial({ color: new Color("#ff3000").multiplyScalar(1.3), toneMapped: false })));
  pitBottom.position.set(P.x, -7.9, P.z);
  root.add(pitBottom);
  const pitHaze = new Mesh(
    keep(new PlaneGeometry(P.half * 2.6, P.half * 2.6).rotateX(-Math.PI / 2)),
    keep(new MeshBasicMaterial({ color: new Color("#ff4a10").multiplyScalar(0.9), map: softDot(), transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false })),
  );
  pitHaze.position.set(P.x, -1.2, P.z);
  root.add(pitHaze);

  // Walls: kick plate, posts, glass, LED rail.
  const kickMat = keep(new MeshStandardMaterial({ map: hazardStripes(), roughness: 0.7, metalness: 0.3 }));
  (kickMat.map as Texture).repeat.set(20, 1);
  const postMat = keep(new MeshStandardMaterial({ color: "#2b3039", roughness: 0.45, metalness: 0.9, normalMap: brushedSteel().normal }));
  const glassMat = keep(
    new MeshPhysicalMaterial({
      color: "#9fb6d8",
      transparent: true,
      opacity: 0.12,
      roughness: 0.08,
      metalness: 0.1,
      roughnessMap: glassSmudge(),
      envMapIntensity: 1.4,
      depthWrite: false,
      side: DoubleSide,
    }),
  );
  const railMat = keep(new MeshStandardMaterial({ color: "#16191f", roughness: 0.5, metalness: 0.8 }));
  const led = ledBanner("WEDGE WARS  ·  LAST TRUCK STANDING", "#c6ff3d");
  led.repeat.set(4, 1);
  const ledMat = keep(new MeshBasicMaterial({ map: led, color: new Color(2.2, 2.2, 2.2), toneMapped: false }));
  const edgeLight = keep(new MeshBasicMaterial({ color: new Color("#6fa8ff").multiplyScalar(3), toneMapped: false }));
  const glassH = 3.3;
  for (let side = 0; side < 4; side++) {
    const g = new Group();
    g.rotation.y = (side * Math.PI) / 2;
    const len = H * 2 + 1.2;
    const kick = new Mesh(keep(new BoxGeometry(len, 1, 0.5)), kickMat);
    kick.position.set(0, 0.5, -H - 0.25);
    kick.receiveShadow = true;
    kick.castShadow = true;
    g.add(kick);
    const glass = new Mesh(keep(new PlaneGeometry(len, glassH)), glassMat);
    glass.position.set(0, 1 + glassH / 2, -H - 0.3);
    glass.renderOrder = 6;
    g.add(glass);
    const rail = new Mesh(keep(new BoxGeometry(len, 0.3, 0.55)), railMat);
    rail.position.set(0, 1 + glassH + 0.15, -H - 0.3);
    rail.castShadow = true;
    g.add(rail);
    const ticker = new Mesh(keep(new PlaneGeometry(len, 0.22)), ledMat);
    ticker.position.set(0, 1 + glassH + 0.15, -H - 0.02);
    g.add(ticker);
    const strip = new Mesh(keep(new BoxGeometry(len, 0.04, 0.04)), edgeLight);
    strip.position.set(0, 1.02, -H + 0.01);
    g.add(strip);
    for (let i = 0; i <= 8; i++) {
      const post = new Mesh(keep(new BoxGeometry(0.28, glassH + 1.4, 0.4)), postMat);
      post.position.set(-H + i * (H / 4), (glassH + 1.4) / 2, -H - 0.35);
      post.castShadow = true;
      g.add(post);
    }
    root.add(g);
  }

  // Corner beacons (amber, blink).
  const beaconMat = keep(new MeshBasicMaterial({ color: new Color("#ffae1a").multiplyScalar(5), toneMapped: false }));
  const beacons: Mesh[] = [];
  for (const [x, z] of [
    [-H, -H],
    [H, -H],
    [H, H],
    [-H, H],
  ] as const) {
    const b = new Mesh(keep(new CylinderGeometry(0.16, 0.16, 0.28, 12)), beaconMat);
    b.position.set(x, 1 + glassH + 0.5, z);
    root.add(b);
    beacons.push(b);
  }

  // Light towers at the corners + volumetric beams + overhead truss ring.
  const trussMat = keep(new MeshStandardMaterial({ color: "#20242b", roughness: 0.6, metalness: 0.8 }));
  const lampMat = keep(new MeshBasicMaterial({ color: new Color("#fff6e8").multiplyScalar(9), toneMapped: false }));
  const housingMat = keep(new MeshStandardMaterial({ color: "#111318", roughness: 0.5, metalness: 0.7 }));
  const beamMat = tier.beams ? keep(beamMaterial("#fff1dc", 0.05)) : null;
  const truss = keep(trussGeometry(19, 0.4));
  for (const [x, z] of [
    [-H - 3.5, -H - 3.5],
    [H + 3.5, -H - 3.5],
    [H + 3.5, H + 3.5],
    [-H - 3.5, H + 3.5],
  ] as const) {
    const tower = new Mesh(truss, trussMat);
    tower.position.set(x, 0, z);
    root.add(tower);
    const head = new Group();
    head.position.set(x * 0.97, 19.5, z * 0.97);
    head.lookAt(new Vector3(0, 0, 0));
    const housing = new Mesh(keep(new BoxGeometry(3.2, 1.8, 0.5)), housingMat);
    head.add(housing);
    for (let i = 0; i < 6; i++) {
      const lamp = new Mesh(keep(new PlaneGeometry(0.85, 0.7)), lampMat);
      lamp.position.set(-1.05 + (i % 3) * 1.05, i < 3 ? 0.42 : -0.42, 0.26);
      head.add(lamp);
    }
    root.add(head);
    if (beamMat) {
      const from = new Vector3(x * 0.97, 19.5, z * 0.97);
      const to = new Vector3(x * 0.14, 0, z * 0.14);
      const len = from.distanceTo(to);
      const cone = new Mesh(keep(new CylinderGeometry(0.9, 6.5, len, 28, 1, true).translate(0, -len / 2, 0)), beamMat);
      cone.position.copy(from);
      cone.quaternion.setFromUnitVectors(new Vector3(0, -1, 0), to.clone().sub(from).normalize());
      cone.renderOrder = 8;
      root.add(cone);
    }
  }
  // Overhead truss ring + scoreboard cube.
  const ring = new Group();
  ring.position.y = 21;
  for (let side = 0; side < 4; side++) {
    const beam = new Mesh(keep(new BoxGeometry(26, 0.8, 0.8)), trussMat);
    beam.rotation.y = (side * Math.PI) / 2;
    beam.position.set(side === 1 ? 13 : side === 3 ? -13 : 0, 0, side === 0 ? -13 : side === 2 ? 13 : 0);
    if (side % 2) beam.rotation.y = Math.PI / 2;
    ring.add(beam);
    for (let i = -1; i <= 1; i++) {
      const lamp = new Mesh(keep(new PlaneGeometry(1.2, 1.2).rotateX(Math.PI / 2)), lampMat);
      const along = i * 7;
      lamp.position.set(side % 2 ? (side === 1 ? 13 : -13) : along, -0.42, side % 2 ? along : side === 0 ? -13 : 13);
      ring.add(lamp);
    }
  }
  const cube = new Mesh(
    keep(new BoxGeometry(6, 3.2, 6)),
    [housingMat, housingMat, housingMat, housingMat, housingMat, housingMat].map((m, i) =>
      i === 2 || i === 3 ? m : keep(new MeshBasicMaterial({ map: ledBanner("WEDGE WARS", "#ff5a1f"), color: new Color(1.8, 1.8, 1.8), toneMapped: false })),
    ),
  );
  cube.position.y = -3.5;
  ring.add(cube);
  root.add(ring);

  // Stands + crowd.
  const standMat = keep(new MeshStandardMaterial({ color: "#0d0f13", roughness: 0.9, envMapIntensity: 0.2 }));
  let crowd: InstancedMesh | null = null;
  const crowdMat = keep(new MeshStandardMaterial({ roughness: 0.8, metalness: 0, envMapIntensity: 0.25 }));
  const shaderTime = { value: 0 };
  crowdMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shaderTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nfloat seed = float(gl_InstanceID);\ntransformed.y += max(0.0, sin(uTime * (3.0 + mod(seed, 5.0)) + seed * 1.7)) * 0.12;",
      );
  };
  const seats: Matrix4[] = [];
  const colors: Color[] = [];
  const palette = ["#1c2029", "#241d22", "#1a2127", "#26251d", "#2b1f25", "#1c261f", "#20242e", "#6a8a2a", "#8a3a1a", "#1f5a74"];
  let seed = 3;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let side = 0; side < 4; side++) {
    const g = new Group();
    g.rotation.y = (side * Math.PI) / 2;
    for (let tierIdx = 0; tierIdx < 6; tierIdx++) {
      const step = new Mesh(keep(new BoxGeometry(H * 2 + 12, 0.9, 1.4)), standMat);
      step.position.set(0, 0.45 + tierIdx * 0.9, -H - 3 - tierIdx * 1.4);
      step.scale.y = 1 + tierIdx * 0.02;
      step.receiveShadow = true;
      g.add(step);
      if (tier.crowd) {
        for (let i = 0; i < 44; i++) {
          if (rnd() < 0.22) continue;
          const m = new Matrix4();
          const o = new Object3D();
          o.position.set(-H - 4 + i * ((H * 2 + 8) / 44) + (rnd() - 0.5) * 0.4, 0.9 + tierIdx * 0.9 + 0.45, -H - 3 - tierIdx * 1.4);
          o.rotation.y = (rnd() - 0.5) * 0.4;
          o.scale.set(0.9 + rnd() * 0.3, 0.8 + rnd() * 0.4, 1);
          o.updateMatrix();
          g.updateMatrix();
          m.multiplyMatrices(g.matrix, o.matrix);
          seats.push(m);
          const c = palette[Math.floor(rnd() * palette.length)]!;
          colors.push(new Color(c));
        }
      }
    }
    root.add(g);
  }
  if (tier.crowd && seats.length) {
    const body = keep(
      mergeGeometries([
        new BoxGeometry(0.44, 0.52, 0.26).translate(0, -0.12, 0).toNonIndexed(),
        new SphereGeometry(0.13, 10, 8).translate(0, 0.3, 0).toNonIndexed(),
      ]) ?? new BoxGeometry(0.42, 0.9, 0.3),
    );
    crowd = new InstancedMesh(body, crowdMat, seats.length);
    seats.forEach((m, i) => {
      crowd!.setMatrixAt(i, m);
      crowd!.setColorAt(i, colors[i]!);
    });
    crowd.instanceMatrix.needsUpdate = true;
    root.add(crowd);
  }

  // Hazards: saws.
  const bladeGeo = keep(sawBladeGeometry());
  const bladeMat = keep(new MeshStandardMaterial({ color: "#dfe4ea", roughness: 0.18, metalness: 1, envMapIntensity: 1.5 }));
  const slotMat = keep(new MeshStandardMaterial({ color: "#050506", roughness: 0.9 }));
  const slotGlow = keep(new MeshBasicMaterial({ color: new Color("#ff2a1a").multiplyScalar(3), toneMapped: false }));
  const saws: { blade: Mesh; phase: number }[] = [];
  for (const s of layout.saws) {
    const slot = new Mesh(keep(new BoxGeometry(2.3, 0.02, 0.2)), slotMat);
    slot.position.set(s.x, 0.011, s.z);
    root.add(slot);
    for (const dz of [-0.13, 0.13]) {
      const glow = new Mesh(keep(new BoxGeometry(2.3, 0.02, 0.03)), slotGlow);
      glow.position.set(s.x, 0.012, s.z + dz);
      root.add(glow);
    }
    const blade = new Mesh(bladeGeo, bladeMat);
    blade.position.set(s.x, -1, s.z);
    blade.castShadow = true;
    root.add(blade);
    saws.push({ blade, phase: s.phase });
  }

  // Vents: grate + glow underneath.
  const grateMat = keep(new MeshStandardMaterial({ color: "#1c1f25", roughness: 0.5, metalness: 0.9 }));
  const vents: { glow: MeshBasicMaterial; phase: number }[] = [];
  for (const v of layout.vents) {
    const g = new Group();
    g.position.set(v.x, 0, v.z);
    const glowMat = keep(new MeshBasicMaterial({ color: new Color("#ff4a0a"), toneMapped: false }));
    const under = new Mesh(keep(new PlaneGeometry(2.4, 2.4).rotateX(-Math.PI / 2)), glowMat);
    under.position.y = 0.005;
    g.add(under);
    for (let i = -5; i <= 5; i++) {
      const bar = new Mesh(keep(new BoxGeometry(2.5, 0.06, 0.06)), grateMat);
      bar.position.set(0, 0.03, i * 0.23);
      g.add(bar);
      const bar2 = new Mesh(keep(new BoxGeometry(0.06, 0.06, 2.5)), grateMat);
      bar2.position.set(i * 0.23, 0.03, 0);
      g.add(bar2);
    }
    root.add(g);
    vents.push({ glow: glowMat, phase: v.phase });
  }

  // Pulverizer: gantry + striped head + piston.
  const pv = layout.pulverizer;
  const gantry = new Group();
  gantry.position.set(pv.x, 0, pv.z);
  for (const dz of [-2.9, 2.9]) {
    const post = new Mesh(keep(new BoxGeometry(0.6, 7, 0.6)), postMat);
    post.position.set(0, 3.5, dz);
    post.castShadow = true;
    gantry.add(post);
  }
  const beam = new Mesh(keep(new BoxGeometry(0.9, 0.9, 6.6)), postMat);
  beam.position.set(0, 7.2, 0);
  beam.castShadow = true;
  gantry.add(beam);
  const stripeMat = keep(new MeshStandardMaterial({ map: hazardStripes(), roughness: 0.55, metalness: 0.4 }));
  const head = new Mesh(keep(new BoxGeometry(3.4, 1.2, 3.4)), [stripeMat, stripeMat, postMat, postMat, stripeMat, stripeMat]);
  head.castShadow = true;
  gantry.add(head);
  const piston = new Mesh(keep(new CylinderGeometry(0.28, 0.28, 1, 16)), keep(new MeshStandardMaterial({ color: "#e6eaf0", roughness: 0.15, metalness: 1 })));
  gantry.add(piston);
  const warnMat = keep(new MeshBasicMaterial({ color: new Color("#ff2020").multiplyScalar(4), toneMapped: false }));
  const warn = new Mesh(keep(new BoxGeometry(0.2, 0.2, 0.2)), warnMat);
  warn.position.set(0, 7.75, 0);
  gantry.add(warn);
  root.add(gantry);

  const update = (t: number) => {
    for (const s of saws) {
      const level = sawLevel(t, s.phase);
      s.blade.position.y = -0.95 + level * 1.35;
      s.blade.rotation.z -= 0.6 * (0.3 + level);
      s.blade.visible = level > 0.01;
    }
    for (const v of vents) {
      const st = ventState(t, v.phase);
      const k = st === "fire" ? 5 : st === "warn" ? 1 + Math.sin(t * 30) * 0.8 + 1 : 0.35;
      v.glow.color.setRGB(1 * k, 0.29 * k, 0.04 * k);
    }
    const level = pulverizerLevel(t, pv.phase);
    head.position.y = 0.62 + level * 4.4;
    piston.position.y = (head.position.y + 0.6 + 7.2) / 2;
    piston.scale.y = Math.max(0.1, 7.2 - (head.position.y + 0.6));
    warnMat.color.setScalar(level < 0.99 && level > 0 ? 6 : 0.4).multiply(_red);
    const blink = Math.sin(t * 6) > 0;
    beaconMat.color.setRGB(blink ? 5 : 0.6, blink ? 3.2 : 0.35, blink ? 0.4 : 0.05);
    led.offset.x = (t * 0.05) % 1;
    shaderTime.value = t;
  };

  return {
    root,
    update: (t) => update(t),
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}

const _red = new Color(1, 0.12, 0.1);

export function ArenaVisuals({ layout, tier, clock }: { layout: HazardLayout; tier: TierSettings; clock: () => number }) {
  const arena = useMemo(() => buildArena(layout, tier), [layout, tier]);
  useEffect(() => () => arena.dispose(), [arena]);
  useFrame((_, dt) => arena.update(clock(), dt));
  return <primitive object={arena.root} />;
}

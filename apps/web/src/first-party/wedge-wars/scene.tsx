"use client";

/**
 * The 3D match scene (inside <Canvas>): lighting + a procedural environment
 * (Lightformers, no HDRI download), the physics world with the arena and the
 * trucks, particles, and the post-processing stack for the quality tier.
 */

import { Environment, Lightformer } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { Bloom, DepthOfField, EffectComposer, N8AO, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { BallCollider, CuboidCollider, Physics, RigidBody, useBeforePhysicsStep, useRapier, type RapierRigidBody } from "@react-three/rapier";
import { ToneMappingMode, type DepthOfFieldEffect } from "postprocessing";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { Object3D, PerspectiveCamera, Vector3 } from "three";
import { ArenaColliders, ArenaVisuals, PulverizerBody } from "./arena";
import { ARMORS, FLAG, decodeLoadout, encodeLoadout, spawnFor } from "./logic";
import type { Tier, TierSettings } from "./quality";
import type { MatchRuntime } from "./runtime";
import { TruckRig, WHEELS, WHEEL_RADIUS, WHEEL_Y, healthFraction } from "./truck";
import { Vfx } from "./vfx";
import type { TruckRuntime } from "./world";

/* ---------------------------------------------------------------------- */
/* Lighting                                                               */
/* ---------------------------------------------------------------------- */

/** Arena lighting: warm key with shadows, cool fill, and a studio-like environment for reflections. */
export function ArenaLights({ tier }: { tier: TierSettings }) {
  return (
    <>
      <hemisphereLight args={["#9fb2ff", "#1c140e", 0.22]} />
      <directionalLight
        castShadow={tier.shadows}
        position={[16, 30, 9]}
        intensity={1.35}
        color="#fff1dc"
        shadow-mapSize={[tier.shadowMapSize, tier.shadowMapSize]}
        shadow-camera-left={-25}
        shadow-camera-right={25}
        shadow-camera-top={25}
        shadow-camera-bottom={-25}
        shadow-camera-near={1}
        shadow-camera-far={80}
        shadow-bias={-0.0003}
        shadow-normalBias={0.04}
      />
      <directionalLight position={[-18, 14, -12]} intensity={0.45} color="#6f8dff" />
      <pointLight position={[0, -1.5, 0]} intensity={80} distance={16} decay={2} color="#ff5a1f" />
      {tier.beams && <StadiumSpots />}
      <ArenaEnvironment />
    </>
  );
}

/** Four tower spots (no shadows) throw pools of light across the floor. */
function StadiumSpots() {
  const spots = useMemo(
    () =>
      [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([sx, sz]) => {
        const target = new Object3D();
        target.position.set(sx! * 3, 0, sz! * 3);
        return { position: [sx! * 22.4, 19.5, sz! * 22.4] as [number, number, number], target };
      }),
    [],
  );
  return (
    <>
      {spots.map((s, i) => (
        <group key={i}>
          <primitive object={s.target} />
          <spotLight position={s.position} target={s.target} angle={0.4} penumbra={0.8} intensity={1050} distance={46} decay={2} color="#fff0dc" />
        </group>
      ))}
    </>
  );
}

/** Reflections for the stainless: overhead rig panels, colored rim walls, a warm floor bounce. */
export function ArenaEnvironment() {
  return (
    <Environment resolution={256} frames={1} environmentIntensity={0.8}>
      <color attach="background" args={["#0a0c11"]} />
      {[-7, 0, 7].map((x) => (
        <Lightformer key={x} form="rect" intensity={1.5} color="#ffffff" position={[x, 16, 0]} rotation-x={Math.PI / 2} scale={[1.6, 26, 1]} />
      ))}
      {[
        [-18, 12, -18],
        [18, 12, -18],
        [18, 12, 18],
        [-18, 12, 18],
      ].map((p, i) => (
        <Lightformer key={i} form="rect" intensity={4} color="#fff3e0" position={p as [number, number, number]} scale={[6, 2.4, 1]} target={[0, 0, 0]} />
      ))}
      <Lightformer form="rect" intensity={2.2} color="#3d6bff" position={[-30, 4, 0]} rotation-y={Math.PI / 2} scale={[40, 5, 1]} />
      <Lightformer form="rect" intensity={2.4} color="#ff6a2a" position={[30, 4, 0]} rotation-y={-Math.PI / 2} scale={[40, 5, 1]} />
      <Lightformer form="rect" intensity={1.2} color="#c6ff3d" position={[0, 3, 30]} rotation-y={Math.PI} scale={[30, 2, 1]} />
      <Lightformer form="rect" intensity={0.5} color="#8a7a66" position={[0, -2, 0]} rotation-x={-Math.PI / 2} scale={[40, 40, 1]} />
    </Environment>
  );
}

/* ---------------------------------------------------------------------- */
/* Scene                                                                  */
/* ---------------------------------------------------------------------- */

export function MatchScene({ rt, tier, tierName }: { rt: MatchRuntime; tier: TierSettings; tierName: Tier }) {
  return (
    <>
      <color attach="background" args={["#05070b"]} />
      <fogExp2 attach="fog" args={["#0b0e15", 0.012]} />
      <ArenaLights tier={tier} />
      <Physics timeStep="vary" paused gravity={[0, -20, 0]}>
        <Loop rt={rt} />
        <ArenaColliders layout={rt.layout} />
        <PulverizerBody layout={rt.layout} clock={rt.clock} />
        {rt.world.trucks.map((t) => (
          <TruckBody key={t.id} rt={rt} truck={t} tierName={tierName} />
        ))}
      </Physics>
      <ArenaVisuals layout={rt.layout} tier={tier} clock={rt.clock} />
      <VfxLayer rt={rt} scale={tier.vfx} />
      {tier.post && <PostFx rt={rt} tier={tier} dof={tierName === "high"} />}
    </>
  );
}

/** Drives the match: physics step (manual, for slow-mo/hit-stop), systems, camera. */
function Loop({ rt }: { rt: MatchRuntime }) {
  const { step, rapier } = useRapier();
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  useBeforePhysicsStep((world) => rt.beforeStep(world, rapier.Ray));
  // The clock starts once physics is live (the WASM engine may take a moment).
  useEffect(() => rt.start(performance.now()), [rt]);
  useFrame((_, delta) => {
    rt.frame(delta, step, camera as PerspectiveCamera, size.width, size.height);
  });
  return null;
}

/* ---------------------------------------------------------------------- */
/* Trucks                                                                 */
/* ---------------------------------------------------------------------- */

function TruckBody({ rt, truck, tierName }: { rt: MatchRuntime; truck: TruckRuntime; tierName: Tier }) {
  // Re-render only when this truck's loadout becomes known/changes.
  const code = useSyncExternalStore(
    rt.world.subscribe,
    () => encodeLoadout(truck.loadout),
    () => encodeLoadout(truck.loadout),
  );
  const loadout = useMemo(() => decodeLoadout(code), [code]);
  const rig = useMemo(() => new TruckRig({ loadout, number: truck.seat + 1, quality: tierName }), [loadout, truck.seat, tierName]);
  useEffect(() => () => rig.dispose(), [rig]);
  const body = useRef<RapierRigidBody>(null);
  useEffect(() => {
    rt.setBody(truck.id, body.current);
    return () => rt.setBody(truck.id, null);
  }, [rt, truck.id]);
  const spawn = useMemo(() => spawnFor(truck.seat), [truck.seat]);
  const mass = ARMORS[loadout.armor].mass;
  const massProps = useMemo(
    () => ({
      mass,
      centerOfMass: { x: 0, y: -0.28, z: 0.05 },
      principalAngularInertia: { x: 1.0 * mass, y: 1.15 * mass, z: 0.55 * mass },
      angularInertiaLocalFrame: { x: 0, y: 0, z: 0, w: 1 },
    }),
    [mass],
  );
  const prev = useRef({ speed: 0, yaw: 0, anim: 0 });

  useFrame((_, delta) => {
    const dt = Math.min(0.05, delta) * rt.world.timeScale;
    const p = prev.current;
    const accelLong = dt > 0 ? (truck.speed - p.speed) / dt : 0;
    let dyaw = truck.yaw - p.yaw;
    if (dyaw > Math.PI) dyaw -= Math.PI * 2;
    if (dyaw < -Math.PI) dyaw += Math.PI * 2;
    const yawRate = dt > 0 ? dyaw / dt : 0;
    p.speed = truck.speed;
    p.yaw = truck.yaw;
    const remote = !truck.local;
    const netWeapon = truck.net.weapon;
    const kind = truck.loadout.weapon;
    // Remote strokes are smoothed from 15 Hz samples.
    const targetAnim = remote ? (kind === "spinner" || kind === "flamer" ? 0 : netWeapon) : truck.anim;
    p.anim += (targetAnim - p.anim) * (remote ? Math.min(1, dt * 18) : 1);
    rig.update(
      {
        dt,
        time: performance.now() / 1000,
        speed: truck.speed,
        steer: remote ? Math.max(-1, Math.min(1, -yawRate / 2.5)) : truck.input.steer,
        grounded: truck.grounded,
        accelLong,
        accelLat: yawRate * truck.speed,
        weaponAnim: p.anim,
        spin: kind === "spinner" ? (remote ? netWeapon : truck.spin) : 0,
        firing: remote ? !!(truck.net.flags & FLAG.firing) : truck.firing,
        boosting: remote ? !!(truck.net.flags & FLAG.boost) : truck.boosting,
        health: healthFraction(truck.hp, truck.armor, truck.loadout),
        scorch: truck.scorch,
        alive: truck.alive,
      },
      (x, y, z, color) => {
        rt.world.hooks.debris?.(x, y, z, 1, color);
        rt.world.hooks.debris?.(x, y, z, 0.8, color);
        rt.world.hooks.sparks?.(x, y, z, 0, 1, 0, 0.5);
      },
    );
    rig.applyDents(truck.dents);
  });

  return (
    <RigidBody
      ref={body}
      colliders={false}
      position={[spawn.x, 0.66, spawn.z]}
      rotation={[0, spawn.yaw, 0]}
      userData={{ truckId: truck.id }}
      linearDamping={0.12}
      angularDamping={1.3}
      canSleep={false}
      ccd
      onCollisionEnter={(e) => rt.collide(truck.id, e.other.rigidBodyObject?.userData as { truckId?: string; wall?: boolean } | undefined, performance.now())}
    >
      <CuboidCollider args={[0.8, 0.3, 1.4]} position={[0, 0.08, 0.02]} massProperties={massProps} friction={0.45} restitution={0.15} />
      <CuboidCollider args={[0.55, 0.2, 0.62]} position={[0, 0.55, -0.3]} density={0} friction={0.45} restitution={0.1} />
      {WHEELS.map((w, i) => (
        <BallCollider key={i} args={[WHEEL_RADIUS]} position={[w.x * 0.96, WHEEL_Y, w.z]} density={0} friction={0} restitution={0.05} />
      ))}
      <primitive object={rig.root} />
    </RigidBody>
  );
}

/* ---------------------------------------------------------------------- */
/* Effects                                                                */
/* ---------------------------------------------------------------------- */

function VfxLayer({ rt, scale }: { rt: MatchRuntime; scale: number }) {
  const vfx = useMemo(() => new Vfx({ scale }), [scale]);
  useEffect(() => {
    rt.setVfx(vfx);
    return () => {
      rt.setVfx(null);
      vfx.dispose();
    };
  }, [rt, vfx]);
  return (
    <>
      {vfx.objects.map((o) => (
        <primitive key={o.uuid} object={o} />
      ))}
    </>
  );
}

function PostFx({ rt, tier, dof }: { rt: MatchRuntime; tier: TierSettings; dof: boolean }) {
  const dofRef = useRef<DepthOfFieldEffect>(null);
  const target = useMemo(() => new Vector3(), []);
  useFrame(() => {
    const d = dofRef.current;
    if (!d) return;
    target.copy(rt.camera.look);
    d.target = target;
    d.bokehScale = rt.camera.koBlend * 6;
  });
  return (
    <EffectComposer multisampling={tier.smaa ? 0 : 4} enableNormalPass={false}>
      {tier.ao ? <N8AO aoRadius={1.4} distanceFalloff={0.6} intensity={2.4} quality="performance" halfRes /> : <></>}
      {tier.bloom ? <Bloom mipmapBlur luminanceThreshold={1} luminanceSmoothing={0.25} intensity={0.85} radius={0.72} /> : <></>}
      {dof ? <DepthOfField ref={dofRef} focusRange={4} bokehScale={0} worldFocusRange={5} /> : <></>}
      <ToneMapping mode={ToneMappingMode.AGX} />
      {tier.smaa ? <SMAA /> : <></>}
      <Vignette offset={0.3} darkness={0.55} />
    </EffectComposer>
  );
}

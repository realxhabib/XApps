"use client";

/**
 * The garage: your wedge truck on a lit turntable, a weapon / armor / paint
 * picker with stat bars, the table's roster, and the ready button. Weapons
 * demo themselves on the turntable (spin-ups, flips, swings, flames).
 */

import type { PlayerInfo } from "@xapps/sdk";
import { Environment, Lightformer } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { motion, useReducedMotion } from "motion/react";
import { Check, Gauge, Shield, Swords } from "lucide-react";
import { ToneMappingMode } from "postprocessing";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { AgXToneMapping, Color, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Vector3 } from "three";
import { Avatar } from "@/components/ui/avatar";
import { AnimatedDots } from "@/first-party/shared/ui";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { WEAPON_ICON } from "./hud";
import { ARMORS, ARMOR_ORDER, PAINTS, WEAPONS, WEAPON_ORDER, loadoutStats, type Loadout } from "./logic";
import { TIERS, detectTier, loadPref, type Tier } from "./quality";
import { softDot, studioFloor } from "./textures";
import { FLAME_NOZZLES, TruckRig } from "./truck";
import { Vfx } from "./vfx";

/* ---------------------------------------------------------------------- */
/* 3D turntable                                                           */
/* ---------------------------------------------------------------------- */

function Turntable({ loadout, tier, number, reduce }: { loadout: Loadout; tier: Tier; number: number; reduce: boolean }) {
  const rig = useMemo(() => new TruckRig({ loadout, number, quality: tier, showroom: true }), [loadout, number, tier]);
  useEffect(() => () => rig.dispose(), [rig]);
  const paint = PAINTS[loadout.paint]?.hex ?? "#c6ff3d";
  const stage = useMemo(() => {
    const g = new Group();
    const deck = new Mesh(new CylinderGeometry(2.7, 2.8, 0.14, 64), new MeshStandardMaterial({ color: "#1a1d23", roughness: 0.35, metalness: 0.85 }));
    deck.position.y = -0.07;
    deck.receiveShadow = true;
    g.add(deck);
    const ringMat = new MeshBasicMaterial({ color: new Color(paint).multiplyScalar(3), toneMapped: false });
    const ring = new Mesh(new CylinderGeometry(2.82, 2.82, 0.03, 64, 1, true), ringMat);
    ring.position.y = -0.03;
    g.add(ring);
    const floorTex = studioFloor();
    floorTex.repeat.set(6, 6);
    const floor = new Mesh(new PlaneGeometry(60, 60).rotateX(-Math.PI / 2), new MeshStandardMaterial({ map: floorTex, roughness: 0.32, metalness: 0.4, envMapIntensity: 0.6 }));
    floor.position.y = -0.14;
    floor.receiveShadow = true;
    g.add(floor);
    return { group: g, ringMat };
  }, [paint]);
  useEffect(
    () => () =>
      stage.group.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          (m.material as MeshStandardMaterial).dispose();
        }
      }),
    [stage],
  );
  const vfx = useMemo(() => new Vfx({ scale: 0.5 }), []);
  useEffect(() => () => vfx.dispose(), [vfx]);
  const spinnerRef = useRef<Group>(null);
  const shadowTex = useMemo(() => softDot(), []);
  const tmp = useMemo(() => new Vector3(), []);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const dt = Math.min(0.05, delta);
    const spinner = spinnerRef.current;
    if (!spinner) return;
    spinner.rotation.y = reduce ? -0.6 : t * 0.35 - 0.6;
    // Weapon demo on a 3.2 s loop.
    const k = t % 3.2;
    let anim = 0;
    let spin = 0.3;
    let firing = false;
    if (loadout.weapon === "spinner") spin = k < 1.8 ? Math.min(1, 0.3 + k * 0.6) : Math.max(0.3, 1 - (k - 1.8));
    if (loadout.weapon === "flipper") anim = k < 0.1 ? k / 0.1 : k < 0.3 ? 1 : k < 0.8 ? 1 - (k - 0.3) / 0.5 : 0;
    if (loadout.weapon === "hammer") anim = k < 0.1 ? -k : k < 0.23 ? -0.1 + ((k - 0.1) / 0.13) * 1.1 : k < 0.45 ? 1 : k < 1.05 ? 1 - (k - 0.45) / 0.6 : 0;
    if (loadout.weapon === "flamer") firing = k > 1.2 && k < 2.4;
    rig.update({
      dt,
      time: t,
      speed: 0,
      steer: Math.sin(t * 0.7) * 0.4,
      grounded: true,
      accelLong: 0,
      accelLat: 0,
      weaponAnim: anim,
      spin,
      firing,
      boosting: false,
      health: 1,
      scorch: 0,
      alive: true,
    });
    if (firing) {
      const yaw = spinner.rotation.y;
      for (const n of FLAME_NOZZLES) {
        rig.localToWorld(n.x, n.y, n.z, tmp);
        vfx.flame(tmp.x, tmp.y, tmp.z, Math.sin(yaw), 0.05, Math.cos(yaw), 0, 0, 0, 2);
      }
    }
    if (loadout.weapon === "hammer" && k >= 0.22 && k - dt < 0.22) {
      rig.localToWorld(0, -0.5, 2.1, tmp);
      vfx.sparksAt(tmp.x, 0.02, tmp.z, 0, 1, 0, 0.7);
    }
    vfx.update(dt);
  });

  return (
    <>
      <primitive object={stage.group} />
      <group ref={spinnerRef}>
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.004, 0.1]} renderOrder={1}>
          <planeGeometry args={[3.4, 4.6]} />
          <meshBasicMaterial color="#000000" map={shadowTex} transparent opacity={0.85} depthWrite={false} />
        </mesh>
        <group position={[0, 0.63, 0]}>
          <primitive object={rig.root} />
        </group>
      </group>
      {vfx.objects.map((o) => (
        <primitive key={o.uuid} object={o} />
      ))}
    </>
  );
}

/** Frames the truck for the canvas' aspect (portrait phones sit further back). */
function GarageCamera() {
  const camera = useThree((s) => s.camera);
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  useEffect(() => {
    const dist = aspect < 0.8 ? 14.5 : aspect < 1.2 ? 12 : 10.2;
    const dir = new Vector3(0.62, 0.3, 0.72).normalize();
    camera.position.copy(dir.multiplyScalar(dist)).add(new Vector3(0, 0.4, 0));
    camera.lookAt(0, 0.55, 0);
    camera.updateProjectionMatrix();
  }, [camera, aspect]);
  return null;
}

function GarageScene({ loadout, tier, number, reduce }: { loadout: Loadout; tier: Tier; number: number; reduce: boolean }) {
  const settings = TIERS[tier];
  return (
    <>
      <GarageCamera />
      <color attach="background" args={["#07090d"]} />
      <fog attach="fog" args={["#07090d", 9, 26]} />
      <hemisphereLight args={["#c9d6ff", "#20160f", 0.3]} />
      <spotLight position={[3, 9, 4]} angle={0.5} penumbra={0.9} intensity={90} color="#fff4e8" />
      <pointLight position={[-4, 1.5, -3]} intensity={16} color={PAINTS[loadout.paint]?.hex ?? "#fff"} distance={10} />
      <Environment resolution={256} frames={1}>
        <color attach="background" args={["#08090c"]} />
        <Lightformer form="rect" intensity={4} position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[3, 9, 1]} />
        <Lightformer form="rect" intensity={2.2} position={[0, 3, 7]} rotation-y={Math.PI} scale={[12, 3.5, 1]} />
        <Lightformer form="rect" intensity={1.4} position={[0, 3, -7]} scale={[12, 3.5, 1]} />
        <Lightformer form="rect" intensity={2.6} position={[-7, 2, 1]} rotation-y={Math.PI / 2} scale={[12, 1.4, 1]} />
        <Lightformer form="rect" intensity={2.6} position={[7, 2, -1]} rotation-y={-Math.PI / 2} scale={[12, 1.4, 1]} />
        <Lightformer form="rect" intensity={1.8} color="#6f8dff" position={[-5, 1.2, -6]} scale={[8, 1.6, 1]} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={1.8} color="#ff7a3a" position={[5, 1, 6]} scale={[8, 1.2, 1]} target={[0, 0, 0]} />
        <Lightformer form="ring" intensity={2.5} position={[4, 5, 5]} scale={2.2} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={0.6} color="#9a8c78" position={[0, -1, 0]} rotation-x={-Math.PI / 2} scale={[20, 20, 1]} />
      </Environment>
      <Turntable loadout={loadout} tier={tier} number={number} reduce={reduce} />
      {settings.post ? (
        <EffectComposer multisampling={settings.smaa ? 0 : 4}>
          <Bloom mipmapBlur luminanceThreshold={1} intensity={0.9} radius={0.7} />
          <ToneMapping mode={ToneMappingMode.AGX} />
          {settings.smaa ? <SMAA /> : <></>}
          <Vignette offset={0.25} darkness={0.7} />
        </EffectComposer>
      ) : null}
    </>
  );
}

/* ---------------------------------------------------------------------- */
/* Garage UI                                                              */
/* ---------------------------------------------------------------------- */

export function Garage({
  loadout,
  onChange,
  onReady,
  locked,
  players,
  me,
  autoReadyIn,
}: {
  loadout: Loadout;
  onChange: (l: Loadout) => void;
  onReady: () => void;
  locked: boolean;
  players: PlayerInfo[];
  me: PlayerInfo;
  autoReadyIn: number | null;
}) {
  const reduce = !!useReducedMotion();
  const [tier] = useState<Tier>(() => {
    const p = loadPref();
    return p === "auto" ? detectTier() : p;
  });
  // Warm up the physics engine while the player shops (the match needs it instantly).
  useEffect(() => {
    import("@dimforge/rapier3d-compat").then((r) => r.init()).catch(() => {});
  }, []);
  const stats = loadoutStats(loadout);
  const number = me.seat + 1;
  const weapon = WEAPONS[loadout.weapon];

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden lg:flex-row">
      <div className="relative min-h-0 flex-1">
        <Canvas
          shadows="percentage"
          dpr={TIERS[tier].dpr}
          gl={{ antialias: !TIERS[tier].post, stencil: false }}
          camera={{ position: [7, 3.1, 8.2], fov: 32, near: 0.1, far: 80 }}
          onCreated={({ gl }) => {
            gl.toneMapping = AgXToneMapping;
          }}
        >
          <Suspense fallback={null}>
            <GarageScene loadout={loadout} tier={tier} number={number} reduce={reduce} />
          </Suspense>
        </Canvas>
        <div className="pointer-events-none absolute left-4 top-[max(0.9rem,env(safe-area-inset-top))] sm:left-6">
          <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="text-[10px] font-bold uppercase tracking-[0.3em] text-ink-300">
            Garage · truck #{number}
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring.soft, delay: 0.05 }}
            className="font-display text-4xl font-extrabold italic tracking-tight sm:text-5xl"
          >
            Wedge{" "}
            <span className="bg-[linear-gradient(100deg,var(--accent-from),var(--accent-to))] bg-clip-text pr-1 text-transparent">Wars</span>
          </motion.h1>
          <p className="mt-1 max-w-xs text-xs text-ink-300 sm:text-sm">{weapon.blurb}</p>
        </div>
        <div className="pointer-events-none absolute bottom-3 left-4 hidden gap-2 sm:flex">
          {players.map((p) => (
            <div key={p.id} className={cn("glass flex items-center gap-1.5 rounded-full py-1 pl-1 pr-3 text-xs", p.id === me.id && "ring-1 ring-[var(--accent-from)]")}>
              <Avatar person={p} size={22} />
              <span className="max-w-24 truncate font-semibold">{p.id === me.id ? "You" : p.isBot ? p.name : `@${p.handle}`}</span>
            </div>
          ))}
        </div>
      </div>

      <motion.aside
        initial={{ opacity: 0, x: 30 }}
        animate={{ opacity: 1, x: 0 }}
        transition={spring.soft}
        className="relative z-10 flex max-h-[58dvh] w-full shrink-0 flex-col gap-3 overflow-y-auto border-t border-white/10 bg-ink-950/85 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-xl lg:max-h-none lg:w-[380px] lg:border-l lg:border-t-0 lg:p-6"
      >
        <Section title="Weapon">
          <div className="grid grid-cols-4 gap-2 lg:grid-cols-2">
            {WEAPON_ORDER.map((id) => {
              const w = WEAPONS[id];
              const Icon = WEAPON_ICON[id];
              const on = loadout.weapon === id;
              return (
                <motion.button
                  key={id}
                  type="button"
                  whileTap={{ scale: 0.95 }}
                  disabled={locked}
                  onClick={() => onChange({ ...loadout, weapon: id })}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-2xl border px-1 py-2.5 text-center transition lg:items-start lg:px-3 lg:text-left",
                    on ? "border-[var(--accent-from)] bg-[var(--accent-from)]/10" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.07]",
                    locked && !on && "opacity-40",
                  )}
                >
                  <Icon className={cn("size-5", on ? "text-[var(--accent-from)]" : "text-ink-200")} />
                  <span className="text-[11px] font-bold leading-tight sm:text-xs">{w.name}</span>
                </motion.button>
              );
            })}
          </div>
        </Section>
        <Section title="Armor kit">
          <div className="grid grid-cols-3 gap-1 rounded-2xl bg-white/[0.04] p-1">
            {ARMOR_ORDER.map((id) => (
              <button
                key={id}
                type="button"
                disabled={locked}
                onClick={() => onChange({ ...loadout, armor: id })}
                className={cn(
                  "rounded-xl py-2 text-xs font-bold transition",
                  loadout.armor === id ? "bg-ink-50 text-ink-950" : "text-ink-200 hover:bg-white/5",
                  locked && loadout.armor !== id && "opacity-40",
                )}
              >
                {ARMORS[id].name}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-ink-400">{ARMORS[loadout.armor].blurb}</p>
        </Section>
        <Section title="Paint">
          <div className="flex gap-2">
            {PAINTS.map((p, i) => (
              <button
                key={p.name}
                type="button"
                aria-label={p.name}
                disabled={locked}
                onClick={() => onChange({ ...loadout, paint: i })}
                className={cn(
                  "relative size-8 rounded-full ring-2 ring-offset-2 ring-offset-ink-950 transition",
                  loadout.paint === i ? "ring-white" : "ring-transparent hover:ring-white/30",
                )}
                style={{ background: `radial-gradient(circle at 35% 30%, #fff8, ${p.hex} 45%, #000 140%)`, boxShadow: `0 0 14px ${p.hex}66` }}
              />
            ))}
          </div>
        </Section>
        <div className="grid gap-1.5">
          <StatBar icon={<Gauge className="size-3.5" />} label="Speed" value={stats.speed} />
          <StatBar icon={<Shield className="size-3.5" />} label="Armor" value={stats.armor} />
          <StatBar icon={<Swords className="size-3.5" />} label="Damage" value={stats.damage} />
        </div>
        <motion.button
          type="button"
          whileTap={{ scale: locked ? 1 : 0.96 }}
          onClick={onReady}
          disabled={locked}
          className={cn(
            "mt-1 flex h-14 shrink-0 items-center justify-center gap-2 rounded-full text-base font-extrabold tracking-tight transition",
            locked
              ? "bg-white/10 text-ink-200"
              : "bg-[linear-gradient(120deg,var(--accent-from),var(--accent-to))] text-ink-950 shadow-[0_14px_40px_-12px_var(--accent-to)] hover:brightness-110",
          )}
        >
          {locked ? (
            <>
              <Check className="size-5" /> Locked in — waiting for the arena
              <AnimatedDots />
            </>
          ) : (
            <>Lock in &amp; ready{autoReadyIn !== null && autoReadyIn <= 15 ? ` (${autoReadyIn})` : ""}</>
          )}
        </motion.button>
      </motion.aside>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-ink-400">{title}</p>
      {children}
    </section>
  );
}

function StatBar({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="flex w-20 items-center gap-1.5 text-ink-300">
        {icon}
        {label}
      </span>
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-white/10">
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full bg-[linear-gradient(90deg,var(--accent-from),var(--accent-to))]"
          animate={{ width: `${Math.round(8 + value * 92)}%` }}
          transition={spring.snappy}
        />
      </div>
    </div>
  );
}

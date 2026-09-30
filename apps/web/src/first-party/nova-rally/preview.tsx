"use client";

/**
 * A turntable of the chosen ship for the garage screen: studio lighting,
 * a glowing pad underneath, idling thrusters.
 */

import { useEffect, useRef } from "react";
import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  CircleGeometry,
  Color,
  DirectionalLight,
  Mesh,
  MeshBasicMaterial,
  PMREMGenerator,
  PerspectiveCamera,
  RingGeometry,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { buildShip, type Pilot, type ShipDesign } from "./ships";
import type { Livery } from "./types";

export function ShipPreview({ design, livery, pilot, reduced }: { design: ShipDesign; livery: Livery; pilot: Pilot; reduced: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<{ scene: Scene; swap: (d: ShipDesign, l: Livery, p: Pilot) => void } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(window.matchMedia?.("(pointer: coarse)").matches ? 1.25 : 2, window.devicePixelRatio || 1));
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.outputColorSpace = SRGBColorSpace;
    const scene = new Scene();
    const pmrem = new PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const envTex = pmrem.fromScene(room, 0.04).texture;
    scene.environment = envTex;
    scene.environmentIntensity = 0.7;
    const key = new DirectionalLight("#ffffff", 2.2);
    key.position.set(4, 6, 3);
    const rim = new DirectionalLight("#9fc4ff", 1.6);
    rim.position.set(-5, 3, -4);
    scene.add(key, rim);
    const camera = new PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, 2.9, 6.6);
    camera.lookAt(0, 0.1, 0);

    const padMat = new MeshBasicMaterial({ color: new Color("#ffffff"), transparent: true, opacity: 0.12 });
    const pad = new Mesh(new CircleGeometry(2.1, 48), padMat);
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = -0.35;
    scene.add(pad);
    const ringMat = new MeshBasicMaterial({ color: new Color(livery.glow), transparent: true, opacity: 0.9, blending: AdditiveBlending });
    const ring = new Mesh(new RingGeometry(1.98, 2.1, 64), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.34;
    scene.add(ring);

    let model = buildShip(design, livery, "high", pilot);
    scene.add(model.root);
    const swap = (d: ShipDesign, l: Livery, p: Pilot) => {
      scene.remove(model.root);
      model.dispose();
      model = buildShip(d, l, "high", p);
      scene.add(model.root);
      ringMat.color.set(l.glow);
    };
    stateRef.current = { scene, swap };

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      renderer.setSize(r.width, r.height, false);
      camera.aspect = r.width / Math.max(1, r.height);
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    let raf = 0;
    const t0 = performance.now();
    const loop = (now: number) => {
      const t = (now - t0) / 1000;
      model.root.rotation.y = reduced ? -0.6 : t * 0.6 - 0.6;
      model.root.position.y = Math.sin(t * 2) * 0.06;
      model.setThrottle(0.35 + Math.sin(t * 3) * 0.1, 0, t);
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      model.dispose();
      pad.geometry.dispose();
      padMat.dispose();
      ring.geometry.dispose();
      ringMat.dispose();
      envTex.dispose();
      pmrem.dispose();
      renderer.dispose();
      stateRef.current = null;
    };
    // The model is swapped in place below; the renderer lives for the component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  useEffect(() => {
    stateRef.current?.swap(design, livery, pilot);
  }, [design, livery, pilot]);

  return <canvas ref={canvasRef} className="size-full" />;
}

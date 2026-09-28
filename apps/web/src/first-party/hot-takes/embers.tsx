"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { FIRE_COLORS } from "./theme";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  phase: number;
  sway: number;
  hue: number;
}

type Variant = "embers" | "flames";

const CONFIG: Record<Variant, { rate: number; max: number; life: [number, number]; rise: [number, number]; size: [number, number] }> = {
  // Slow, sparse sparks drifting up the whole stage.
  embers: { rate: 1.3, max: 200, life: [3.5, 8], rise: [22, 70], size: [4, 11] },
  // Dense, short-lived licks rising from the bottom edge of a card.
  flames: { rate: 0.5, max: 280, life: [0.55, 1.3], rise: [70, 170], size: [22, 50] },
};

/**
 * Round glow sprites, one per fire color, rendered once. Embers get a
 * white-hot core (sparks); flames are soft all the way through so
 * overlapping licks blend into one body of fire.
 */
function makeSprites(variant: Variant): HTMLCanvasElement[] {
  return FIRE_COLORS.map((color) => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    if (g) {
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      if (variant === "embers") {
        grad.addColorStop(0, "#fff7e0");
        grad.addColorStop(0.18, color);
        grad.addColorStop(0.45, `${color}66`);
      } else {
        grad.addColorStop(0, `${color}ee`);
        grad.addColorStop(0.35, `${color}88`);
        grad.addColorStop(0.7, `${color}22`);
      }
      grad.addColorStop(1, `${color}00`);
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
    }
    return c;
  });
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);

/**
 * Canvas particle field. `density` (0..1) is eased toward, so changing the
 * spice level ramps the fire up or down instead of popping. Bump `burst` to
 * throw a one-off shower of sparks (slam, win…). Renders nothing for people
 * who prefer reduced motion.
 */
export function EmberField({
  density,
  variant = "embers",
  burst = 0,
  className,
}: {
  density: number;
  variant?: Variant;
  burst?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const densityRef = useRef(density);
  const burstRef = useRef(0);
  const reduce = useReducedMotion();

  useEffect(() => {
    densityRef.current = density;
  }, [density]);

  useEffect(() => {
    if (burst > 0) burstRef.current += variant === "flames" ? 50 : 70;
  }, [burst, variant]);

  useEffect(() => {
    if (reduce) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const cfg = CONFIG[variant];
    const sprites = makeSprites(variant);
    const particles: Particle[] = [];
    let w = 0;
    let h = 0;
    let dpr = 1;
    let current = densityRef.current;
    let spawnDebt = 0;
    let raf = 0;
    let last = performance.now();

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const spawn = (fromBurst: boolean) => {
      const flames = variant === "flames";
      const life = rand(cfg.life[0], cfg.life[1]) * (fromBurst ? 0.8 : 1);
      particles.push({
        x: fromBurst ? w / 2 + rand(-w * 0.35, w * 0.35) : rand(-10, w + 10),
        y: flames ? h + rand(0, 10) : fromBurst ? h * rand(0.55, 1) : h + rand(0, 30),
        vx: fromBurst ? rand(-60, 60) : rand(-6, 6),
        vy: -rand(cfg.rise[0], cfg.rise[1]) * (fromBurst ? 1.9 : 1),
        age: 0,
        life,
        size: rand(cfg.size[0], cfg.size[1]),
        phase: rand(0, Math.PI * 2),
        sway: rand(0.6, 2.2),
        hue: Math.floor(rand(0, flames ? 3 : FIRE_COLORS.length)),
      });
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (document.hidden) return;

      // Ease the density so spice changes feel like a fire catching.
      current += (densityRef.current - current) * Math.min(1, dt * 2.5);
      const perSecond = cfg.rate * current * Math.max(40, w) * (variant === "embers" ? 0.06 : 1);
      spawnDebt += perSecond * dt;
      while (spawnDebt >= 1) {
        spawnDebt -= 1;
        if (particles.length < cfg.max) spawn(false);
      }
      while (burstRef.current > 0) {
        burstRef.current -= 1;
        if (particles.length < cfg.max * 1.5) spawn(true);
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i] as Particle;
        p.age += dt;
        if (p.age >= p.life) {
          particles.splice(i, 1);
          continue;
        }
        const t = p.age / p.life;
        p.vy *= variant === "flames" ? 0.995 : 0.999;
        p.vx *= 0.985;
        p.x += (p.vx + Math.sin(p.phase + p.age * p.sway * 3) * (variant === "flames" ? 14 : 18)) * dt;
        p.y += p.vy * dt;

        let alpha: number;
        let size: number;
        let hue = p.hue;
        if (variant === "flames") {
          // Big and yellow at the base, shrinking and reddening as it rises.
          size = p.size * (1 - t * 0.7);
          alpha = Math.min(1, t * 5) * (1 - t) * 0.7;
          hue = Math.min(FIRE_COLORS.length - 1, p.hue + Math.floor(t * 3));
        } else {
          const flicker = 0.65 + 0.35 * Math.sin(p.age * 11 + p.phase * 5);
          size = p.size * (1 - t * 0.4);
          alpha = Math.min(1, t * 4) * (1 - t) * flicker * 0.9;
        }
        const sprite = sprites[hue] as HTMLCanvasElement;
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.drawImage(sprite, p.x - size / 2, p.y - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [variant, reduce]);

  if (reduce) return null;
  return <canvas ref={canvasRef} aria-hidden className={cn("pointer-events-none block", className)} />;
}

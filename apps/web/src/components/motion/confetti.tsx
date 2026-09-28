"use client";

import { useEffect, useRef } from "react";
import { create } from "zustand";

type Pattern = "burst" | "cannons" | "rain";

interface BurstRequest {
  id: number;
  pattern: Pattern;
  x: number;
  y: number;
  count: number;
  colors: string[];
}

interface FxState {
  queue: BurstRequest[];
  fire: (options?: { pattern?: Pattern; x?: number; y?: number; count?: number; colors?: string[] }) => void;
  drain: () => BurstRequest[];
}

const DEFAULT_COLORS = ["#5b74ff", "#a35cff", "#ff5ca8", "#c6ff3d", "#ffc93d", "#35e0ff", "#ffffff"];
let nextId = 1;

/** Global confetti bus: `useFx.getState().fire({ pattern: "cannons" })` from anywhere. */
export const useFx = create<FxState>((set, get) => ({
  queue: [],
  fire: (options = {}) =>
    set((state) => ({
      queue: [
        ...state.queue,
        {
          id: nextId++,
          pattern: options.pattern ?? "burst",
          x: options.x ?? 0.5,
          y: options.y ?? 0.45,
          count: options.count ?? 120,
          colors: options.colors ?? DEFAULT_COLORS,
        },
      ],
    })),
  drain: () => {
    const queue = get().queue;
    if (queue.length) set({ queue: [] });
    return queue;
  },
}));

export function celebrate(options?: Parameters<FxState["fire"]>[0]) {
  useFx.getState().fire(options);
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  w: number;
  h: number;
  color: string;
  shape: 0 | 1 | 2;
  life: number;
  ttl: number;
  wobble: number;
  wobbleSpeed: number;
}

/** Full-screen canvas that renders confetti with simple physics. Mount once. */
export function ConfettiLayer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let particles: Particle[] = [];
    let raf = 0;
    let last = performance.now();
    let dpr = 1;

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
    };
    resize();
    window.addEventListener("resize", resize);

    const spawn = (req: BurstRequest) => {
      const W = window.innerWidth;
      const H = window.innerHeight;
      const count = reduced ? Math.min(20, req.count) : req.count;
      const make = (x: number, y: number, angle: number, speed: number): Particle => ({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 12,
        w: 6 + Math.random() * 7,
        h: 8 + Math.random() * 10,
        color: req.colors[Math.floor(Math.random() * req.colors.length)] ?? "#fff",
        shape: (Math.random() < 0.6 ? 0 : Math.random() < 0.5 ? 1 : 2) as 0 | 1 | 2,
        life: 0,
        ttl: 2.2 + Math.random() * 1.6,
        wobble: Math.random() * Math.PI * 2,
        wobbleSpeed: 4 + Math.random() * 6,
      });
      for (let i = 0; i < count; i++) {
        if (req.pattern === "cannons") {
          const left = i % 2 === 0;
          const x = left ? -10 : W + 10;
          const angle = left ? -Math.PI / 3 - Math.random() * 0.35 : (-2 * Math.PI) / 3 + Math.random() * 0.35;
          particles.push(make(x, H * 0.85, angle, 900 + Math.random() * 700));
        } else if (req.pattern === "rain") {
          particles.push(make(Math.random() * W, -20 - Math.random() * H * 0.3, Math.PI / 2, 60 + Math.random() * 120));
        } else {
          const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.4;
          particles.push(make(req.x * W, req.y * H, angle, 350 + Math.random() * 750));
        }
      }
      particles = particles.slice(-900);
    };

    let running = false;
    const start = () => {
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    };

    const loop = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      useFx.getState().drain().forEach(spawn);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const drag = Math.pow(0.9, dt * 10);
      particles = particles.filter((p) => {
        p.life += dt;
        if (p.life > p.ttl) return false;
        p.vy += 1100 * dt;
        p.vx *= drag;
        p.vy *= drag;
        p.wobble += p.wobbleSpeed * dt;
        p.x += (p.vx + Math.cos(p.wobble) * 40) * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        const fade = Math.min(1, (p.ttl - p.life) / 0.6);
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(1, Math.abs(Math.cos(p.wobble)) * 0.8 + 0.2);
        ctx.fillStyle = p.color;
        if (p.shape === 0) ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        else if (p.shape === 1) {
          ctx.beginPath();
          ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.beginPath();
          for (let k = 0; k < 5; k++) {
            const a = (k * 4 * Math.PI) / 5 - Math.PI / 2;
            ctx.lineTo(Math.cos(a) * p.w * 0.7, Math.sin(a) * p.w * 0.7);
          }
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
        return p.y < window.innerHeight + 60;
      });
      if (particles.length === 0) {
        // Idle: stop the loop until the next burst.
        running = false;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    const unsubscribe = useFx.subscribe((state) => {
      if (state.queue.length) start();
    });
    if (useFx.getState().queue.length) start();
    return () => {
      unsubscribe();
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden className="pointer-events-none fixed inset-0 z-[90] size-full" />;
}

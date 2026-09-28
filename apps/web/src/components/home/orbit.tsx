"use client";

import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTime,
  useTransform,
  type MotionValue,
} from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useMounted } from "@/lib/use-mounted";
import { LogoMark } from "@/components/chrome/logo";
import { AppGlyph } from "@/components/marketplace/app-glyph";
import type { AppManifest } from "@/platform/types";

function OrbitItem({
  app,
  index,
  count,
  angle,
  rx,
  ry,
  size,
}: {
  app: AppManifest;
  index: number;
  count: number;
  angle: MotionValue<number>;
  rx: number;
  ry: number;
  size: number;
}) {
  const offset = (index / count) * Math.PI * 2;
  const x = useTransform(angle, (a) => Math.cos(a + offset) * rx);
  const y = useTransform(angle, (a) => Math.sin(a + offset) * ry);
  const depth = useTransform(angle, (a) => Math.sin(a + offset));
  const scale = useTransform(depth, [-1, 1], [0.62, 1.12]);
  const opacity = useTransform(depth, [-1, 1], [0.45, 1]);
  const zIndex = useTransform(depth, (d) => Math.round(d * 10) + 20);
  const blur = useTransform(depth, [-1, 0, 1], ["blur(2px)", "blur(0px)", "blur(0px)"]);
  return (
    <motion.div className="absolute left-1/2 top-1/2" style={{ x, y, scale, opacity, zIndex, filter: blur }}>
      <Link href={`/apps/${app.slug}`} className="block" style={{ marginLeft: -size / 2, marginTop: -size / 2 }} aria-label={app.name} tabIndex={-1}>
        <motion.div
          initial={{ scale: 0, rotate: -30 }}
          animate={{ scale: 1, rotate: 0 }}
          whileHover={{ scale: 1.2, rotate: -8 }}
          transition={{ type: "spring", stiffness: 300, damping: 15, delay: 0.25 + index * 0.08 }}
        >
          <AppGlyph app={app} size={size} />
        </motion.div>
      </Link>
    </motion.div>
  );
}

/** App icons orbiting the XApps mark in 3D, tilting toward the pointer. */
export function Orbit({ apps }: { apps: AppManifest[] }) {
  const reduced = useReducedMotion();
  const time = useTime();
  const angle = useTransform(time, (t) => (reduced ? 0.6 : t / 1000) * 0.22);
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const rotateX = useSpring(useTransform(py, [-1, 1], [22, 4]), { stiffness: 80, damping: 18 });
  const rotateY = useSpring(useTransform(px, [-1, 1], [-14, 14]), { stiffness: 80, damping: 18 });
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(540);
  // Orbit positions depend on the clock, so they're only rendered on the client.
  const mounted = useMounted();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className="relative mx-auto aspect-[4/3] w-full max-w-[540px] [perspective:1000px] lg:aspect-square"
      onPointerMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        px.set(((e.clientX - rect.left) / rect.width) * 2 - 1);
        py.set(((e.clientY - rect.top) / rect.height) * 2 - 1);
      }}
      onPointerLeave={() => {
        px.set(0);
        py.set(0);
      }}
    >
      <motion.div className="absolute inset-0 [transform-style:preserve-3d]" style={{ rotateX, rotateY }}>
        {/* Orbit rings */}
        <div className="absolute left-1/2 top-1/2 h-[42%] w-[92%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border border-white/10" />
        <div className="absolute left-1/2 top-1/2 h-[62%] w-[70%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border border-dashed border-white/[0.06]" />
        {/* Core */}
        <div className="absolute left-1/2 top-1/2 z-[15] -translate-x-1/2 -translate-y-1/2">
          <motion.div
            className="absolute -inset-16 rounded-full opacity-70 blur-3xl"
            style={{ background: "radial-gradient(circle, #7f95ff 0%, #a35cff 35%, transparent 70%)" }}
            animate={reduced ? undefined : { scale: [1, 1.15, 1], opacity: [0.55, 0.8, 0.55] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div animate={reduced ? undefined : { rotate: [0, 4, -4, 0] }} transition={{ duration: 8, repeat: Infinity }}>
            <LogoMark size={width < 420 ? 84 : 120} />
          </motion.div>
        </div>
        {mounted &&
          apps.map((app, i) => (
            <OrbitItem
              key={app.slug}
              app={app}
              index={i}
              count={apps.length}
              angle={angle}
              rx={width * 0.4}
              ry={width * 0.17}
              size={width < 420 ? 52 : 72}
            />
          ))}
      </motion.div>
    </div>
  );
}

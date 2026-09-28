"use client";

import { motion, useMotionTemplate, useMotionValue, useSpring, useTransform } from "motion/react";
import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 3D card that tilts toward the pointer with a moving spotlight and glare.
 * Pointer-only: touch devices get a gentle press instead.
 */
export function TiltCard({
  children,
  className,
  intensity = 10,
  glare = true,
  spotlightColor = "rgb(255 255 255 / 0.12)",
  style,
}: {
  children: ReactNode;
  className?: string;
  intensity?: number;
  glare?: boolean;
  spotlightColor?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const hover = useMotionValue(0);
  const cfg = { stiffness: 260, damping: 24, mass: 0.6 };
  const rotateX = useSpring(useTransform(py, [0, 1], [intensity, -intensity]), cfg);
  const rotateY = useSpring(useTransform(px, [0, 1], [-intensity, intensity]), cfg);
  const lift = useSpring(hover, cfg);
  const scale = useTransform(lift, [0, 1], [1, 1.015]);
  const mx = useTransform(px, (v) => `${v * 100}%`);
  const my = useTransform(py, (v) => `${v * 100}%`);
  const spotlight = useMotionTemplate`radial-gradient(420px circle at ${mx} ${my}, ${spotlightColor}, transparent 60%)`;
  const glareBg = useMotionTemplate`radial-gradient(240px circle at ${mx} ${my}, rgb(255 255 255 / 0.18), transparent 70%)`;
  const overlayOpacity = useSpring(hover, cfg);

  return (
    <motion.div
      ref={ref}
      className={cn("group/tilt relative [transform-style:preserve-3d]", className)}
      style={{ rotateX, rotateY, scale, transformPerspective: 900, ...style }}
      onPointerMove={(event) => {
        if (event.pointerType !== "mouse" || !ref.current) return;
        const rect = ref.current.getBoundingClientRect();
        px.set((event.clientX - rect.left) / rect.width);
        py.set((event.clientY - rect.top) / rect.height);
        hover.set(1);
      }}
      onPointerLeave={() => {
        px.set(0.5);
        py.set(0.5);
        hover.set(0);
      }}
      whileTap={{ scale: 0.985 }}
    >
      {children}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit]"
        style={{ background: spotlight, opacity: overlayOpacity }}
      />
      {glare && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[inherit] mix-blend-overlay"
          style={{ background: glareBg, opacity: overlayOpacity }}
        />
      )}
    </motion.div>
  );
}

"use client";

import { motion, useMotionTemplate, useMotionValue, useSpring } from "motion/react";
import { useEffect } from "react";

/**
 * The living backdrop: drifting aurora blobs, a masked grid and a soft glow
 * that trails the cursor. Everything is transform/opacity only.
 */
export function Background({ accent }: { accent?: [string, string] }) {
  const x = useMotionValue(-1000);
  const y = useMotionValue(-1000);
  const sx = useSpring(x, { stiffness: 60, damping: 18, mass: 0.8 });
  const sy = useSpring(y, { stiffness: 60, damping: 18, mass: 0.8 });
  const glow = useMotionTemplate`radial-gradient(600px circle at ${sx}px ${sy}px, rgb(120 110 255 / 0.10), transparent 70%)`;

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      x.set(event.clientX);
      y.set(event.clientY);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [x, y]);

  const [a, b] = accent ?? ["#5b74ff", "#ff5ca8"];

  return (
    <div aria-hidden className="grain pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-ink-950">
      <div
        className="absolute -left-[20%] -top-[30%] h-[70vmax] w-[70vmax] animate-aurora rounded-full opacity-[0.22] motion-reduce:animate-none"
        style={{ background: `radial-gradient(circle, ${a}, transparent 70%)` }}
      />
      <div
        className="absolute -right-[25%] top-[10%] h-[60vmax] w-[60vmax] animate-aurora rounded-full opacity-[0.16] [animation-delay:-6s] motion-reduce:animate-none"
        style={{ background: `radial-gradient(circle, ${b}, transparent 70%)` }}
      />
      <div
        className="absolute -bottom-[35%] left-[20%] h-[55vmax] w-[55vmax] animate-aurora rounded-full opacity-[0.12] [animation-delay:-11s] motion-reduce:animate-none"
        style={{ background: "radial-gradient(circle, #1fd1b2, transparent 70%)" }}
      />
      <div
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(rgb(255 255 255 / 0.035) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.035) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(ellipse 80% 60% at 50% 0%, #000 30%, transparent 75%)",
        }}
      />
      <motion.div className="absolute inset-0" style={{ background: glow }} />
    </div>
  );
}

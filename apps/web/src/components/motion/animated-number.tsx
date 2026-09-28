"use client";

import { motion, useInView, useSpring, useTransform } from "motion/react";
import { useEffect, useRef } from "react";

/** Number that springs to its new value (and counts up when it scrolls into view). */
export function AnimatedNumber({
  value,
  format = (v) => Math.round(v).toLocaleString("en"),
  className,
  from = 0,
}: {
  value: number;
  format?: (value: number) => string;
  className?: string;
  from?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const spring = useSpring(from, { stiffness: 90, damping: 20, mass: 0.8 });
  const text = useTransform(spring, (v) => format(v));

  useEffect(() => {
    if (inView) spring.set(value);
  }, [inView, spring, value]);

  return (
    <motion.span ref={ref} className={className}>
      {text}
    </motion.span>
  );
}

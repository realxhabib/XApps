"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** Cycles through words letter by letter — each glyph blurs and springs in. */
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Color at position t (0..1) along a multi-stop gradient. */
function colorAt(stops: string[], t: number): string {
  if (stops.length === 1) return stops[0] as string;
  const scaled = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(scaled));
  const local = scaled - i;
  const [a, b] = [hexToRgb(stops[i] as string), hexToRgb(stops[i + 1] as string)];
  const mix = a.map((v, k) => Math.round(v + ((b[k] as number) - v) * local));
  return `rgb(${mix.join(" ")})`;
}

export function RotatingWord({
  words,
  interval = 2600,
  className,
  colors,
}: {
  words: string[];
  interval?: number;
  className?: string;
  /** Gradient stops painted across each word (per letter, so glyphs can animate independently). */
  colors?: string[];
}) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => (i + 1) % words.length), interval);
    return () => clearInterval(timer);
  }, [interval, words.length]);
  const word = words[index] ?? "";

  return (
    <span className={cn("relative inline-flex", className)} aria-live="polite">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={word} className="inline-flex whitespace-pre" aria-label={word}>
          {Array.from(word).map((char, i, chars) => (
            <motion.span
              key={`${word}-${i}`}
              aria-hidden
              className="inline-block"
              style={colors ? { color: colorAt(colors, chars.length > 1 ? i / (chars.length - 1) : 0) } : undefined}
              initial={{ y: "0.45em", opacity: 0, filter: "blur(10px)", rotateX: -70 }}
              animate={{ y: 0, opacity: 1, filter: "blur(0px)", rotateX: 0 }}
              exit={{ y: "-0.35em", opacity: 0, filter: "blur(8px)", transition: { duration: 0.18, delay: i * 0.012 } }}
              transition={{ type: "spring", stiffness: 380, damping: 26, delay: i * 0.03, filter: { duration: 0.3, delay: i * 0.03, ease: "easeOut" } }}
            >
              {char}
            </motion.span>
          ))}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { X_MARK_PATH } from "@/components/ui/x-logo";
import { spring } from "@/lib/motion";

/** The X mark on X's black tile, as X presents it. */
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden
      whileHover={{ scale: 1.08, rotate: -6 }}
      whileTap={{ scale: 0.94 }}
      transition={spring.bouncy}
    >
      <rect x="0.5" y="0.5" width="31" height="31" rx="8" fill="#000" stroke="rgb(255 255 255 / 0.18)" />
      <path d={X_MARK_PATH} fill="#fff" transform="translate(7 7) scale(0.75)" />
    </motion.svg>
  );
}

export function Logo() {
  return (
    <Link href="/" className="group flex items-center gap-2" aria-label="XApps home">
      <LogoMark />
      <span className="font-display text-[19px] font-extrabold tracking-tight text-ink-50">Apps</span>
    </Link>
  );
}

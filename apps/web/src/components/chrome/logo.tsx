"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { spring } from "@/lib/motion";

export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden
      whileHover={{ rotate: 90, scale: 1.06 }}
      transition={spring.bouncy}
    >
      <defs>
        <linearGradient id="xapps-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7f95ff" />
          <stop offset="0.55" stopColor="#a35cff" />
          <stop offset="1" stopColor="#ff5ca8" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="28" height="28" rx="9" fill="#11141d" stroke="rgb(255 255 255 / 0.12)" />
      <path d="M10 9.5 L22 22.5" stroke="url(#xapps-mark)" strokeWidth="4.2" strokeLinecap="round" />
      <path d="M22 9.5 L10 22.5" stroke="#f6f7fb" strokeWidth="4.2" strokeLinecap="round" />
      <circle cx="16" cy="16" r="2.2" fill="#c6ff3d" />
    </motion.svg>
  );
}

export function Logo() {
  return (
    <Link href="/" className="group flex items-center gap-2.5" aria-label="XApps home">
      <LogoMark />
      <span className="font-display text-[19px] font-extrabold tracking-tight">
        X<span className="text-ink-300 transition-colors group-hover:text-ink-50">Apps</span>
      </span>
    </Link>
  );
}

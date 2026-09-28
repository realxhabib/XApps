"use client";

import { motion, type Variants } from "motion/react";
import type { ReactNode } from "react";
import { fadeUp, staggerChildren } from "@/lib/motion";

/** Children fade/rise into view with a stagger the first time they appear. */
export function Reveal({
  children,
  className,
  stagger = 0.06,
  delay = 0,
  once = true,
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  stagger?: number;
  delay?: number;
  once?: boolean;
  as?: "div" | "section" | "ul";
}) {
  const Component = motion[as];
  return (
    <Component
      className={className}
      variants={staggerChildren(stagger, delay)}
      initial="hidden"
      whileInView="show"
      viewport={{ once, margin: "-60px" }}
    >
      {children}
    </Component>
  );
}

export function RevealItem({
  children,
  className,
  variants = fadeUp,
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  variants?: Variants;
  as?: "div" | "li" | "article";
}) {
  const Component = motion[as];
  return (
    <Component className={className} variants={variants}>
      {children}
    </Component>
  );
}

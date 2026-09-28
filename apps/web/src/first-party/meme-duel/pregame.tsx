"use client";

import { motion, useReducedMotion } from "motion/react";
import { AnimatedDots, Eyebrow } from "@/first-party/shared/ui";
import { spring, staggerChildren } from "@/lib/motion";
import { CardBack } from "./pieces";

const RULES = [
  { emoji: "✍️", text: "Caption it" },
  { emoji: "🧷", text: "Sticker it" },
  { emoji: "🗳️", text: "Crowd votes" },
];

const item = {
  hidden: { opacity: 0, y: 14, filter: "blur(6px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: spring.soft },
};

/** Before `match.start`: title, one-line rules and the face-down template card. */
export function Pregame() {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className="flex h-full min-h-0 w-full flex-col items-center justify-center gap-6 px-6 py-6 text-center"
      variants={staggerChildren(0.08, 0.05)}
      initial="hidden"
      animate="show"
      exit={{ opacity: 0, scale: 0.94, filter: "blur(6px)", transition: { duration: 0.22 } }}
    >
      <motion.div variants={item} className="[--r:24px]" style={{ width: "min(56vw, 34dvh, 230px)", height: "min(56vw, 34dvh, 230px)" }}>
        <motion.div
          className="size-full"
          animate={reduced ? undefined : { y: [0, -8, 0], rotate: [-4, 3, -4] }}
          transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
        >
          <CardBack />
        </motion.div>
      </motion.div>

      <motion.div variants={item} className="space-y-2">
        <Eyebrow>Caption battle</Eyebrow>
        <h1 className="font-display text-5xl font-extrabold tracking-tight [font-stretch:92%]">
          <span className="bg-[linear-gradient(100deg,#fff_10%,var(--accent-from)_55%,var(--accent-to))] bg-clip-text text-transparent">
            Meme Duel
          </span>
        </h1>
        <p className="mx-auto max-w-xs text-sm text-ink-300">Same template. Two captions. The crowd decides.</p>
      </motion.div>

      <motion.ul variants={item} className="flex flex-wrap justify-center gap-2">
        {RULES.map((rule, i) => (
          <motion.li
            key={rule.text}
            className="flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-ink-100 ring-1 ring-white/10"
            animate={reduced ? undefined : { y: [0, -3, 0] }}
            transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.3, ease: "easeInOut" }}
          >
            <span aria-hidden>{rule.emoji}</span>
            {rule.text}
          </motion.li>
        ))}
      </motion.ul>

      <motion.p variants={item} className="text-sm font-medium text-ink-400">
        Get ready
        <AnimatedDots />
      </motion.p>
    </motion.div>
  );
}

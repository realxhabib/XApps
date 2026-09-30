"use client";

import { motion } from "motion/react";
import { AppWindow, Swords } from "lucide-react";
import { spring } from "@/lib/motion";
import { play } from "@/lib/sfx";
import { cn } from "@/lib/utils";
import type { AppKind } from "@/platform/types";

const KINDS: { id: AppKind; title: string; body: string; icon: typeof Swords }[] = [
  {
    id: "game",
    title: "Game",
    body: "People challenge each other: matches, lobbies, scores and results.",
    icon: Swords,
  },
  {
    id: "app",
    title: "App",
    body: "People open it: news, tools, dashboards, trading, a meme maker. No matches.",
    icon: AppWindow,
  },
];

/** Game (matches between players) or a standalone app people simply open. */
export function KindPicker({ value, onChange, idPrefix = "kind" }: { value: AppKind; onChange: (kind: AppKind) => void; idPrefix?: string }) {
  return (
    <div>
      <span className="text-sm font-semibold">What are you building?</span>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="App kind">
        {KINDS.map((k) => {
          const on = value === k.id;
          const Icon = k.icon;
          return (
            <button
              type="button"
              key={k.id}
              role="radio"
              aria-checked={on}
              onClick={() => {
                if (!on) play("tick");
                onChange(k.id);
              }}
              className={cn(
                "relative flex items-start gap-3 rounded-2xl border p-3.5 text-left transition",
                on ? "border-white/30" : "border-white/10 hover:border-white/20",
              )}
            >
              {on && <motion.span layoutId={`${idPrefix}-pick`} className="absolute inset-0 rounded-2xl bg-white/[0.07]" transition={spring.layout} />}
              <span className={cn("relative flex size-9 shrink-0 items-center justify-center rounded-xl transition", on ? "bg-volt text-ink-950" : "bg-white/[0.06] text-ink-200")}>
                <Icon className="size-4.5" />
              </span>
              <span className="relative">
                <span className="block text-sm font-semibold">{k.title}</span>
                <span className="mt-0.5 block text-xs text-ink-400">{k.body}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

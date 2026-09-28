"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { play } from "@/lib/sfx";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface SegmentItem<T extends string> {
  id: T;
  label: ReactNode;
  icon?: ReactNode;
  count?: number;
}

/** Pill tabs whose highlight glides between options. */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
  layoutId,
  className,
  size = "md",
}: {
  items: SegmentItem<T>[];
  value: T;
  onChange: (value: T) => void;
  layoutId: string;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div
      role="tablist"
      className={cn("no-scrollbar inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full glass p-1", className)}
    >
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            role="tab"
            aria-selected={active}
            onClick={() => {
              if (!active) play("tick");
              onChange(item.id);
            }}
            className={cn(
              "relative flex shrink-0 items-center gap-1.5 rounded-full font-semibold transition-colors",
              size === "sm" ? "h-8 px-3 text-[13px]" : "h-9 px-4 text-sm",
              active ? "text-ink-950" : "text-ink-300 hover:text-ink-50",
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-full bg-ink-50"
                transition={spring.layout}
              />
            )}
            <span className="relative flex items-center gap-1.5">
              {item.icon}
              {item.label}
              {item.count !== undefined && item.count > 0 && (
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[11px] tabular",
                    active ? "bg-ink-950/10 text-ink-950" : "bg-white/10 text-ink-100",
                  )}
                >
                  {item.count}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "nova" | "volt" | "flare" | "gold" | "danger" | "success" | "live";

const tones: Record<Tone, string> = {
  neutral: "bg-white/[0.06] text-ink-200 border-white/10",
  nova: "bg-nova-500/15 text-nova-300 border-nova-400/25",
  volt: "bg-volt/15 text-volt border-volt/25",
  flare: "bg-flare/15 text-flare border-flare/25",
  gold: "bg-gold/15 text-gold border-gold/30",
  danger: "bg-danger/15 text-danger border-danger/30",
  success: "bg-success/15 text-success border-success/25",
  live: "bg-danger/15 text-[#ff7a86] border-danger/30",
};

export function Badge({
  children,
  tone = "neutral",
  className,
  pulse,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
  pulse?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold uppercase tracking-wider",
        tones[tone],
        className,
      )}
    >
      {pulse && (
        <span className="relative flex size-1.5">
          <span className="absolute inset-0 animate-ping-soft rounded-full bg-current" />
          <span className="relative size-1.5 rounded-full bg-current" />
        </span>
      )}
      {children}
    </span>
  );
}

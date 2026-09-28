import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-white/15 bg-white/[0.06] px-1.5 font-mono text-[10px] font-medium text-ink-200 shadow-[inset_0_-1px_0_rgb(255_255_255/0.08)]",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

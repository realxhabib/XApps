import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Infinite horizontal ticker. Content is duplicated once; hover slows it down. */
export function Marquee({
  children,
  className,
  duration = 40,
  reverse = false,
}: {
  children: ReactNode;
  className?: string;
  duration?: number;
  reverse?: boolean;
}) {
  return (
    <div className={cn("group relative flex overflow-hidden mask-fade-x", className)}>
      <div
        className="flex w-max shrink-0 animate-marquee items-center gap-3 pr-3 group-hover:[animation-play-state:paused] motion-reduce:animate-none"
        style={{ "--marquee-duration": `${duration}s`, animationDirection: reverse ? "reverse" : "normal" } as React.CSSProperties}
      >
        {children}
        <div aria-hidden className="flex items-center gap-3">
          {children}
        </div>
      </div>
    </div>
  );
}

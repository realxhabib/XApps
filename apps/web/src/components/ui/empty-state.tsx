import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EmptyState({
  emoji,
  title,
  children,
  action,
  className,
}: {
  emoji: string;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center rounded-[2rem] hairline bg-white/[0.02] px-6 py-14 text-center", className)}>
      <div className="animate-float text-5xl" aria-hidden>
        {emoji}
      </div>
      <h3 className="mt-4 font-display text-xl font-bold">{title}</h3>
      {children && <p className="mt-2 max-w-sm text-sm text-ink-300">{children}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

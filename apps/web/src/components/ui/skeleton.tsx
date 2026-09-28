import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("shimmer-bg rounded-2xl bg-white/[0.04]", className)} />;
}

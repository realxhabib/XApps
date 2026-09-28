"use client";

import { ArrowUpRight, Clock3, Users } from "lucide-react";
import Link from "next/link";
import { TiltCard } from "@/components/motion/tilt-card";
import { Badge } from "@/components/ui/badge";
import { play } from "@/lib/sfx";
import { tableSizeLabel } from "@/components/play/match-view";
import { cn, formatCompact } from "@/lib/utils";
import { CATEGORIES, type AppManifest } from "@/platform/types";
import { AppArt } from "./app-art";
import { AppGlyph } from "./app-glyph";

const category = (id: AppManifest["category"]) => CATEGORIES.find((c) => c.id === id);

/** Marketplace card: 3D tilt, pointer spotlight, layered depth and a live vignette. */
export function AppCard({
  app,
  size = "md",
  morph = true,
  className,
}: {
  app: AppManifest;
  size?: "md" | "lg";
  morph?: boolean;
  className?: string;
}) {
  const cat = category(app.category);
  const large = size === "lg";
  return (
    <Link
      href={`/apps/${app.slug}`}
      transitionTypes={["nav-forward"]}
      onClick={() => play("pop")}
      className={cn("group block h-full rounded-[2rem] outline-none", className)}
      aria-label={`${app.name} — ${app.tagline}`}
    >
      <TiltCard
        intensity={large ? 6 : 9}
        className="h-full rounded-[2rem]"
        spotlightColor={`${app.accent[0]}33`}
      >
        <div className="relative flex h-full flex-col overflow-hidden rounded-[2rem] border border-white/[0.08] bg-ink-850/80 transition-colors duration-500 group-hover:border-white/15">
          {/* Accent wash */}
          <div
            aria-hidden
            className="pointer-events-none absolute -right-16 -top-20 size-64 rounded-full opacity-30 blur-3xl transition-opacity duration-500 group-hover:opacity-50"
            style={{ background: `radial-gradient(circle, ${app.accent[0]}, ${app.accent[1]} 60%, transparent 70%)` }}
          />
          <div className={cn("relative [transform:translateZ(30px)]", large ? "h-56 sm:h-72" : "h-36")}>
            <AppArt app={app} className="size-full" />
          </div>
          <div className={cn("relative flex flex-1 flex-col p-5 pt-0 [transform:translateZ(40px)]", large && "sm:p-7 sm:pt-0")}>
            <div className="flex items-center gap-3">
              <AppGlyph app={app} size={large ? 56 : 44} morph={morph} />
              <div className="min-w-0 flex-1">
                <h3 className={cn("truncate font-display font-extrabold tracking-tight", large ? "text-3xl" : "text-xl")}>{app.name}</h3>
                <p className="truncate text-xs text-ink-400">
                  {app.official ? "XApps Studio" : `by @${app.developer.handle}`}
                </p>
              </div>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-ink-200 transition-all duration-300 group-hover:rotate-45 group-hover:bg-ink-50 group-hover:text-ink-950">
                <ArrowUpRight className="size-4" />
              </span>
            </div>
            <p className={cn("mt-3 text-ink-300", large ? "text-base" : "line-clamp-2 text-sm")}>{app.tagline}</p>
            <div className="mt-auto flex flex-wrap items-center gap-2 pt-4 text-xs text-ink-400">
              {cat && (
                <Badge tone="neutral">
                  {cat.emoji} {cat.label}
                </Badge>
              )}
              <span className="flex items-center gap-1">
                <Users className="size-3.5" /> {tableSizeLabel(app)}
              </span>
              <span className="flex items-center gap-1">
                <Clock3 className="size-3.5" /> {app.durationLabel}
              </span>
              {app.playCount > 0 && <span className="ml-auto tabular">{formatCompact(app.playCount)} plays</span>}
            </div>
          </div>
        </div>
      </TiltCard>
    </Link>
  );
}

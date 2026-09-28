import { ViewTransition } from "react";
import type { AppManifest } from "@/platform/types";
import { cn } from "@/lib/utils";

/** The app's icon tile: glossy gradient squircle with its emoji. */
export function AppGlyph({
  app,
  size = 56,
  className,
  morph = false,
}: {
  app: Pick<AppManifest, "slug" | "icon" | "accent" | "name">;
  size?: number;
  className?: string;
  /** Participates in the card → detail shared-element transition. */
  morph?: boolean;
}) {
  const tile = (
    <span
      role="img"
      aria-label={app.name}
      className={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden", className)}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        background: `linear-gradient(135deg, ${app.accent[0]}, ${app.accent[1]})`,
        boxShadow: `0 ${size * 0.18}px ${size * 0.5}px -${size * 0.2}px ${app.accent[1]}99, inset 0 1px 0 rgb(255 255 255 / 0.35)`,
      }}
    >
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-1/2"
        style={{ background: "linear-gradient(180deg, rgb(255 255 255 / 0.28), transparent)" }}
      />
      <span aria-hidden className="relative drop-shadow-[0_2px_6px_rgb(0_0_0/0.35)]" style={{ fontSize: size * 0.5, lineHeight: 1 }}>
        {app.icon}
      </span>
    </span>
  );
  if (!morph) return tile;
  return (
    <ViewTransition name={`app-glyph-${app.slug}`} share="morph" default="none">
      {tile}
    </ViewTransition>
  );
}

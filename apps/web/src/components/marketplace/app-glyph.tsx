"use client";

import { ViewTransition, useState } from "react";
import { appImageSrc } from "@/lib/app-images";
import type { AppManifest } from "@/platform/types";
import { cn } from "@/lib/utils";

/** The app's icon tile: its uploaded icon, or a glossy gradient squircle with its emoji. */
export function AppGlyph({
  app,
  size = 56,
  className,
  morph = false,
}: {
  app: Pick<AppManifest, "slug" | "icon" | "accent" | "name"> & Partial<Pick<AppManifest, "iconImage">>;
  size?: number;
  className?: string;
  /** Participates in the card → detail shared-element transition. */
  morph?: boolean;
}) {
  const src = appImageSrc(app.iconImage);
  // A missing or broken image falls back to the emoji tile.
  const [failed, setFailed] = useState<string | null>(null);
  const showImage = !!src && failed !== src;
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
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- storage images, sized by the tile
        <img src={src} alt="" draggable={false} onError={() => setFailed(src)} className="absolute inset-0 size-full object-cover" />
      ) : (
        <span aria-hidden className="relative drop-shadow-[0_2px_6px_rgb(0_0_0/0.35)]" style={{ fontSize: size * 0.5, lineHeight: 1 }}>
          {app.icon}
        </span>
      )}
      {showImage && <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-white/15" />}
    </span>
  );
  if (!morph) return tile;
  return (
    <ViewTransition name={`app-glyph-${app.slug}`} share="morph" default="none">
      {tile}
    </ViewTransition>
  );
}

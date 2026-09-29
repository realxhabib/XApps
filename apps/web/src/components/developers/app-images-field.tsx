"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { toast } from "@/components/chrome/toasts";
import { AppGlyph } from "@/components/marketplace/app-glyph";
import { APP_IMAGE_INPUT_TYPES, appImageSrc, processAppImage, type AppImageKind } from "@/lib/app-images";
import { haptic } from "@/lib/haptics";
import { spring } from "@/lib/motion";
import { play } from "@/lib/sfx";
import { cn } from "@/lib/utils";
import { useBackend } from "@/platform/client";
import type { AppManifest } from "@/platform/types";

export interface AppImagesValue {
  iconImage: string | null;
  coverImage: string | null;
}

/**
 * Icon + cover pickers for an app listing. Images are cropped, shrunk and
 * re-encoded in the browser, uploaded once, and referenced by key. They go
 * through review with the rest of the listing.
 */
export function AppImagesField({
  value,
  onChange,
  app,
  idPrefix = "app-images",
}: {
  value: AppImagesValue;
  onChange: (next: Partial<AppImagesValue>) => void;
  /** For the icon preview's fallback tile. */
  app: Pick<AppManifest, "name" | "icon" | "accent">;
  idPrefix?: string;
}) {
  return (
    <div>
      <span className="text-sm font-semibold">Images</span>
      <span className="mt-0.5 block text-xs text-ink-400">
        Optional. A square icon replaces the emoji, and a wide cover becomes your art on cards and your app page. Reviewers see both.
      </span>
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-[9rem_1fr]">
        <ImageSlot
          kind="icon"
          id={`${idPrefix}-icon`}
          value={value.iconImage}
          onChange={(key) => onChange({ iconImage: key })}
          preview={(src) => (
            <AppGlyph app={{ slug: "preview", name: app.name || "Your app", icon: app.icon, accent: app.accent, iconImage: src }} size={88} />
          )}
        />
        <ImageSlot
          kind="cover"
          id={`${idPrefix}-cover`}
          value={value.coverImage}
          onChange={(key) => onChange({ coverImage: key })}
          preview={(src) =>
            src ? (
              // eslint-disable-next-line @next/next/no-img-element -- storage images and data URLs
              <img src={appImageSrc(src) ?? undefined} alt="" className="absolute inset-0 size-full object-cover" draggable={false} />
            ) : (
              <span
                className="absolute inset-0 opacity-40"
                style={{ background: `linear-gradient(135deg, ${app.accent[0]}, ${app.accent[1]})` }}
              />
            )
          }
        />
      </div>
    </div>
  );
}

function ImageSlot({
  kind,
  id,
  value,
  onChange,
  preview,
}: {
  kind: AppImageKind;
  id: string;
  value: string | null;
  onChange: (key: string | null) => void;
  preview: (key: string | null) => React.ReactNode;
}) {
  const backend = useBackend();
  const reduced = useReducedMotion();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const label = kind === "icon" ? "Icon" : "Cover";

  const pick = async (file: File | undefined) => {
    if (!file || busy) return;
    setBusy(true);
    try {
      const processed = await processAppImage(file, kind);
      const key = await backend.uploadAppImage(processed, kind);
      onChange(key);
      play("pop");
      haptic("success");
    } catch (error) {
      play("error");
      toast(error instanceof Error ? error.message : `Couldn't add that ${kind}`, { tone: "danger" });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void pick(e.dataTransfer.files[0]);
  };

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn(
          "relative flex items-center justify-center overflow-hidden rounded-2xl border border-dashed transition",
          kind === "icon" ? "aspect-square" : "aspect-video",
          over ? "border-volt bg-volt/10" : "border-white/15 bg-white/[0.03]",
        )}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={value ?? "empty"}
            className={cn(kind === "cover" ? "absolute inset-0" : "relative")}
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={spring.snappy}
          >
            {preview(value)}
          </motion.div>
        </AnimatePresence>
        {busy && (
          <span className="absolute inset-0 flex items-center justify-center bg-ink-950/60">
            <Loader2 className="size-6 animate-spin" aria-label={`Uploading ${kind}`} />
          </span>
        )}
      </div>
      <input
        ref={input}
        id={id}
        type="file"
        accept={APP_IMAGE_INPUT_TYPES.join(",")}
        className="sr-only"
        aria-label={`Upload ${kind}`}
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      <div className="mt-1.5 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          aria-label={value ? `Replace ${label.toLowerCase()}` : `Add ${label.toLowerCase()}`}
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-white/10 px-2.5 py-1 text-xs font-semibold text-ink-100 transition hover:border-white/25 disabled:opacity-50"
        >
          <ImagePlus className="size-3.5" /> {value ? "Replace" : kind === "icon" ? "Add" : "Add cover"}
        </button>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={busy}
            aria-label={`Remove ${kind}`}
            className="inline-flex items-center rounded-full p-1.5 text-ink-400 transition hover:bg-white/10 hover:text-ink-100"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
        <span className="ml-auto text-[11px] text-ink-500">{kind === "icon" ? "Square" : "16:9"}</span>
      </div>
    </div>
  );
}

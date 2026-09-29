"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ImagePlus, Loader2, Smile, Trash2, Image as ImageIcon } from "lucide-react";
import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { toast } from "@/components/chrome/toasts";
import { AppGlyph } from "@/components/marketplace/app-glyph";
import { Segmented } from "@/components/ui/segmented";
import { APP_IMAGE_INPUT_TYPES, appImageSrc, processAppImage, type AppImageKind } from "@/lib/app-images";
import { haptic } from "@/lib/haptics";
import { spring } from "@/lib/motion";
import { play } from "@/lib/sfx";
import { cn } from "@/lib/utils";
import { useBackend } from "@/platform/client";

/** Emoji icons offered in the picker (a custom one from an earlier version is shown first). */
export const ICONS = ["🎯", "🧠", "🎨", "🎲", "🏁", "🪩", "🧩", "🎤", "🗳️", "🃏", "🏀", "👾", "🚀", "⚽"];

type IconMode = "emoji" | "image";

/**
 * The app's icon: either an emoji or an uploaded square image, never both on
 * screen. Choosing an image keeps the emoji as a quiet fallback (shown if the
 * image can't load); switching back to Emoji drops the image (and brings it
 * back if you switch again before saving).
 */
export function IconField({
  icon,
  iconImage,
  accent,
  name,
  onChange,
  error,
  idPrefix = "icon",
}: {
  icon: string;
  iconImage: string | null;
  accent: [string, string];
  name: string;
  onChange: (next: { icon?: string; iconImage?: string | null }) => void;
  error?: string;
  idPrefix?: string;
}) {
  const [mode, setMode] = useState<IconMode>(iconImage ? "image" : "emoji");
  const [stash, setStash] = useState<string | null>(null);
  const emojis = ICONS.includes(icon) ? ICONS : [icon, ...ICONS];

  const switchTo = (next: IconMode) => {
    if (next === mode) return;
    setMode(next);
    if (next === "emoji") {
      if (iconImage) setStash(iconImage);
      onChange({ iconImage: null });
    } else if (stash) {
      onChange({ iconImage: stash });
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold">Icon</span>
        <Segmented
          size="sm"
          layoutId={`${idPrefix}-mode`}
          value={mode}
          onChange={switchTo}
          items={[
            { id: "emoji", label: "Emoji", icon: <Smile className="size-3.5" /> },
            { id: "image", label: "Image", icon: <ImageIcon className="size-3.5" /> },
          ]}
        />
      </div>
      <AnimatePresence mode="wait" initial={false}>
        {mode === "emoji" ? (
          <motion.div key="emoji" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring.snappy}>
            <p className="mt-1 text-xs text-ink-400">Pick one. It sits on your accent gradient.</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {emojis.map((e) => (
                <motion.button
                  type="button"
                  key={e}
                  whileHover={{ scale: 1.15, rotate: -6 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => onChange({ icon: e })}
                  className={cn("flex size-10 items-center justify-center rounded-xl text-xl transition", icon === e ? "bg-white/15 ring-2 ring-white/60" : "bg-white/[0.04]")}
                  aria-label={`Icon ${e}`}
                  aria-pressed={icon === e}
                >
                  {e}
                </motion.button>
              ))}
            </div>
          </motion.div>
        ) : (
          <motion.div key="image" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring.snappy}>
            <p className="mt-1 text-xs text-ink-400">A square PNG, JPEG or WebP, at least 128 × 128. It&apos;s cropped to a square.</p>
            <div className="mt-2 w-36">
              <ImageSlot
                kind="icon"
                id={`${idPrefix}-upload`}
                value={iconImage}
                onChange={(key) => onChange({ iconImage: key })}
                preview={(key) => <AppGlyph app={{ slug: "preview", name: name || "Your app", icon, accent, iconImage: key }} size={88} />}
                empty="Drop a square image"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

/** Optional 16:9 cover art for cards and the app page. */
export function CoverField({
  coverImage,
  accent,
  onChange,
  idPrefix = "cover",
}: {
  coverImage: string | null;
  accent: [string, string];
  onChange: (next: { coverImage: string | null }) => void;
  idPrefix?: string;
}) {
  return (
    <div>
      <span className="text-sm font-semibold">
        Cover <span className="font-normal text-ink-400">(optional)</span>
      </span>
      <span className="mt-0.5 block text-xs text-ink-400">
        A wide screenshot or key art (16:9, at least 480 px tall). It replaces the animated art on your card and app page.
      </span>
      <div className="mt-2 max-w-md">
        <ImageSlot
          kind="cover"
          id={`${idPrefix}-upload`}
          value={coverImage}
          onChange={(key) => onChange({ coverImage: key })}
          empty="Drop a wide image"
          preview={(key) =>
            key ? (
              // eslint-disable-next-line @next/next/no-img-element -- storage images and data URLs
              <img src={appImageSrc(key) ?? undefined} alt="" className="absolute inset-0 size-full object-cover" draggable={false} />
            ) : (
              <span className="absolute inset-0 opacity-30" style={{ background: `linear-gradient(135deg, ${accent[0]}, ${accent[1]})` }} />
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
  empty,
}: {
  kind: AppImageKind;
  id: string;
  value: string | null;
  onChange: (key: string | null) => void;
  preview: (key: string | null) => ReactNode;
  empty: string;
}) {
  const backend = useBackend();
  const reduced = useReducedMotion();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

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
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        disabled={busy}
        aria-label={value ? `Replace ${kind}` : `Choose ${kind} image`}
        className={cn(
          "group relative flex w-full items-center justify-center overflow-hidden rounded-2xl border border-dashed transition",
          kind === "icon" ? "aspect-square" : "aspect-video",
          over ? "border-volt bg-volt/10" : "border-white/15 bg-white/[0.03] hover:border-white/30",
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
        {!value && !busy && (
          <span className="absolute inset-x-0 bottom-2 flex items-center justify-center gap-1 text-[11px] font-semibold text-ink-200">
            <ImagePlus className="size-3.5" /> {empty}
          </span>
        )}
        {busy && (
          <span className="absolute inset-0 flex items-center justify-center bg-ink-950/60">
            <Loader2 className="size-6 animate-spin" aria-label={`Uploading ${kind}`} />
          </span>
        )}
      </button>
      <input
        ref={input}
        id={id}
        type="file"
        accept={APP_IMAGE_INPUT_TYPES.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-label={`Upload ${kind}`}
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      {value && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-white/10 px-2.5 py-1 text-xs font-semibold text-ink-100 transition hover:border-white/25 disabled:opacity-50"
          >
            <ImagePlus className="size-3.5" /> Replace
          </button>
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={busy}
            aria-label={`Remove ${kind}`}
            className="inline-flex items-center rounded-full p-1.5 text-ink-400 transition hover:bg-white/10 hover:text-ink-100"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

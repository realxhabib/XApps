"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Download, ImageUp, Loader2, Undo2 } from "lucide-react";
import { useRef } from "react";
import { spring } from "@/lib/motion";
import { play } from "@/lib/sfx";
import { cn } from "@/lib/utils";
import type { RemixImage } from "./remix";

/**
 * The remix row in the editor: grab the blank template to finish it
 * elsewhere, or bring your own finished image. Once remixed it shows the
 * upload and a way back to the shared template.
 */
export function RemixBar({
  canDownload,
  remix,
  reading,
  disabled,
  onDownload,
  onFile,
  onReset,
}: {
  /** The round's image can be downloaded (hidden for data: images). */
  canDownload: boolean;
  remix: RemixImage | null;
  /** An upload is being decoded. */
  reading: boolean;
  disabled?: boolean;
  onDownload: () => void;
  onFile: (file: File) => void;
  onReset: () => void;
}) {
  const reduced = useReducedMotion();
  const input = useRef<HTMLInputElement | null>(null);
  const pick = () => {
    if (disabled || reading) return;
    play("tick");
    input.current?.click();
  };

  return (
    <div className="relative shrink-0">
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (file) onFile(file);
        }}
      />
      <AnimatePresence mode="popLayout" initial={false}>
        {remix ? (
          <motion.div
            key="remixed"
            className="flex h-12 items-center gap-2.5 rounded-2xl bg-[linear-gradient(120deg,color-mix(in_oklab,var(--accent-from)_16%,transparent),color-mix(in_oklab,var(--accent-to)_12%,transparent))] p-1.5 pr-1.5 ring-1 ring-[color-mix(in_oklab,var(--accent-from)_45%,transparent)]"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -10, scale: 0.96 }}
            transition={spring.snappy}
          >
            <motion.span
              key={remix.id}
              className="relative size-9 shrink-0 overflow-hidden rounded-xl ring-1 ring-white/20"
              initial={reduced ? false : { rotate: -12, scale: 0.5 }}
              animate={{ rotate: -4, scale: 1 }}
              transition={spring.wobbly}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- the player's own (re-encoded) upload */}
              <img src={remix.src} alt="" className="size-full object-cover" draggable={false} />
            </motion.span>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-[13px] font-bold tracking-tight">Your remix</p>
              <p className="truncate text-[11px] text-ink-300">Only in your entry</p>
            </div>
            <BarButton label="Upload a different image" onClick={pick} disabled={disabled || reading} iconOnly>
              {reading ? <Loader2 className="size-4 animate-spin" /> : <ImageUp className="size-4" />}
            </BarButton>
            <BarButton label="Use the template instead" onClick={onReset} disabled={disabled} tone="solid">
              <Undo2 className="size-4" strokeWidth={2.5} />
              <span className="hidden min-[400px]:inline">Use the template</span>
              <span className="min-[400px]:hidden">Template</span>
            </BarButton>
          </motion.div>
        ) : (
          <motion.div
            key="actions"
            className="flex h-12 items-center gap-1.5 rounded-2xl bg-white/[0.03] p-1.5 pl-3 ring-1 ring-white/[0.08]"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -10, scale: 0.96 }}
            transition={spring.snappy}
          >
            <p className="mr-auto min-w-0 truncate text-[11px] font-bold uppercase tracking-[0.16em] text-ink-400">
              Remix it
            </p>
            {canDownload && (
              <BarButton label="Download the blank template" onClick={onDownload} disabled={disabled}>
                <Download className="size-4" strokeWidth={2.5} />
                Blank
              </BarButton>
            )}
            <BarButton label="Upload your own finished meme" onClick={pick} disabled={disabled || reading} tone="solid">
              {reading ? <Loader2 className="size-4 animate-spin" /> : <ImageUp className="size-4" strokeWidth={2.5} />}
              {reading ? "Reading…" : "Upload your own"}
            </BarButton>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function BarButton({
  label,
  onClick,
  disabled,
  tone = "plain",
  iconOnly,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "plain" | "solid";
  iconOnly?: boolean;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      whileHover={disabled ? undefined : { scale: 1.05 }}
      whileTap={disabled ? undefined : { scale: 0.9 }}
      transition={spring.bouncy}
      className={cn(
        "flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl text-[13px] font-bold tracking-tight transition-[background-color,opacity] disabled:opacity-50",
        iconOnly ? "w-9" : "px-3",
        tone === "plain" && "text-ink-100 ring-1 ring-white/10 hover:bg-white/10",
        tone === "solid" && "bg-ink-50 text-ink-950 hover:bg-white",
      )}
    >
      {children}
    </motion.button>
  );
}

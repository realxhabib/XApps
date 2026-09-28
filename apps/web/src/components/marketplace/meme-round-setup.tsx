"use client";

import { AnimatePresence, motion } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { Check, Dices, Flame, ImagePlus, LayoutGrid, Shuffle, Upload, X as Close } from "lucide-react";
import { useEffect, useId, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { Segmented } from "@/components/ui/segmented";
import { Spinner } from "@/components/ui/spinner";
import { XLogo } from "@/components/ui/x-logo";
import { PHOTO_TEMPLATES } from "@/first-party/meme-duel/photo-templates";
import { TOPIC_MAX, type MemeDrop } from "@/first-party/meme-duel/round";
import { haptic } from "@/lib/haptics";
import { memeImageUrl } from "@/lib/meme-image";
import type { TrendingMeme, TrendingMemes } from "@/lib/trending-memes";
import { BLUR_TWEEN, spring } from "@/lib/motion";
import { play } from "@/lib/sfx";
import { cn } from "@/lib/utils";

/** A dropped image before it's sent: a local file (uploaded on send) or a photo from an X post. */
export type PendingDrop =
  | { kind: "file"; blob: Blob; previewUrl: string; width: number; height: number }
  | { kind: "x"; drop: MemeDrop };

export interface MemeSetup {
  source: "random" | "trending" | "template" | "drop";
  templateId: string | null;
  trending: TrendingMeme | null;
  drop: PendingDrop | null;
  topic: string;
}

export const EMPTY_MEME_SETUP: MemeSetup = { source: "random", templateId: null, trending: null, drop: null, topic: "" };

/** A setup that can be sent: every source but "random" needs a pick. */
export function memeSetupReady(setup: MemeSetup): boolean {
  if (setup.source === "drop") return !!setup.drop;
  if (setup.source === "template") return !!setup.templateId;
  if (setup.source === "trending") return !!setup.trending;
  return true;
}

/** A trending pick as a round: a curated template when we have its caption layout, else a drop. */
export function trendingToRound(meme: TrendingMeme): { templateId: string } | { drop: MemeDrop } {
  const templateId = meme.imgflipId ? `imgflip-${meme.imgflipId}` : null;
  if (templateId && PHOTO_TEMPLATES.some((t) => t.id === templateId)) return { templateId };
  return { drop: { src: meme.src, width: meme.width, height: meme.height, credit: meme.credit } };
}

const TOPICS = [
  "Monday mornings",
  "Group chats",
  "When the Wi-Fi drops",
  "Your screen time report",
  "Replying 'lol' with a straight face",
  "The gym in January",
  "Airport security",
  "Your first job",
  "Reading the terms and conditions",
  "Unread emails",
  "Meetings that could've been an email",
  "Your phone at 1%",
  "Ordering food for the table",
  "Group projects",
  "Autocorrect",
  "Leaving a party",
  "Your algorithm",
  "Being 'on the way'",
  "Tech support for your parents",
  "Your camera roll",
];

function imgflipThumb(src: string): string {
  // imgflip serves small JPEG thumbnails under /4/, even for PNG templates.
  return src.replace("https://i.imgflip.com/", "https://i.imgflip.com/4/").replace(/\.(png|gif)$/i, ".jpg");
}

export function MemeRoundSetup({
  value,
  onChange,
  prepareFile,
}: {
  value: MemeSetup;
  onChange: (next: MemeSetup) => void;
  /** Shrinks a picked file for upload (the backend decides how small). */
  prepareFile: (file: File) => Promise<{ blob: Blob; width: number; height: number }>;
}) {
  const set = (patch: Partial<MemeSetup>) => onChange({ ...value, ...patch });
  const topicId = useId();

  return (
    <section className="mb-5 rounded-3xl border border-white/[0.08] bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">The meme</h3>
        <Segmented
          layoutId="meme-source"
          size="sm"
          value={value.source}
          onChange={(source) => set({ source })}
          items={[
            { id: "random", label: "Surprise", icon: <Shuffle className="size-3.5" /> },
            { id: "trending", label: "Trending", icon: <Flame className="size-3.5" /> },
            { id: "template", label: "Classics", icon: <LayoutGrid className="size-3.5" /> },
            { id: "drop", label: "Drop one", icon: <ImagePlus className="size-3.5" /> },
          ]}
        />
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={value.source}
          initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
          transition={{ ...spring.snappy, filter: BLUR_TWEEN }}
          className="mt-3"
        >
          {value.source === "random" && (
            <p className="text-xs text-ink-400">You&apos;ll both get the same classic template, picked at random when the match starts.</p>
          )}
          {value.source === "trending" && (
            <TrendingPicker selected={value.trending?.id ?? null} onSelect={(trending) => set({ trending })} />
          )}
          {value.source === "template" && (
            <TemplatePicker selected={value.templateId} onSelect={(templateId) => set({ templateId })} />
          )}
          {value.source === "drop" && <DropZone drop={value.drop} onDrop={(drop) => set({ drop })} prepareFile={prepareFile} />}
        </motion.div>
      </AnimatePresence>

      <div className="mt-4">
        <label htmlFor={topicId} className="text-xs font-medium text-ink-300">
          Topic <span className="text-ink-500">(optional)</span>
        </label>
        <div className="mt-1.5 flex h-11 items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] pl-4 pr-1.5 focus-within:border-nova-400/60 focus-within:bg-white/[0.05]">
          <input
            id={topicId}
            value={value.topic}
            maxLength={TOPIC_MAX}
            onChange={(e) => set({ topic: e.target.value })}
            placeholder="e.g. Monday mornings"
            className="h-full w-full bg-transparent text-sm outline-none placeholder:text-ink-500"
          />
          <motion.button
            type="button"
            whileTap={{ scale: 0.85, rotate: -90 }}
            onClick={() => {
              const options = TOPICS.filter((t) => t !== value.topic);
              set({ topic: options[Math.floor(Math.random() * options.length)] });
              play("tick");
            }}
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-300 transition hover:bg-white/10 hover:text-white"
            aria-label="Suggest a topic"
            title="Suggest a topic"
          >
            <Dices className="size-4" />
          </motion.button>
        </div>
      </div>
    </section>
  );
}

function TemplatePicker({ selected, onSelect }: { selected: string | null; onSelect: (id: string) => void }) {
  return (
    <div className="no-scrollbar -mx-4 flex snap-x gap-2.5 overflow-x-auto px-4 pb-1" role="listbox" aria-label="Meme templates">
      {PHOTO_TEMPLATES.map((template, i) => {
        const active = template.id === selected;
        return (
          <motion.button
            type="button"
            key={template.id}
            role="option"
            aria-selected={active}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 10) * 0.025, ...spring.soft } }}
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.94 }}
            onClick={() => {
              onSelect(template.id);
              play("tick");
              haptic("light");
            }}
            className="relative w-24 shrink-0 snap-start text-left"
          >
            <span
              className={cn(
                "relative block aspect-square overflow-hidden rounded-2xl bg-white/5 ring-2 transition",
                active ? "ring-[var(--color-volt)]" : "ring-transparent",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- tiny remote thumbnails */}
              <img src={memeImageUrl(imgflipThumb(template.photo?.src ?? ""))} alt="" loading="lazy" className="size-full object-cover" />
              <AnimatePresence>
                {active && (
                  <motion.span
                    initial={{ scale: 0, rotate: -40 }}
                    animate={{ scale: 1, rotate: 0 }}
                    exit={{ scale: 0 }}
                    transition={spring.wobbly}
                    className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-volt text-ink-950"
                  >
                    <Check className="size-3.5" strokeWidth={3} />
                  </motion.span>
                )}
              </AnimatePresence>
            </span>
            <span className={cn("mt-1.5 line-clamp-2 block text-[11px] leading-tight", active ? "text-ink-50" : "text-ink-400")}>
              {template.name}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}

function TrendingPicker({ selected, onSelect }: { selected: string | null; onSelect: (meme: TrendingMeme) => void }) {
  const trending = useQuery({
    queryKey: ["trending-memes"],
    queryFn: async () => {
      const res = await fetch("/api/trending-memes");
      if (!res.ok) throw new Error("Couldn't load trending memes");
      return (await res.json()) as TrendingMemes;
    },
    staleTime: 10 * 60_000,
  });

  if (trending.isPending) {
    return (
      <div className="-mx-4 flex gap-2.5 overflow-hidden px-4" aria-busy>
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i} className="aspect-square w-24 shrink-0 animate-pulse rounded-2xl bg-white/[0.06]" />
        ))}
      </div>
    );
  }
  if (trending.isError || !trending.data.memes.length) {
    return (
      <p className="text-xs text-ink-400">
        Trending memes aren&apos;t available right now.{" "}
        <button type="button" className="font-semibold text-nova-300 hover:underline" onClick={() => void trending.refetch()}>
          Try again
        </button>
      </p>
    );
  }
  return (
    <>
      <div className="no-scrollbar -mx-4 flex snap-x gap-2.5 overflow-x-auto px-4 pb-1" role="listbox" aria-label="Trending memes">
        {trending.data.memes.map((meme, i) => {
          const active = meme.id === selected;
          return (
            <motion.button
              type="button"
              key={meme.id}
              role="option"
              aria-selected={active}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 10) * 0.025, ...spring.soft } }}
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.94 }}
              onClick={() => {
                onSelect(meme);
                play("tick");
                haptic("light");
              }}
              className="relative w-24 shrink-0 snap-start text-left"
            >
              <span
                className={cn(
                  "relative block aspect-square overflow-hidden rounded-2xl bg-white/5 ring-2 transition",
                  active ? "ring-[var(--color-volt)]" : "ring-transparent",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- remote thumbnails */}
                <img
                  src={memeImageUrl(meme.imgflipId ? imgflipThumb(meme.src) : `${meme.src}?name=small`)}
                  alt=""
                  loading="lazy"
                  className="size-full object-cover"
                />
                {meme.credit && (
                  <span className="absolute bottom-1 left-1 flex size-5 items-center justify-center rounded-full bg-black/75">
                    <XLogo className="size-2.5 text-white" />
                  </span>
                )}
                <AnimatePresence>
                  {active && (
                    <motion.span
                      initial={{ scale: 0, rotate: -40 }}
                      animate={{ scale: 1, rotate: 0 }}
                      exit={{ scale: 0 }}
                      transition={spring.wobbly}
                      className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-volt text-ink-950"
                    >
                      <Check className="size-3.5" strokeWidth={3} />
                    </motion.span>
                  )}
                </AnimatePresence>
              </span>
              <span className={cn("mt-1.5 line-clamp-2 block text-[11px] leading-tight", active ? "text-ink-50" : "text-ink-400")}>
                {meme.credit ? `@${meme.credit.handle}` : meme.title}
              </span>
            </motion.button>
          );
        })}
      </div>
      <p className="mt-1.5 text-[11px] text-ink-500">
        {trending.data.source === "grok" ? "Going viral on X right now, found by Grok." : "Most-captioned templates right now."}
      </p>
    </>
  );
}

function DropZone({
  drop,
  onDrop,
  prepareFile,
}: {
  drop: PendingDrop | null;
  onDrop: (drop: PendingDrop | null) => void;
  prepareFile: (file: File) => Promise<{ blob: Blob; width: number; height: number }>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [hover, setHover] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState("");

  // Release the local preview when it's replaced or the sheet closes.
  const previewUrl = drop?.kind === "file" ? drop.previewUrl : null;
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const takeFile = async (file: File | null | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const { blob, width, height } = await prepareFile(file);
      onDrop({ kind: "file", blob, width, height, previewUrl: URL.createObjectURL(blob) });
      play("pop");
      haptic("success");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't use that image");
      haptic("error");
    } finally {
      setBusy(false);
    }
  };

  const fetchPost = async () => {
    if (!link.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/x-media?url=${encodeURIComponent(link.trim())}`);
      const body = (await res.json()) as Partial<MemeDrop> & { error?: string };
      if (!res.ok || !body.src || !body.width || !body.height) throw new Error(body.error ?? "Couldn't get that post");
      onDrop({ kind: "x", drop: { src: body.src, width: body.width, height: body.height, credit: body.credit ?? null } });
      setLink("");
      play("pop");
      haptic("success");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't get that post");
      haptic("error");
    } finally {
      setBusy(false);
    }
  };

  const onDropFiles = (event: DragEvent) => {
    event.preventDefault();
    setHover(false);
    void takeFile(event.dataTransfer.files[0]);
  };

  const onPaste = (event: ClipboardEvent) => {
    const file = Array.from(event.clipboardData.files).find((f) => f.type.startsWith("image/"));
    if (file) {
      event.preventDefault();
      void takeFile(file);
    }
  };

  const preview = drop ? (drop.kind === "file" ? drop.previewUrl : memeImageUrl(drop.drop.src)) : null;
  const credit = drop?.kind === "x" ? drop.drop.credit : null;

  return (
    <div onPaste={onPaste}>
      <AnimatePresence mode="popLayout" initial={false}>
        {preview ? (
          <motion.div
            key="preview"
            layout
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={spring.bouncy}
            className="relative flex justify-center overflow-hidden rounded-2xl bg-black/40"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- local blob or proxied image */}
            <img src={preview} alt="Your meme image" className="max-h-52 w-auto object-contain" />
            {credit && (
              <a
                href={credit.url}
                target="_blank"
                rel="noreferrer"
                className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-medium text-white"
              >
                <XLogo className="size-3" /> @{credit.handle}
              </a>
            )}
            <motion.button
              type="button"
              whileTap={{ scale: 0.85 }}
              onClick={() => onDrop(null)}
              className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-full bg-black/70 text-white"
              aria-label="Remove image"
            >
              <Close className="size-4" />
            </motion.button>
          </motion.div>
        ) : (
          <motion.button
            key="zone"
            type="button"
            layout
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: hover ? 1.02 : 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={spring.snappy}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setHover(true);
            }}
            onDragLeave={() => setHover(false)}
            onDrop={onDropFiles}
            className={cn(
              "flex w-full flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition-colors",
              hover ? "border-volt/70 bg-volt/[0.06]" : "border-white/15 hover:border-white/30 hover:bg-white/[0.03]",
            )}
          >
            {busy ? <Spinner className="size-5" /> : <Upload className="size-5 text-ink-300" />}
            <span className="text-sm font-semibold">{busy ? "Getting it ready…" : "Upload, drop or paste an image"}</span>
            <span className="text-xs text-ink-400">You both caption it. JPG, PNG, WebP or GIF.</span>
          </motion.button>
        )}
      </AnimatePresence>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          void takeFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {!drop && (
        <form
          className="mt-2.5 flex h-11 items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] pl-3.5 pr-1.5 focus-within:border-nova-400/60"
          onSubmit={(e) => {
            e.preventDefault();
            void fetchPost();
          }}
        >
          <XLogo className="size-3.5 shrink-0 text-ink-300" />
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="…or paste an X post link with a photo"
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-500"
            aria-label="X post link"
            inputMode="url"
          />
          <button
            type="submit"
            disabled={!link.trim() || busy}
            className="h-8 shrink-0 rounded-full bg-white px-3 text-xs font-semibold text-ink-950 transition disabled:opacity-40"
          >
            Use photo
          </button>
        </form>
      )}

      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-2 text-xs text-[#ffb3ba]"
            role="alert"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

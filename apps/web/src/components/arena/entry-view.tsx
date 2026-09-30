"use client";

import { ChevronLeft, ChevronRight, ImageOff, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type KeyboardEvent, type SyntheticEvent } from "react";
import type { SubmissionDisplay } from "@/platform/types";
import { demoMediaId, isAllowedMediaUrl } from "@/lib/media";
import { spring } from "@/lib/motion";
import { svgDataUrl } from "@/lib/svg";
import { cn, hashString } from "@/lib/utils";

const SIDE_STYLES: Record<string, { label: string; className: string }> = {
  for: { label: "For", className: "bg-volt/15 text-volt border-volt/30" },
  against: { label: "Against", className: "bg-flare/15 text-flare border-flare/30" },
};

/** Parses debate tones like "for:2" (side + spice; old Hot Takes entries carry them); other tones render as a plain badge. */
function parseTone(tone?: string): { side?: { label: string; className: string }; spice: number; raw?: string } {
  if (!tone) return { spice: 0 };
  const [side, spice] = tone.split(":");
  const style = side ? SIDE_STYLES[side] : undefined;
  if (style) return { side: style, spice: Number(spice) || 0 };
  return { spice: 0, raw: tone };
}

type Props = { className?: string; compact?: boolean };

/**
 * Renders a contest entry exactly as the app described it. SVG and images go
 * through <img>, so entries from any app can never run script on the host.
 * Images keep their own aspect ratio (memes come in every shape). Video,
 * audio and gallery entries only play media uploaded with `media.upload`
 * (`isAllowedMediaUrl`); anything else shows a placeholder.
 */
export function EntryView({ display, className, compact }: { display: SubmissionDisplay | undefined } & Props) {
  if (!display) {
    return (
      <div className={cn("flex aspect-square items-center justify-center rounded-3xl hairline bg-white/[0.03] text-sm text-ink-400", className)}>
        No entry
      </div>
    );
  }
  switch (display.kind) {
    case "svg":
    case "image": {
      const src = display.kind === "svg" ? svgDataUrl(display.svg) : display.url;
      return (
        // eslint-disable-next-line @next/next/no-img-element -- data: URLs and third-party entries
        <img
          src={src}
          alt={display.alt}
          referrerPolicy="no-referrer"
          draggable={false}
          className={cn("h-auto max-h-[75vh] w-full rounded-3xl bg-ink-900 object-contain shadow-2xl ring-1 ring-white/10", className)}
        />
      );
    }
    case "video":
      return allowed(display.url) ? <VideoEntry display={display} className={className} compact={compact} /> : <Unavailable className={className} />;
    case "audio":
      return allowed(display.url) ? <AudioEntry display={display} className={className} compact={compact} /> : <Unavailable className={className} />;
    case "gallery": {
      const items = Array.isArray(display.items) ? display.items.filter((item) => item && allowed(item.url)) : [];
      return items.length ? <GalleryEntry items={items} className={className} compact={compact} /> : <Unavailable className={className} />;
    }
    case "text":
      return <TextEntry display={display} className={className} compact={compact} />;
    default:
      return <Unavailable className={className} />;
  }
}

function TextEntry({ display, className, compact }: { display: Extract<SubmissionDisplay, { kind: "text" }> } & Props) {
  const tone = parseTone(display.tone);
  return (
    <div
      className={cn(
        "relative flex flex-col overflow-hidden rounded-3xl bg-[linear-gradient(160deg,#1d1320,#120d16)] p-5 shadow-2xl ring-1 ring-white/10",
        compact ? "min-h-40" : "min-h-56",
        className,
      )}
    >
      {tone.spice > 0 && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3"
          style={{
            background: `radial-gradient(ellipse at 50% 120%, rgb(255 110 60 / ${0.12 + tone.spice * 0.1}), transparent 70%)`,
          }}
        />
      )}
      <div className="relative flex items-center gap-2">
        {tone.side && (
          <span className={cn("rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider", tone.side.className)}>
            {tone.side.label}
          </span>
        )}
        {tone.spice > 0 && <span className="text-sm">{"🌶️".repeat(Math.min(3, tone.spice))}</span>}
        {tone.raw && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-ink-200">{tone.raw}</span>}
      </div>
      {display.title && <p className="relative mt-3 text-xs font-semibold text-ink-300">{display.title}</p>}
      <p className={cn("relative mt-2 font-display font-semibold leading-snug text-ink-50", compact ? "text-base" : "text-lg sm:text-xl")}>
        “{display.body}”
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Media helpers                                                          */
/* ---------------------------------------------------------------------- */

function allowed(url: unknown): url is string {
  return typeof url === "string" && isAllowedMediaUrl(url);
}

/** Demo uploads load from our own path whatever origin the app saw; others as given. */
function mediaSrc(url: string): string {
  const id = demoMediaId(url);
  return id ? `/api/demo-media/${id}` : url;
}

/** Controls inside an entry must not trigger the card around it (a vote in the Arena). */
function stop(event: SyntheticEvent) {
  event.stopPropagation();
}

/** Only one entry makes sound at a time: unmuting/playing one quiets the previous. */
let soundOwner: { element: HTMLMediaElement; quiet: () => void } | null = null;
function claimSound(element: HTMLMediaElement, quiet: () => void) {
  if (soundOwner && soundOwner.element !== element) soundOwner.quiet();
  soundOwner = { element, quiet };
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function Unavailable({ className }: { className?: string }) {
  return (
    <div className={cn("flex aspect-video flex-col items-center justify-center gap-2 rounded-3xl hairline bg-white/[0.03] text-sm text-ink-400", className)}>
      <ImageOff className="size-5" />
      Media unavailable
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Video                                                                  */
/* ---------------------------------------------------------------------- */

/** Muted autoplay while at least half on screen, loops, tap for sound. Reduced motion: tap to play. */
function VideoEntry({ display, className, compact }: { display: Extract<SubmissionDisplay, { kind: "video" }> } & Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const reduced = useReducedMotion();
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video || reduced || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry && entry.isIntersecting && entry.intersectionRatio >= 0.5) void video.play().catch(() => undefined);
        else video.pause();
      },
      { threshold: [0, 0.5, 1] },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [reduced]);

  const tap = (event: SyntheticEvent) => {
    stop(event);
    const video = ref.current;
    if (!video) return;
    if (video.paused) {
      void video.play().catch(() => undefined);
      if (!reduced) {
        video.muted = false;
        setMuted(false);
        claimSound(video, () => {
          video.muted = true;
          setMuted(true);
        });
      }
      return;
    }
    const next = !video.muted;
    video.muted = next;
    setMuted(next);
    if (!next) {
      claimSound(video, () => {
        video.muted = true;
        setMuted(true);
      });
    }
  };

  return (
    <div className={cn("group/video relative overflow-hidden rounded-3xl bg-ink-900 shadow-2xl ring-1 ring-white/10", className)}>
      <video
        ref={ref}
        src={mediaSrc(display.url)}
        poster={display.poster && allowed(display.poster) ? mediaSrc(display.poster) : undefined}
        muted={muted}
        loop
        playsInline
        preload="metadata"
        aria-label={display.alt}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        className={cn("block h-auto w-full bg-black object-contain", compact ? "max-h-80" : "max-h-[75vh]")}
      />
      <button
        type="button"
        onClick={tap}
        onKeyDown={stop}
        className="absolute inset-0 flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70"
        aria-label={!playing ? `Play video: ${display.alt}` : muted ? "Unmute video" : "Mute video"}
      >
        <AnimatePresence>
          {!playing && (
            <motion.span
              key="play"
              className="flex size-14 items-center justify-center rounded-full bg-ink-950/60 text-ink-50 backdrop-blur"
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.2 }}
              transition={spring.snappy}
            >
              <Play className="ml-0.5 size-6 fill-current" />
            </motion.span>
          )}
        </AnimatePresence>
        <span className="absolute bottom-2.5 right-2.5 flex h-8 items-center gap-1.5 rounded-full bg-ink-950/60 px-2.5 text-[11px] font-semibold text-ink-50 backdrop-blur">
          {muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
          {muted && playing && !compact && <span>Tap for sound</span>}
        </span>
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Audio                                                                  */
/* ---------------------------------------------------------------------- */

const BARS = 32;

/** A stable pseudo-waveform for a URL (we don't decode audio just to draw bars). */
function waveform(seed: string): number[] {
  let h = hashString(seed) || 1;
  return Array.from({ length: BARS }, (_, i) => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    const noise = ((h >>> 0) % 1000) / 1000;
    const envelope = 0.55 + 0.45 * Math.sin((i / BARS) * Math.PI);
    return Math.max(0.16, Math.min(1, envelope * (0.35 + noise * 0.75)));
  });
}

/** A compact player: cover, play/pause, a seekable waveform and the time. */
function AudioEntry({ display, className, compact }: { display: Extract<SubmissionDisplay, { kind: "audio" }> } & Props) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const bars = waveform(display.url);
  const progress = duration > 0 ? Math.min(1, time / duration) : 0;
  const cover = display.cover && allowed(display.cover) ? mediaSrc(display.cover) : null;
  const hue = hashString(display.url) % 360;

  const toggle = (event: SyntheticEvent) => {
    stop(event);
    const audio = ref.current;
    if (!audio) return;
    if (audio.paused) {
      claimSound(audio, () => audio.pause());
      void audio.play().catch(() => undefined);
    } else {
      audio.pause();
    }
  };

  const seekTo = (ratio: number) => {
    const audio = ref.current;
    if (!audio || !duration) return;
    audio.currentTime = Math.max(0, Math.min(duration, ratio * duration));
    setTime(audio.currentTime);
  };

  const onKey = (event: KeyboardEvent) => {
    stop(event);
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const audio = ref.current;
      if (audio && duration) seekTo((audio.currentTime + (event.key === "ArrowRight" ? 5 : -5)) / duration);
    }
  };

  const art = (
    <span
      className="relative flex size-full items-center justify-center overflow-hidden text-2xl"
      style={{ background: `linear-gradient(135deg, hsl(${hue} 80% 58%), hsl(${(hue + 60) % 360} 75% 42%))` }}
    >
      {cover ? (
        // eslint-disable-next-line @next/next/no-img-element -- uploaded media
        <img src={cover} alt="" draggable={false} className="absolute inset-0 size-full object-cover" />
      ) : (
        <span aria-hidden>🎵</span>
      )}
    </span>
  );

  return (
    <div className={cn("overflow-hidden rounded-3xl bg-ink-900 shadow-2xl ring-1 ring-white/10", className)}>
      {!compact && cover && <div className="aspect-[16/10] w-full">{art}</div>}
      <div className="flex items-center gap-3 p-3">
        {(compact || !cover) && <span className="size-14 shrink-0 overflow-hidden rounded-2xl">{art}</span>}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink-50">{display.alt}</p>
          <div
            role="slider"
            tabIndex={0}
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(time)}
            aria-valuetext={`${formatTime(time)} of ${formatTime(duration)}`}
            onClick={(event) => {
              stop(event);
              const rect = event.currentTarget.getBoundingClientRect();
              seekTo((event.clientX - rect.left) / rect.width);
            }}
            onKeyDown={onKey}
            className="mt-1.5 flex h-8 cursor-pointer items-center gap-[2px] rounded-md outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            {bars.map((height, i) => (
              <span
                key={i}
                className={cn("flex-1 rounded-full transition-colors duration-150", (i + 0.5) / BARS <= progress ? "bg-volt" : "bg-white/20")}
                style={{ height: `${Math.round(height * 100)}%` }}
              />
            ))}
          </div>
          <p className="mt-1 font-mono text-[11px] tabular text-ink-400">
            {formatTime(time)} / {formatTime(duration)}
          </p>
        </div>
        <motion.button
          type="button"
          onClick={toggle}
          onKeyDown={stop}
          whileTap={{ scale: 0.9 }}
          transition={spring.snappy}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-ink-50 text-ink-950 shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900"
          aria-label={playing ? `Pause ${display.alt}` : `Play ${display.alt}`}
        >
          {playing ? <Pause className="size-5 fill-current" /> : <Play className="ml-0.5 size-5 fill-current" />}
        </motion.button>
      </div>
      <audio
        ref={ref}
        src={mediaSrc(display.url)}
        preload="metadata"
        onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
        onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Gallery                                                                */
/* ---------------------------------------------------------------------- */

/** 2–6 images: swipe (scroll snap), dots, arrow keys when focused, arrows on hover. */
function GalleryEntry({ items, className, compact }: { items: { url: string; alt: string }[] } & Props) {
  const track = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);

  const go = (next: number) => {
    const el = track.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(items.length - 1, next));
    el.scrollTo({ left: clamped * el.clientWidth, behavior: reduced ? "auto" : "smooth" });
    setIndex(clamped);
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      stop(event);
      go(index + (event.key === "ArrowRight" ? 1 : -1));
    }
  };

  return (
    <div
      className={cn("group/gallery relative overflow-hidden rounded-3xl bg-ink-900 shadow-2xl ring-1 ring-white/10", className)}
      aria-roledescription="carousel"
      aria-label={`Gallery of ${items.length} images`}
    >
      <div
        ref={track}
        tabIndex={0}
        onKeyDown={onKey}
        onScroll={(event) => {
          const el = event.currentTarget;
          const next = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
          if (next !== index) setIndex(next);
        }}
        className={cn(
          "no-scrollbar flex w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60",
          compact ? "aspect-square" : "aspect-[4/5] max-h-[75vh]",
        )}
      >
        {items.map((item, i) => (
          <div
            key={`${item.url}-${i}`}
            className="flex h-full w-full shrink-0 snap-center items-center justify-center"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${items.length}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- uploaded media */}
            <img src={mediaSrc(item.url)} alt={item.alt} draggable={false} loading={i === 0 ? "eager" : "lazy"} className="size-full object-contain" />
          </div>
        ))}
      </div>
      <span className="pointer-events-none absolute right-2.5 top-2.5 rounded-full bg-ink-950/60 px-2 py-0.5 font-mono text-[11px] font-semibold text-ink-50 backdrop-blur">
        {index + 1}/{items.length}
      </span>
      {(["prev", "next"] as const).map((dir) => {
        const disabled = dir === "prev" ? index === 0 : index === items.length - 1;
        return (
          <button
            key={dir}
            type="button"
            tabIndex={-1}
            disabled={disabled}
            onClick={(event) => {
              stop(event);
              go(index + (dir === "next" ? 1 : -1));
            }}
            className={cn(
              "absolute top-1/2 hidden size-9 -translate-y-1/2 items-center justify-center rounded-full bg-ink-950/60 text-ink-50 opacity-0 backdrop-blur transition group-hover/gallery:opacity-100 disabled:!opacity-0 sm:flex",
              dir === "prev" ? "left-2" : "right-2",
            )}
            aria-label={dir === "prev" ? "Previous image" : "Next image"}
          >
            {dir === "prev" ? <ChevronLeft className="size-5" /> : <ChevronRight className="size-5" />}
          </button>
        );
      })}
      <div className="absolute inset-x-0 bottom-2.5 flex justify-center gap-1.5">
        {items.map((item, i) => (
          <button
            key={`${item.url}-dot-${i}`}
            type="button"
            onClick={(event) => {
              stop(event);
              go(i);
            }}
            onKeyDown={stop}
            aria-label={`Show image ${i + 1}`}
            aria-current={i === index}
            className="flex h-4 items-center px-0.5"
          >
            <motion.span
              className="block h-1.5 rounded-full bg-white shadow"
              animate={{ width: i === index ? 16 : 6, opacity: i === index ? 1 : 0.5 }}
              transition={reduced ? { duration: 0 } : spring.snappy}
            />
          </button>
        ))}
      </div>
    </div>
  );
}

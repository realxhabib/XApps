"use client";

import { useSetup, useXApps } from "@xapps/sdk/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, Dices, Download, Flame, ImagePlus, LayoutGrid, Loader2, Shuffle, Upload, X as Close } from "lucide-react";
import {
  Suspense,
  use,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent,
  type ReactNode,
} from "react";
import { memeDownloadUrl, memeImageUrl } from "@/lib/meme-image";
import { BLUR_TWEEN, spring } from "@/lib/motion";
import { play } from "@/lib/sfx";
import { cn } from "@/lib/utils";
import { CardBack, useBuzz } from "./pieces";
import { firstImageFile } from "./remix";
import { TOPIC_MAX } from "./round";
import {
  CLASSICS,
  SOURCE_LABEL,
  pickName,
  settingsFit,
  setupActionLabel,
  setupFromSettings,
  setupReady,
  setupSummary,
  setupToSettings,
  suggestTopic,
  thumbSrc,
  xMediaToDrop,
  type SetupSource,
  type SetupState,
  type TrendingPick,
  type TrendingResponse,
} from "./setup-logic";
import { shrinkImage } from "./shrink";

const SOURCE_ICON: Record<SetupSource, ReactNode> = {
  random: <Shuffle className="size-4" />,
  trending: <Flame className="size-4" />,
  template: <LayoutGrid className="size-4" />,
  drop: <ImagePlus className="size-4" />,
};

const SOURCES: SetupSource[] = ["random", "trending", "template", "drop"];

/** A dropped file on its way to `media.upload` (the local preview shows right away). */
interface PendingUpload {
  /** Null while the file is being shrunk. */
  previewUrl: string | null;
  status: "preparing" | "uploading";
}

/**
 * Meme Duel's challenge setup (`xapps.purpose === "setup"`), shown inside the
 * challenge sheet: pick a surprise, trending or classic template, or drop an
 * image (upload, paste or an X post), add an optional topic, then submit the
 * round as `match.settings` with a one-line summary for the invite.
 */
export function MemeSetup() {
  const xapps = useXApps();
  const { settings, submit, cancel } = useSetup();
  const buzz = useBuzz();
  const [state, setState] = useState<SetupState>(() => setupFromSettings(settings));
  const [pending, setPending] = useState<PendingUpload | null>(null);
  /** The local preview for the uploaded drop (by its uploaded URL), so it never reloads. */
  const [localPreview, setLocalPreview] = useState<{ src: string; url: string } | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  const [fetchingPost, setFetchingPost] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const uploadSeq = useRef(0);
  const readied = useRef(false);
  /** Object URLs of local previews, released when replaced and on unmount. */
  const objectUrls = useRef<string[]>([]);

  useEffect(() => {
    if (readied.current) return;
    readied.current = true;
    xapps.ready().catch(() => {});
  }, [xapps]);

  useEffect(() => {
    const urls = objectUrls.current;
    return () => urls.splice(0).forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const releasePreviews = useCallback(() => {
    objectUrls.current.splice(0).forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const patch = useCallback((next: Partial<SetupState>) => setState((s) => ({ ...s, ...next })), []);

  const clearDrop = () => {
    uploadSeq.current += 1;
    releasePreviews();
    setPending(null);
    setLocalPreview(null);
    setDropError(null);
    patch({ drop: null });
  };

  /** Shrink → preview → `media.upload`: the returned URL becomes the drop. */
  const takeFile = useCallback(
    async (file: Blob | null | undefined) => {
      if (!file) return;
      const seq = ++uploadSeq.current;
      releasePreviews();
      setDropError(null);
      setLocalPreview(null);
      setPending({ previewUrl: null, status: "preparing" });
      patch({ source: "drop", drop: null });
      let scaled: Awaited<ReturnType<typeof shrinkImage>>;
      try {
        scaled = await shrinkImage(file);
      } catch (e) {
        if (seq !== uploadSeq.current) return;
        setPending(null);
        setDropError(e instanceof Error ? e.message : "Couldn't use that image");
        play("error");
        buzz("error");
        return;
      }
      if (seq !== uploadSeq.current) return;
      const url = URL.createObjectURL(scaled.blob);
      objectUrls.current.push(url);
      setPending({ previewUrl: url, status: "uploading" });
      play("pop");
      try {
        const ref = await xapps.media.upload(scaled.blob, { alt: "Meme Duel image" });
        if (seq !== uploadSeq.current) return;
        setLocalPreview({ src: ref.url, url });
        setPending(null);
        patch({ drop: { drop: { src: ref.url, width: scaled.width, height: scaled.height, credit: null }, origin: "upload" } });
        buzz("success");
      } catch (e) {
        if (seq !== uploadSeq.current) return;
        releasePreviews();
        setPending(null);
        setDropError(e instanceof Error ? e.message : "Upload failed — try again");
        play("error");
        buzz("error");
      }
    },
    [buzz, patch, releasePreviews, xapps],
  );

  // Paste an image anywhere on the screen to drop it.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const file = firstImageFile(event.clipboardData?.files);
      if (!file) return;
      event.preventDefault();
      void takeFile(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [takeFile]);

  const fetchPost = async (link: string) => {
    const seq = ++uploadSeq.current;
    setFetchingPost(true);
    setDropError(null);
    try {
      const res = await fetch(`/api/x-media?url=${encodeURIComponent(link)}`);
      const body: unknown = await res.json().catch(() => null);
      const drop = xMediaToDrop(res.ok, body);
      if (seq !== uploadSeq.current) return false;
      releasePreviews();
      setPending(null);
      setLocalPreview(null);
      patch({ drop: { drop, origin: "x" } });
      play("pop");
      buzz("success");
      return true;
    } catch (e) {
      if (seq === uploadSeq.current) {
        setDropError(e instanceof Error && e.message !== "Failed to fetch" ? e.message : "Couldn't get that post");
        play("error");
        buzz("error");
      }
      return false;
    } finally {
      setFetchingPost(false);
    }
  };

  const uploading = pending?.status === "uploading" || pending?.status === "preparing";
  const ready = setupReady(state) && !uploading;
  const summary = setupSummary(state);
  const settingsKey = JSON.stringify(setupToSettings(state));
  const saved = savedKey === settingsKey;

  const onSubmit = async () => {
    if (!ready || submitting) {
      play("error");
      buzz("error");
      return;
    }
    const out = setupToSettings(state);
    if (!settingsFit(out)) {
      xapps.ui.toast("That round is too big to send — try another image", "danger").catch(() => {});
      return;
    }
    setSubmitting(true);
    try {
      await submit(out, summary);
      setSavedKey(JSON.stringify(out));
    } catch (e) {
      play("error");
      xapps.ui.toast(e instanceof Error ? e.message : "Couldn't save the setup", "danger").catch(() => {});
    } finally {
      setSubmitting(false);
    }
  };

  const onDropFiles = (event: DragEvent) => {
    event.preventDefault();
    void takeFile(firstImageFile(event.dataTransfer.files));
  };

  return (
    <div
      className="mx-auto flex h-dvh w-full max-w-md flex-col"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDropFiles}
    >
      <Header
        state={state}
        preview={state.source !== "drop" ? null : localPreview && localPreview.src === state.drop?.drop.src ? localPreview.url : pending?.previewUrl}
      />

      <SourceTabs
        value={state.source}
        onChange={(source) => {
          patch({ source });
          play("tick");
          buzz("light");
        }}
      />

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-3">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={state.source}
            initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -8, filter: "blur(4px)" }}
            transition={{ ...spring.snappy, filter: BLUR_TWEEN }}
          >
            {state.source === "random" && <SurprisePanel />}
            {state.source === "trending" && (
              <TrendingPanel selected={state.trending} onSelect={(trending) => patch({ trending })} />
            )}
            {state.source === "template" && (
              <ClassicsPanel selected={state.templateId} onSelect={(templateId) => patch({ templateId })} />
            )}
            {state.source === "drop" && (
              <DropPanel
                state={state}
                pending={pending}
                localPreview={localPreview}
                error={dropError}
                fetchingPost={fetchingPost}
                onFile={takeFile}
                onPost={fetchPost}
                onClear={clearDrop}
              />
            )}
          </motion.div>
        </AnimatePresence>

        <TopicField value={state.topic} onChange={(topic) => patch({ topic })} />
      </div>

      <footer className="shrink-0 border-t border-white/[0.08] bg-ink-950/70 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5 backdrop-blur-xl">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.p
            key={summary}
            className="mb-2 truncate text-center text-[11px] text-ink-400"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={spring.snappy}
          >
            <span className="text-ink-500">Invite reads </span>
            <span className="font-semibold text-ink-200">{summary}</span>
          </motion.p>
        </AnimatePresence>
        <div className="flex gap-2">
          <motion.button
            type="button"
            whileTap={{ scale: 0.94 }}
            transition={spring.snappy}
            onClick={() => {
              play("tick");
              cancel().catch(() => {});
            }}
            className="h-12 shrink-0 rounded-full px-5 text-sm font-semibold text-ink-200 ring-1 ring-white/15 transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            Cancel
          </motion.button>
          <motion.button
            type="button"
            whileTap={ready ? { scale: 0.96 } : { x: [0, -6, 5, -3, 0] }}
            whileHover={ready ? { scale: 1.02 } : undefined}
            transition={spring.snappy}
            onClick={() => void onSubmit()}
            aria-disabled={!ready}
            className={cn(
              "relative flex h-12 min-w-0 flex-1 items-center justify-center gap-2 overflow-hidden rounded-full px-5 text-sm font-bold tracking-tight transition-[filter,opacity,background-color]",
              ready
                ? "bg-[linear-gradient(120deg,var(--accent-from),var(--accent-to))] text-ink-950 shadow-[0_12px_36px_-12px_var(--accent-to)] hover:brightness-110"
                : "bg-white/[0.07] text-ink-400",
            )}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={saved ? "saved" : submitting ? "saving" : setupActionLabel(state, uploading)}
                className="flex items-center gap-1.5 truncate"
                initial={{ opacity: 0, y: 12, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -12, filter: "blur(4px)" }}
                transition={{ ...spring.snappy, filter: BLUR_TWEEN }}
              >
                {(submitting || uploading) && <Loader2 className="size-4 animate-spin" />}
                {saved && <Check className="size-4" strokeWidth={3} />}
                {saved ? "Saved" : submitting ? "Saving…" : setupActionLabel(state, uploading)}
              </motion.span>
            </AnimatePresence>
          </motion.button>
        </div>
      </footer>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Header + tabs                                                          */
/* ---------------------------------------------------------------------- */

/** Title plus a little card of what's picked, flipping as the pick changes. */
function Header({ state, preview }: { state: SetupState; preview?: string | null }) {
  const reduced = useReducedMotion();
  const thumb =
    preview ??
    (state.source === "template" && state.templateId
      ? CLASSICS.find((t) => t.id === state.templateId)?.photo?.src
      : state.source === "trending"
        ? state.trending?.src
        : state.source === "drop"
          ? state.drop?.drop.src
          : undefined);
  const src = thumb ? (thumb.startsWith("blob:") ? thumb : memeImageUrl(thumbSrc(thumb))) : null;
  const name = pickName(state);

  return (
    <header className="flex shrink-0 items-center gap-3 px-4 pb-3 pt-4">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-ink-400">Round setup</p>
        <h1 className="truncate font-display text-[22px] leading-tight font-extrabold tracking-tight [font-stretch:92%]">
          <span className="bg-[linear-gradient(100deg,#fff_20%,var(--accent-from)_70%,var(--accent-to))] bg-clip-text text-transparent">
            Pick the meme
          </span>
        </h1>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.p
            key={name ?? state.source}
            className="truncate text-xs text-ink-400"
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 6 }}
            transition={spring.snappy}
          >
            {name ?? (state.source === "random" ? "Same random classic for both of you" : "You both caption the same image")}
          </motion.p>
        </AnimatePresence>
      </div>
      <div className="relative size-14 shrink-0 [--r:14px] [perspective:600px]">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={src ?? "back"}
            className="absolute inset-0"
            initial={reduced ? { opacity: 0 } : { rotateY: -90, opacity: 0, scale: 0.9 }}
            animate={{ rotateY: 0, opacity: 1, scale: 1, rotate: src ? 4 : -4 }}
            exit={reduced ? { opacity: 0 } : { rotateY: 90, opacity: 0, scale: 0.9 }}
            transition={spring.bouncy}
          >
            {src ? (
              <span className="block size-full overflow-hidden rounded-[14px] bg-white/5 shadow-[0_14px_30px_-12px_var(--accent-to)] ring-2 ring-white/20">
                {/* eslint-disable-next-line @next/next/no-img-element -- proxied thumbnail or local preview */}
                <img src={src} alt="" className="size-full object-cover" />
              </span>
            ) : (
              <CardBack />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </header>
  );
}

function SourceTabs({ value, onChange }: { value: SetupSource; onChange: (source: SetupSource) => void }) {
  return (
    <div className="shrink-0 px-4">
      <div role="tablist" aria-label="Meme source" className="grid grid-cols-4 gap-1 rounded-2xl bg-white/[0.05] p-1 ring-1 ring-white/10">
        {SOURCES.map((source) => {
          const active = source === value;
          return (
            <motion.button
              key={source}
              type="button"
              role="tab"
              aria-selected={active}
              whileTap={{ scale: 0.92 }}
              onClick={() => !active && onChange(source)}
              className={cn(
                "relative flex h-12 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-bold tracking-tight transition-colors",
                active ? "text-ink-950" : "text-ink-300 hover:text-white",
              )}
            >
              {active && (
                <motion.span
                  layoutId="meme-setup-source"
                  className="absolute inset-0 rounded-xl bg-[linear-gradient(120deg,var(--accent-from),var(--accent-to))] shadow-[0_8px_24px_-10px_var(--accent-to)]"
                  transition={spring.layout}
                />
              )}
              <span className="relative">{SOURCE_ICON[source]}</span>
              <span className="relative whitespace-nowrap">{SOURCE_LABEL[source]}</span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Panels                                                                 */
/* ---------------------------------------------------------------------- */

function SurprisePanel() {
  const reduced = useReducedMotion();
  return (
    <div className="flex items-center gap-4 rounded-2xl bg-white/[0.04] p-3 ring-1 ring-white/[0.08]">
      <motion.div
        className="size-20 shrink-0 [--r:16px]"
        animate={reduced ? undefined : { y: [0, -4, 0], rotate: [-5, 3, -5] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      >
        <CardBack />
      </motion.div>
      <div className="min-w-0">
        <p className="text-sm font-bold">A surprise classic</p>
        <p className="mt-0.5 text-xs leading-snug text-ink-400">
          You&apos;ll both get the same template, picked at random when the match starts.
        </p>
      </div>
    </div>
  );
}

/** A horizontal strip of square picks. */
function PickRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      className="no-scrollbar -mx-4 flex snap-x scroll-px-4 gap-2.5 overflow-x-auto px-4 pb-1 pt-1 [mask-image:linear-gradient(90deg,transparent,#000_12px,#000_calc(100%-24px),transparent)]"
      role="listbox"
      aria-label={label}
    >
      {children}
    </div>
  );
}

function PickTile({
  src,
  title,
  active,
  index,
  badge,
  onPick,
}: {
  src: string;
  title: string;
  active: boolean;
  index: number;
  badge?: ReactNode;
  onPick: () => void;
}) {
  const buzz = useBuzz();
  return (
    <motion.button
      type="button"
      role="option"
      aria-selected={active}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0, transition: { delay: Math.min(index, 8) * 0.03, ...spring.soft } }}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.94 }}
      onClick={() => {
        onPick();
        play("tick");
        buzz("light");
      }}
      className="relative w-[5.25rem] shrink-0 snap-start text-left"
    >
      <span
        className={cn(
          "relative block aspect-square overflow-hidden rounded-2xl bg-white/5 ring-2 transition-shadow",
          active ? "ring-[var(--accent-from)] shadow-[0_10px_26px_-10px_var(--accent-from)]" : "ring-white/[0.06]",
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- small proxied thumbnails */}
        <img src={src} alt="" loading="lazy" className="size-full object-cover" />
        {badge}
        <AnimatePresence>
          {active && (
            <motion.span
              initial={{ scale: 0, rotate: -40 }}
              animate={{ scale: 1, rotate: 0 }}
              exit={{ scale: 0 }}
              transition={spring.wobbly}
              className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-[var(--accent-from)] text-ink-950 shadow-md"
            >
              <Check className="size-3.5" strokeWidth={3} />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      <span className={cn("mt-1.5 line-clamp-2 text-[11px] leading-tight", active ? "font-semibold text-ink-50" : "text-ink-400")}>
        {title}
      </span>
    </motion.button>
  );
}

/** The picked template's name, a note, and a download of the blank original. */
function PickDetail({ id, title, note, src }: { id: string; title: string; note: ReactNode; src: string }) {
  const download = memeDownloadUrl(src);
  return (
    <motion.div
      key={id}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={spring.snappy}
      className="mt-2 flex items-center gap-3 rounded-2xl bg-white/[0.05] px-3 py-2.5 ring-1 ring-white/[0.06]"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{title}</p>
        <p className="line-clamp-2 text-xs text-ink-400">{note}</p>
      </div>
      {download && (
        <a
          href={download}
          download
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-3 text-xs font-semibold transition hover:bg-white/15"
          title="Download the blank template to remix it anywhere"
        >
          <Download className="size-3.5" /> Blank
        </a>
      )}
    </motion.div>
  );
}

function ClassicsPanel({ selected, onSelect }: { selected: string | null; onSelect: (id: string) => void }) {
  const picked = CLASSICS.find((t) => t.id === selected) ?? null;
  return (
    <>
      <PickRow label="Classic templates">
        {CLASSICS.map((template, i) => (
          <PickTile
            key={template.id}
            src={memeImageUrl(thumbSrc(template.photo!.src))}
            title={template.name}
            active={template.id === selected}
            index={i}
            onPick={() => onSelect(template.id)}
          />
        ))}
      </PickRow>
      <AnimatePresence mode="wait" initial={false}>
        {picked?.photo ? (
          <PickDetail key={picked.id} id={picked.id} title={picked.name} note="You both caption this template." src={picked.photo.src} />
        ) : (
          <Hint key="hint">A template everyone knows. Swipe for more.</Hint>
        )}
      </AnimatePresence>
    </>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return (
    <motion.p className="mt-1.5 text-[11px] text-ink-500" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      {children}
    </motion.p>
  );
}

/* ------------------------------- trending ------------------------------ */

type TrendingResult = { ok: true; data: TrendingResponse } | { ok: false };

let trendingRequest: Promise<TrendingResult> | null = null;

/** Fetched once per page (a retry starts over). Never rejects. */
function loadTrending(retry = false): Promise<TrendingResult> {
  if (!trendingRequest || retry) {
    trendingRequest = fetch("/api/trending-memes")
      .then(async (res) => {
        if (!res.ok) return { ok: false } as const;
        const data = (await res.json()) as TrendingResponse;
        return Array.isArray(data?.memes) ? ({ ok: true, data } as const) : ({ ok: false } as const);
      })
      .catch(() => ({ ok: false }) as const);
  }
  return trendingRequest;
}

function TrendingPanel({ selected, onSelect }: { selected: TrendingPick | null; onSelect: (meme: TrendingPick) => void }) {
  const [request, setRequest] = useState(() => loadTrending());
  return (
    <Suspense fallback={<TrendingSkeleton />}>
      <TrendingList request={request} selected={selected} onSelect={onSelect} onRetry={() => setRequest(loadTrending(true))} />
    </Suspense>
  );
}

function TrendingSkeleton() {
  return (
    <div className="-mx-4 flex gap-2.5 overflow-hidden px-4 pt-0.5" aria-busy>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className="w-[5.25rem] shrink-0">
          <span className="block aspect-square animate-pulse rounded-2xl bg-white/[0.06]" />
          <span className="mt-1.5 block h-2.5 w-3/4 animate-pulse rounded bg-white/[0.06]" />
        </span>
      ))}
    </div>
  );
}

function TrendingList({
  request,
  selected,
  onSelect,
  onRetry,
}: {
  request: Promise<TrendingResult>;
  selected: TrendingPick | null;
  onSelect: (meme: TrendingPick) => void;
  onRetry: () => void;
}) {
  const result = use(request);
  if (!result.ok || !result.data.memes.length) {
    return (
      <div className="rounded-2xl bg-white/[0.04] p-4 text-center ring-1 ring-white/[0.08]">
        <p className="text-sm font-semibold">Trending memes aren&apos;t available right now</p>
        <button type="button" className="mt-2 text-xs font-bold text-[var(--accent-from)] hover:underline" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }
  const { memes, source } = result.data;
  const picked = memes.find((m) => m.id === selected?.id) ?? null;
  return (
    <>
      <PickRow label="Trending memes">
        {memes.map((meme, i) => (
          <PickTile
            key={meme.id}
            src={memeImageUrl(thumbSrc(meme.src))}
            title={meme.title}
            active={meme.id === selected?.id}
            index={i}
            onPick={() => onSelect(meme)}
            badge={
              meme.credit ? (
                <span className="absolute bottom-1 left-1 grid size-5 place-items-center rounded-full bg-black/75">
                  <XMark className="size-2.5 text-white" />
                </span>
              ) : null
            }
          />
        ))}
      </PickRow>
      <AnimatePresence mode="wait" initial={false}>
        {picked ? (
          <PickDetail
            key={picked.id}
            id={picked.id}
            title={picked.title}
            src={picked.src}
            note={
              <>
                {picked.why ?? "You both caption the original template."}
                {picked.examples?.[0] && (
                  <>
                    {" "}
                    <a href={picked.examples[0]} target="_blank" rel="noreferrer" className="font-semibold text-[var(--accent-from)] hover:underline">
                      See it on X
                    </a>
                  </>
                )}
              </>
            }
          />
        ) : (
          <Hint key="hint">
            {source === "grok" ? "Formats going viral on X right now, found by Grok." : "The most-captioned templates right now."}
          </Hint>
        )}
      </AnimatePresence>
    </>
  );
}

/* --------------------------------- drop -------------------------------- */

function DropPanel({
  state,
  pending,
  localPreview,
  error,
  fetchingPost,
  onFile,
  onPost,
  onClear,
}: {
  state: SetupState;
  pending: PendingUpload | null;
  localPreview: { src: string; url: string } | null;
  error: string | null;
  fetchingPost: boolean;
  onFile: (file: Blob | null | undefined) => void;
  onPost: (link: string) => Promise<boolean>;
  onClear: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const linkId = useId();
  const [hover, setHover] = useState(false);
  const [link, setLink] = useState("");
  const drop = state.drop?.drop ?? null;
  const preparing = pending?.status === "preparing";
  const preview = pending
    ? pending.previewUrl
    : drop
      ? localPreview?.src === drop.src
        ? localPreview.url
        : memeImageUrl(drop.src)
      : null;
  const credit = drop?.credit ?? null;

  const onPaste = (event: ReactClipboardEvent) => {
    // The window listener takes pasted images; keep them out of the link field.
    if (firstImageFile(event.clipboardData.files)) event.preventDefault();
  };

  return (
    <div>
      <AnimatePresence mode="popLayout" initial={false}>
        {preview ? (
          <motion.div
            key="preview"
            layout
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={spring.bouncy}
            className="relative flex justify-center overflow-hidden rounded-2xl bg-black/40 ring-1 ring-white/10"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- local preview or proxied image */}
            <img
              src={preview}
              alt="Your meme image"
              className={cn("max-h-44 w-auto object-contain transition-[filter,opacity]", pending && "opacity-60 blur-[1px]")}
            />
            <AnimatePresence>
              {pending?.status === "uploading" && (
                <motion.span
                  key="uploading"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="absolute inset-0 grid place-items-center"
                >
                  <span className="flex items-center gap-2 rounded-full bg-ink-950/80 px-3 py-1.5 text-xs font-semibold ring-1 ring-white/15 backdrop-blur-md">
                    <Loader2 className="size-3.5 animate-spin" /> Uploading…
                  </span>
                </motion.span>
              )}
            </AnimatePresence>
            {credit && (
              <a
                href={credit.url}
                target="_blank"
                rel="noreferrer"
                className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-medium text-white"
              >
                <XMark className="size-3" /> @{credit.handle}
              </a>
            )}
            <motion.button
              type="button"
              whileTap={{ scale: 0.85 }}
              onClick={() => {
                onClear();
                play("tick");
              }}
              className="absolute right-2 top-2 grid size-8 place-items-center rounded-full bg-black/70 text-white"
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
            onDrop={() => setHover(false)}
            className={cn(
              "flex w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed px-4 py-5 text-center transition-colors",
              hover
                ? "border-[var(--accent-from)] bg-[color-mix(in_oklab,var(--accent-from)_10%,transparent)]"
                : "border-white/15 hover:border-white/30 hover:bg-white/[0.03]",
            )}
          >
            <span className="mb-1 grid size-10 place-items-center rounded-full bg-[linear-gradient(135deg,var(--accent-from),var(--accent-to))] text-ink-950 shadow-[0_8px_24px_-10px_var(--accent-to)]">
              {preparing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" strokeWidth={2.5} />}
            </span>
            <span className="text-sm font-bold">{preparing ? "Getting it ready…" : "Upload, drop or paste an image"}</span>
            <span className="text-xs text-ink-400">You both caption it. JPG, PNG, WebP or GIF.</span>
          </motion.button>
        )}
      </AnimatePresence>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        aria-label="Upload an image"
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {!preview && !preparing && (
        <form
          className="mt-2.5 flex h-11 items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] pl-3.5 pr-1.5 focus-within:border-[var(--accent-from)]/60 focus-within:bg-white/[0.05]"
          onSubmit={(e) => {
            e.preventDefault();
            const value = link.trim();
            if (!value || fetchingPost) return;
            void onPost(value).then((ok) => ok && setLink(""));
          }}
        >
          <label htmlFor={linkId} className="sr-only">
            X post link
          </label>
          <XMark className="size-3.5 shrink-0 text-ink-300" />
          <input
            id={linkId}
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onPaste={onPaste}
            placeholder="…or paste an X post link with a photo"
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-500"
            inputMode="url"
            autoComplete="off"
          />
          <motion.button
            type="submit"
            whileTap={{ scale: 0.92 }}
            disabled={!link.trim() || fetchingPost}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-white px-3 text-xs font-bold text-ink-950 transition-opacity disabled:opacity-40"
          >
            {fetchingPost && <Loader2 className="size-3.5 animate-spin" />}
            Use photo
          </motion.button>
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

/* -------------------------------- topic -------------------------------- */

function TopicField({ value, onChange }: { value: string; onChange: (topic: string) => void }) {
  const id = useId();
  const buzz = useBuzz();
  return (
    <div className="mt-4">
      <label htmlFor={id} className="text-xs font-semibold text-ink-300">
        Topic <span className="font-normal text-ink-500">(optional)</span>
      </label>
      <div className="mt-1.5 flex h-11 items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] pl-3.5 pr-1.5 transition-colors focus-within:border-[var(--accent-from)]/60 focus-within:bg-white/[0.05]">
        <input
          id={id}
          value={value}
          maxLength={TOPIC_MAX}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. Monday mornings"
          className="h-full w-full bg-transparent text-sm outline-none placeholder:text-ink-500"
          autoComplete="off"
        />
        <motion.button
          type="button"
          whileTap={{ scale: 0.85, rotate: -90 }}
          onClick={() => {
            onChange(suggestTopic(value));
            play("tick");
            buzz("light");
          }}
          className="grid size-8 shrink-0 place-items-center rounded-full text-ink-300 transition hover:bg-white/10 hover:text-white"
          aria-label="Suggest a topic"
          title="Suggest a topic"
        >
          <Dices className="size-4" />
        </motion.button>
      </div>
    </div>
  );
}

function XMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("fill-current", className)}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

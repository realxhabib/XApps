"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowBigUp } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "@/components/chrome/toasts";
import { haptic } from "@/lib/haptics";
import { ease, spring } from "@/lib/motion";
import { play } from "@/lib/sfx";
import { cn, formatCompact } from "@/lib/utils";
import { useResolveViewer, useViewer } from "@/platform/client";
import { useSetUpvote } from "@/platform/queries";
import type { AppManifest } from "@/platform/types";
import { upvoteBlocker } from "@/platform/upvotes";

/**
 * ▲ + count. Springs up (with a ring burst, a tick and a tap of haptics) when the viewer upvotes,
 * settles back when they take it back. Signed out, it sends them to sign in first. Own and
 * unpublished apps show the count without the button working.
 *
 * On an AppCard (a link) it must be a sibling of the link, never inside it.
 */
export function UpvoteButton({ app, size = "sm", className }: { app: AppManifest; size?: "sm" | "lg"; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const reduced = useReducedMotion();
  const { viewer } = useViewer();
  const resolveViewer = useResolveViewer();
  const upvote = useSetUpvote();
  // Bumps on every click: re-keys the arrow pop and the ring burst. `dir` rolls the count up or down.
  const [bumps, setBumps] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);

  const upvoted = app.upvoted ?? false;
  const count = app.upvotes ?? 0;
  const blocker = upvoteBlocker(app, viewer?.id);
  const large = size === "lg";

  const onClick = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (blocker) return;
    const me = viewer ?? (await resolveViewer());
    if (!me) {
      router.push(`/login?next=${encodeURIComponent(pathname || `/apps/${app.slug}`)}`);
      return;
    }
    if (app.developer.id === me.id) return;
    const on = !upvoted;
    setDir(on ? 1 : -1);
    setBumps((n) => n + 1);
    play("tick");
    haptic(on ? "medium" : "light");
    upvote.mutate(
      { slug: app.slug, on },
      { onError: (error) => toast(error instanceof Error ? error.message : "Couldn't save your upvote", { tone: "danger" }) },
    );
  };

  const label = `${upvoted ? "Remove your upvote from" : "Upvote"} ${app.name} (${count} ${count === 1 ? "upvote" : "upvotes"})`;
  const lit = upvoted && !blocker;

  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={!!blocker}
      aria-pressed={upvoted}
      aria-label={label}
      title={blocker ?? (upvoted ? "Upvoted — click to take it back" : "Upvote")}
      whileHover={blocker || reduced ? undefined : { scale: 1.06 }}
      whileTap={blocker || reduced ? undefined : { scale: 0.86 }}
      transition={spring.snappy}
      className={cn(
        "relative isolate inline-flex shrink-0 items-center justify-center rounded-full font-semibold tabular outline-none transition-colors duration-300 focus-visible:ring-2 focus-visible:ring-white/60",
        large ? "h-14 gap-2 px-5 text-base" : "h-9 gap-1 pl-2 pr-3 text-sm",
        lit ? "text-white shadow-lg" : "glass-strong text-ink-100",
        !blocker && !lit && "hover:text-ink-50",
        blocker && "cursor-default opacity-80",
        className,
      )}
      style={lit ? { background: `linear-gradient(135deg, ${app.accent[0]}, ${app.accent[1]})`, boxShadow: `0 8px 24px -8px ${app.accent[0]}aa` } : undefined}
    >
      {/* Ring burst on upvote */}
      <AnimatePresence>
        {lit && bumps > 0 && !reduced && (
          <motion.span
            key={`ring-${bumps}`}
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 rounded-full border-2"
            style={{ borderColor: app.accent[0] }}
            initial={{ scale: 0.9, opacity: 0.9 }}
            animate={{ scale: 1.7, opacity: 0, transition: { scale: spring.soft, opacity: { duration: 0.55, ease: ease.outExpo } } }}
            exit={{ opacity: 0 }}
          />
        )}
      </AnimatePresence>
      <motion.span
        key={`arrow-${bumps}`}
        aria-hidden
        className="flex"
        initial={bumps > 0 && !reduced ? (lit ? { y: 7, scale: 0.55 } : { y: -4, scale: 0.8 }) : false}
        animate={{ y: 0, scale: 1 }}
        transition={lit ? spring.wobbly : spring.bouncy}
      >
        <ArrowBigUp className={cn(large ? "size-6" : "size-[18px]", lit && "fill-current")} strokeWidth={2.2} />
      </motion.span>
      {large && <span>{upvoted ? "Upvoted" : "Upvote"}</span>}
      <span className={cn("relative inline-flex overflow-hidden", large && "rounded-full bg-black/15 px-2 py-0.5 text-sm")}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={count}
            aria-hidden
            className="inline-block"
            initial={reduced ? { opacity: 0 } : { y: dir * 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { y: dir * -12, opacity: 0 }}
            transition={spring.snappy}
          >
            {formatCompact(count)}
          </motion.span>
        </AnimatePresence>
      </span>
    </motion.button>
  );
}

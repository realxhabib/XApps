"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Flag, Link2, MoreHorizontal, SmilePlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AppGlyph } from "@/components/marketplace/app-glyph";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { haptic } from "@/lib/haptics";
import { play } from "@/lib/sfx";
import { BLUR_TWEEN, spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { MODE_LABEL } from "@/platform/match-utils";
import type { AppManifest, Match, MatchPlayer } from "@/platform/types";

export const REACTIONS = ["🔥", "😂", "😱", "👏", "💀", "🫡"] as const;

export interface HudState {
  status: string | null;
  scores: Record<string, number | string>;
  turn: string | null;
}

function PlayerChip({
  player,
  online,
  score,
  active,
  side,
}: {
  player: MatchPlayer | undefined;
  online: boolean;
  score: number | string | undefined;
  active: boolean;
  side: "left" | "right";
}) {
  return (
    <motion.div
      layout
      className={cn("relative flex min-w-0 items-center gap-2.5 rounded-full py-1 pl-1 pr-3", side === "right" && "flex-row-reverse pl-3 pr-1")}
      animate={{ backgroundColor: active ? "rgb(255 255 255 / 0.1)" : "rgb(255 255 255 / 0)" }}
      transition={spring.soft}
    >
      {active && (
        <motion.span
          layoutId="hud-turn"
          className="absolute inset-0 rounded-full ring-2 ring-[var(--accent-from)]"
          transition={spring.layout}
        />
      )}
      {player ? (
        <Avatar person={{ ...player.profile, isBot: player.isBot }} size={36} online={player.isBot ? true : online} />
      ) : (
        <span className="flex size-9 items-center justify-center rounded-full border border-dashed border-white/25 text-sm text-ink-400">?</span>
      )}
      <div className={cn("hidden min-w-0 sm:block", side === "right" && "text-right")}>
        <p className="truncate text-sm font-semibold leading-tight">{player?.profile.name ?? "Waiting…"}</p>
        <p className="truncate text-[11px] leading-tight text-ink-400">
          {player ? `@${player.profile.handle}` : "open seat"}
          {player?.isBot && " · bot"}
        </p>
      </div>
      <AnimatePresence mode="popLayout">
        {score !== undefined && (
          <motion.span
            key={String(score)}
            initial={{ y: -12, opacity: 0, scale: 0.6 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 12, opacity: 0, scale: 0.6 }}
            transition={spring.bouncy}
            className="min-w-6 text-center font-mono text-lg font-bold tabular"
          >
            {score}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function Hud({
  app,
  match,
  viewerId,
  online,
  hud,
  onBack,
  onReact,
  onForfeit,
  onCopyLink,
}: {
  app: AppManifest;
  match: Match;
  viewerId: string;
  online: Set<string>;
  hud: HudState;
  onBack: () => void;
  onReact: (emoji: string) => void;
  onForfeit?: () => void;
  onCopyLink: () => void;
}) {
  const me = match.players.find((p) => p.userId === viewerId);
  const others = match.players.filter((p) => p.userId !== viewerId && p.state !== "declined");
  const [left, right] = [me, others[0]];
  const [reactOpen, setReactOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen && !reactOpen) return;
    const onDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
        setReactOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menuOpen, reactOpen]);

  return (
    <header className="relative z-30 px-3 pt-3">
      <div className="glass-strong mx-auto flex h-16 max-w-5xl items-center gap-2 rounded-full px-2 shadow-[0_20px_60px_-24px_rgb(0_0_0/0.9)]">
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={onBack}
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-ink-200 transition hover:bg-white/10 hover:text-white"
          aria-label="Leave match"
        >
          <ArrowLeft className="size-5" />
        </motion.button>

        <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
          <PlayerChip
            player={left}
            online={!!left && online.has(left.userId)}
            score={left ? hud.scores[left.userId] : undefined}
            active={!!left && hud.turn === left.userId}
            side="left"
          />
          <div className="hidden min-w-0 flex-col items-center md:flex">
            <div className="flex items-center gap-2">
              <AppGlyph app={app} size={20} />
              <span className="truncate text-sm font-semibold">{app.name}</span>
              <Badge tone={match.mode === "live" ? "live" : match.mode === "practice" ? "neutral" : "nova"} pulse={match.mode === "live"}>
                {MODE_LABEL[match.mode]}
              </Badge>
            </div>
            <AnimatePresence mode="popLayout">
              <motion.p
                key={hud.status ?? "none"}
                initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
                transition={{ ...spring.snappy, filter: BLUR_TWEEN }}
                className="mt-0.5 max-w-64 truncate text-xs text-ink-300"
              >
                {hud.status ?? " "}
              </motion.p>
            </AnimatePresence>
          </div>
          <PlayerChip
            player={right}
            online={!!right && online.has(right.userId)}
            score={right ? hud.scores[right.userId] : undefined}
            active={!!right && hud.turn === right.userId}
            side="right"
          />
        </div>

        <div ref={menuRef} className="relative flex shrink-0 items-center gap-1">
          <motion.button
            whileTap={{ scale: 0.88 }}
            onClick={() => {
              setReactOpen((o) => !o);
              setMenuOpen(false);
              play("pop");
            }}
            className="flex size-11 items-center justify-center rounded-full text-ink-200 transition hover:bg-white/10 hover:text-white"
            aria-label="Send a reaction"
            aria-expanded={reactOpen}
          >
            <SmilePlus className="size-5" />
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.88 }}
            onClick={() => {
              setMenuOpen((o) => !o);
              setReactOpen(false);
            }}
            className="flex size-11 items-center justify-center rounded-full text-ink-200 transition hover:bg-white/10 hover:text-white"
            aria-label="Match options"
            aria-expanded={menuOpen}
          >
            <MoreHorizontal className="size-5" />
          </motion.button>

          <AnimatePresence>
            {reactOpen && (
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.95 }}
                transition={spring.snappy}
                style={{ transformOrigin: "top right" }}
                className="glass-strong absolute right-0 top-14 flex gap-1 rounded-full p-1.5 shadow-2xl"
              >
                {REACTIONS.map((emoji, i) => (
                  <motion.button
                    key={emoji}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0, transition: { delay: i * 0.03, ...spring.bouncy } }}
                    whileHover={{ scale: 1.35, y: -4 }}
                    whileTap={{ scale: 0.8 }}
                    onClick={() => {
                      onReact(emoji);
                      haptic("light");
                    }}
                    className="flex size-11 items-center justify-center rounded-full text-2xl hover:bg-white/10"
                    aria-label={`React ${emoji}`}
                  >
                    {emoji}
                  </motion.button>
                ))}
              </motion.div>
            )}
            {menuOpen && (
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.95 }}
                transition={spring.snappy}
                style={{ transformOrigin: "top right" }}
                className="glass-strong absolute right-0 top-14 w-56 rounded-2xl p-1.5 shadow-2xl"
              >
                <button
                  onClick={() => {
                    onCopyLink();
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm hover:bg-white/[0.07]"
                >
                  <Link2 className="size-4 text-ink-300" /> Copy match link
                </button>
                {onForfeit && (
                  <button
                    onClick={() => {
                      onForfeit();
                      setMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-danger hover:bg-danger/10"
                  >
                    <Flag className="size-4" /> Forfeit match
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      {/* Status line for small screens */}
      <AnimatePresence mode="popLayout">
        {hud.status && (
          <motion.p
            key={hud.status}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-2 text-center text-xs font-medium text-ink-300 md:hidden"
          >
            {hud.status}
          </motion.p>
        )}
      </AnimatePresence>
    </header>
  );
}

interface Floating {
  id: number;
  emoji: string;
  side: "left" | "right";
  x: number;
}

let floatingId = 1;

/** Emoji reactions that float up the screen. Call `push` for local or remote reactions. */
export function useFloatingReactions() {
  const [items, setItems] = useState<Floating[]>([]);
  const push = (emoji: string, side: "left" | "right") => {
    const id = floatingId++;
    setItems((list) => [...list.slice(-24), { id, emoji, side, x: Math.random() }]);
    setTimeout(() => setItems((list) => list.filter((i) => i.id !== id)), 2600);
  };
  return { items, push };
}

export function FloatingReactions({ items }: { items: Floating[] }) {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
      <AnimatePresence>
        {items.map((item) => (
          <motion.span
            key={item.id}
            className="absolute bottom-10 text-5xl drop-shadow-[0_6px_20px_rgb(0_0_0/0.5)]"
            style={{ left: item.side === "left" ? `${6 + item.x * 22}%` : `${72 + item.x * 22}%` }}
            initial={{ y: 40, scale: 0.4, opacity: 0, rotate: 0 }}
            animate={{
              y: "-70vh",
              scale: [0.4, 1.4, 1.1, 1],
              opacity: [0, 1, 1, 0],
              rotate: item.side === "left" ? [0, -12, 10, -6] : [0, 12, -10, 6],
              x: [0, (item.x - 0.5) * 60, (0.5 - item.x) * 40],
            }}
            transition={{ duration: 2.4, ease: [0.22, 1, 0.36, 1] }}
          >
            {item.emoji}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}

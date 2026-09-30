"use client";

import type { PlayerInfo } from "@xapps/sdk";
import { AnimatePresence, motion } from "motion/react";
import { useSyncExternalStore } from "react";
import { Avatar } from "@/components/ui/avatar";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { Balls } from "./physics";
import { ballCss } from "./render";
import { SHOT_MS, groupBalls, type Group } from "./rules";

/* ------------------------------------------------------------------------ */
/* A shared 10 fps clock so only the clocks re-render                       */
/* ------------------------------------------------------------------------ */

let nowValue = Date.now();
let ticker: ReturnType<typeof setInterval> | null = null;
const tickListeners = new Set<() => void>();

function subscribeNow(listener: () => void) {
  tickListeners.add(listener);
  if (!ticker) {
    nowValue = Date.now();
    ticker = setInterval(() => {
      nowValue = Date.now();
      tickListeners.forEach((l) => l());
    }, 100);
  }
  return () => {
    tickListeners.delete(listener);
    if (tickListeners.size === 0 && ticker) {
      clearInterval(ticker);
      ticker = null;
    }
  };
}

export function useNow(): number {
  return useSyncExternalStore(
    subscribeNow,
    () => nowValue,
    () => 0,
  );
}

function formatTimeLeft(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/* ------------------------------------------------------------------------ */
/* Mini balls                                                               */
/* ------------------------------------------------------------------------ */

export function MiniBall({ id, size = 14, className }: { id: number; size?: number; className?: string }) {
  const color = ballCss(id);
  const stripe = id >= 9;
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center rounded-full", className)}
      style={{
        width: size,
        height: size,
        background: stripe
          ? `linear-gradient(to bottom, #f6f3ea 0 24%, ${color} 24% 76%, #f6f3ea 76%)`
          : color,
        boxShadow: "inset -2px -3px 4px rgb(0 0 0 / 0.35), inset 2px 2px 3px rgb(255 255 255 / 0.35), 0 1px 2px rgb(0 0 0 / 0.4)",
      }}
    >
      {size >= 16 && id > 0 && (
        <span
          className="flex items-center justify-center rounded-full bg-[#f6f3ea] font-bold leading-none text-[#161616]"
          style={{ width: size * 0.56, height: size * 0.56, fontSize: size * 0.34 }}
        >
          {id}
        </span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------------ */
/* Player card with the ball tray                                           */
/* ------------------------------------------------------------------------ */

export type CardResult = "win" | "lose" | null;

export function PlayerCard({
  player,
  isMe,
  active,
  group,
  balls,
  onEight,
  result,
  turnStartedAt,
  timed,
  deadline,
  online,
  mirror,
  reduced,
  compact,
}: {
  player: PlayerInfo | undefined;
  isMe: boolean;
  active: boolean;
  group: Group | null;
  balls: Balls;
  onEight: boolean;
  result: CardResult;
  turnStartedAt: number | null;
  timed: boolean;
  deadline: string | null;
  online?: boolean;
  mirror: boolean;
  reduced: boolean;
  compact: boolean;
}) {
  const name = isMe ? "You" : (player?.name ?? "Opponent");
  const ids = group ? groupBalls(group) : [];
  const potted = ids.filter((id) => !balls[id]);
  const accent = group === "stripes" ? "#35e0ff" : "#ffcf3d";
  const trayBall = compact ? 12 : 16;
  return (
    <motion.div
      className={cn(
        "relative isolate flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.035] py-1.5",
        mirror ? "flex-row-reverse pl-2 pr-1.5 text-right" : "pl-1.5 pr-2",
      )}
      animate={result === "lose" && !reduced ? { x: [0, -8, 7, -5, 3, 0], opacity: 0.75 } : { x: 0, opacity: result === "lose" ? 0.75 : 1 }}
      transition={{ x: { duration: 0.5 }, opacity: { duration: 0.4 } }}
    >
      {active && (
        <motion.div
          layoutId="pool-turn"
          className="absolute inset-0 -z-10 rounded-2xl"
          style={{
            background: `linear-gradient(${mirror ? 225 : 135}deg, ${accent}30, ${accent}08 70%)`,
            boxShadow: `inset 0 0 0 2px ${accent}cc, 0 10px 34px -14px ${accent}`,
          }}
          transition={spring.layout}
        />
      )}
      <div className="relative shrink-0">
        {player ? (
          <Avatar person={player} size={compact ? 32 : 40} online={online} />
        ) : (
          <span className="block size-8 rounded-full border border-dashed border-white/25" />
        )}
        {active && timed && turnStartedAt !== null && <ShotClock startedAt={turnStartedAt} size={compact ? 38 : 46} />}
        <AnimatePresence>
          {result === "win" && (
            <motion.span
              aria-hidden
              className="absolute -top-4 left-1/2 -translate-x-1/2 text-base"
              initial={{ y: 12, scale: 0, rotate: -30 }}
              animate={{ y: 0, scale: 1, rotate: -8 }}
              transition={spring.wobbly}
            >
              👑
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <div className={cn("flex min-w-0 flex-1 flex-col gap-1", mirror && "items-end")}>
        <p className="flex max-w-full items-center gap-1.5 truncate text-[13px] font-semibold leading-tight">
          <span className="truncate">{name}</span>
          {group && (
            <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: accent }}>
              {group}
            </span>
          )}
        </p>
        {group ? (
          <div className={cn("flex items-center gap-[3px]", mirror && "flex-row-reverse")} aria-label={`${potted.length} of 7 potted`}>
            {ids.map((id) => (
              <span key={id} className="relative flex items-center justify-center rounded-full bg-black/35" style={{ width: trayBall, height: trayBall }}>
                <AnimatePresence>
                  {!balls[id] && (
                    <motion.span
                      key="in"
                      className="absolute inset-0 flex"
                      initial={reduced ? { opacity: 0 } : { scale: 0, y: -10 }}
                      animate={reduced ? { opacity: 1 } : { scale: 1, y: 0 }}
                      transition={spring.bouncy}
                    >
                      <MiniBall id={id} size={trayBall} />
                    </motion.span>
                  )}
                </AnimatePresence>
              </span>
            ))}
            <span
              className={cn("ml-0.5 rounded-full transition-all", onEight ? "opacity-100" : "opacity-25 grayscale")}
              style={onEight && !reduced ? { boxShadow: `0 0 10px 2px ${accent}` } : undefined}
            >
              <MiniBall id={8} size={trayBall} />
            </span>
          </div>
        ) : (
          <p className="text-[11px] leading-tight text-ink-400">
            {player?.isBot && !isMe ? "@" + player.handle + " · bot" : "Open table"}
          </p>
        )}
        {deadline && active && <DeadlineText deadline={deadline} />}
      </div>
    </motion.div>
  );
}

function ShotClock({ startedAt, size }: { startedAt: number; size: number }) {
  const now = useNow();
  const left = Math.max(0, SHOT_MS - (now - startedAt));
  const frac = left / SHOT_MS;
  const danger = left < 10_000;
  const r = 44;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 100 100" className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-90" style={{ width: size, height: size }} aria-label={`${Math.ceil(left / 1000)} seconds left`}>
      <circle cx="50" cy="50" r={r} fill="none" stroke={danger ? "var(--color-danger)" : "var(--accent-to)"} strokeWidth="6" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} />
    </svg>
  );
}

function DeadlineText({ deadline }: { deadline: string }) {
  const now = useNow();
  const at = Date.parse(deadline);
  if (!Number.isFinite(at) || now === 0) return null;
  return <span className="text-[10px] text-ink-400">{formatTimeLeft(at - now)} left</span>;
}

/* ------------------------------------------------------------------------ */
/* Banner over the table                                                    */
/* ------------------------------------------------------------------------ */

export interface BannerInfo {
  key: string;
  title: string;
  sub?: string;
  tone: "good" | "bad" | "info" | "win" | "lose";
}

export function Banner({ banner, reduced }: { banner: BannerInfo | null; reduced: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
      <AnimatePresence mode="popLayout">
        {banner && (
          <motion.div
            key={banner.key}
            role="status"
            className="flex flex-col items-center gap-1 px-4 text-center"
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.5, rotate: -6, y: 20 }}
            animate={{ opacity: 1, scale: 1, rotate: 0, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.15, y: -12, filter: "blur(6px)" }}
            transition={{ ...spring.wobbly, filter: { duration: 0.25 } }}
          >
            <span
              className={cn(
                "whitespace-nowrap rounded-2xl px-4 py-1.5 font-display text-3xl font-extrabold tracking-tight shadow-[0_10px_40px_rgb(0_0_0/0.55)] sm:text-4xl",
                banner.tone === "bad" && "bg-danger/90 text-white",
                banner.tone === "good" && "bg-[linear-gradient(110deg,var(--accent-from),var(--accent-to))] text-ink-950",
                banner.tone === "info" && "bg-ink-950/80 text-ink-50 ring-1 ring-white/15 backdrop-blur",
                banner.tone === "win" && "bg-[linear-gradient(110deg,#ffe38a,var(--accent-to))] text-ink-950",
                banner.tone === "lose" && "bg-ink-950/85 text-ink-100 ring-1 ring-white/15",
              )}
            >
              {banner.title}
            </span>
            {banner.sub && (
              <motion.span
                className="rounded-full bg-ink-950/75 px-3 py-1 text-xs font-semibold text-ink-100 ring-1 ring-white/10 backdrop-blur"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...spring.snappy, delay: 0.12 }}
              >
                {banner.sub}
              </motion.span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

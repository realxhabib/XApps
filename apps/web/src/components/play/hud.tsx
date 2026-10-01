"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Check, Eye, Flag, Link2, MoreHorizontal, SmilePlus } from "lucide-react";
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
import { isMultiplayer, seatedPlayers, teamOf, teamStyle, type TeamStyle } from "./match-view";
import { ImmersiveButton } from "./immersive";
import { TestBuildBadge } from "./test-build-badge";

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

function RoundCounter({ round }: { round: number }) {
  return (
    <AnimatePresence initial={false}>
      {round > 0 && (
        <motion.span
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.6 }}
          transition={spring.bouncy}
          className="inline-flex h-6 shrink-0 items-center gap-1 overflow-hidden rounded-full bg-white/[0.08] px-2 text-[11px] font-semibold uppercase tracking-wider text-ink-200"
          aria-label={`Round ${round}`}
        >
          <span className="hidden sm:inline">Round</span>
          <span className="sm:hidden">R</span>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={round}
              className="font-mono tabular text-ink-50"
              initial={{ y: 12, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -12, opacity: 0 }}
              transition={spring.snappy}
            >
              {round}
            </motion.span>
          </AnimatePresence>
        </motion.span>
      )}
    </AnimatePresence>
  );
}

function WatchersChip({ spectating, count }: { spectating: boolean; count: number }) {
  if (!spectating && count <= 0) return null;
  return (
    <motion.span
      layout
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={spring.bouncy}
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-semibold",
        spectating ? "bg-flare/15 text-flare ring-1 ring-flare/30" : "bg-white/[0.06] text-ink-300",
      )}
      title={`${count} watching`}
    >
      <Eye className="size-3.5" />
      {spectating && <span className="hidden uppercase tracking-wider sm:inline">Watching</span>}
      {count > 0 && (
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={count}
            className="font-mono tabular"
            initial={{ y: 8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -8, opacity: 0 }}
            transition={spring.snappy}
          >
            {count}
          </motion.span>
        </AnimatePresence>
      )}
    </motion.span>
  );
}

/** One seat in the N-player strip: avatar, turn ring, team tint and a live score. */
function StripSeat({
  player,
  team,
  score,
  active,
  online,
  leader,
  isViewer,
  showName,
  size,
  turnLayoutId,
}: {
  player: MatchPlayer;
  team: TeamStyle | null;
  score: number | string | undefined;
  active: boolean;
  online: boolean;
  leader: boolean;
  isViewer: boolean;
  showName: boolean;
  size: number;
  turnLayoutId: string;
}) {
  const gone = player.state === "left";
  return (
    <motion.div
      layout
      className={cn("relative flex shrink-0 items-center gap-2", gone && "opacity-40 grayscale")}
      title={`@${player.profile.handle}${isViewer ? " (you)" : ""}${player.isBot ? " · bot" : ""}`}
      transition={spring.layout}
    >
      <div className="relative">
        {team && (
          <span
            aria-hidden
            className="absolute -inset-[3px] rounded-full opacity-80"
            style={{ boxShadow: `0 0 0 2px ${team.color}`, background: `radial-gradient(circle, ${team.color}33, transparent 70%)` }}
          />
        )}
        {active && (
          <motion.span
            layoutId={turnLayoutId}
            aria-label="Their turn"
            className="absolute -inset-[5px] rounded-full border-2 border-[var(--accent-from)] shadow-[0_0_10px_var(--accent-from)]"
            transition={spring.layout}
          />
        )}
        <Avatar person={{ ...player.profile, isBot: player.isBot }} size={size} online={player.isBot ? undefined : online} />
        <AnimatePresence>
          {leader && (
            <motion.span
              className="absolute -top-3 left-1/2 -translate-x-1/2 text-sm drop-shadow"
              initial={{ y: 6, opacity: 0, scale: 0.4, rotate: -30 }}
              animate={{ y: 0, opacity: 1, scale: 1, rotate: 0 }}
              exit={{ y: 6, opacity: 0, scale: 0.4 }}
              transition={spring.wobbly}
              aria-label="Leading"
            >
              👑
            </motion.span>
          )}
        </AnimatePresence>
        <AnimatePresence mode="popLayout">
          {score !== undefined ? (
            <motion.span
              key={String(score)}
              initial={{ y: -8, opacity: 0, scale: 0.5 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 8, opacity: 0, scale: 0.5 }}
              transition={spring.bouncy}
              className={cn(
                "absolute -bottom-2 left-1/2 min-w-5 -translate-x-1/2 rounded-full px-1.5 text-center font-mono text-[11px] font-bold leading-4 tabular ring-1",
                isViewer ? "bg-ink-50 text-ink-950 ring-white" : "bg-ink-950 text-ink-50 ring-white/15",
              )}
            >
              {score}
            </motion.span>
          ) : player.state === "submitted" ? (
            <motion.span
              key="done"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={spring.wobbly}
              className="absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full bg-success text-ink-950"
              aria-label="Done"
            >
              <Check className="size-2.5" strokeWidth={4} />
            </motion.span>
          ) : null}
        </AnimatePresence>
      </div>
      {showName && (
        <div className="hidden min-w-0 max-w-24 xl:block">
          <p className="truncate text-[13px] font-semibold leading-tight">{isViewer ? "You" : player.profile.name}</p>
          <p className="truncate text-[11px] leading-tight text-ink-400">@{player.profile.handle}</p>
        </div>
      )}
    </motion.div>
  );
}

function PlayerStrip({
  match,
  players,
  viewerId,
  online,
  scores,
  turn,
  className,
  turnLayoutId,
  size,
}: {
  match: Match;
  players: MatchPlayer[];
  viewerId: string;
  online: Set<string>;
  scores: HudState["scores"];
  turn: string | null;
  className?: string;
  turnLayoutId: string;
  size: number;
}) {
  const numeric = players.map((p) => scores[p.userId]).filter((v): v is number => typeof v === "number");
  const best = numeric.length > 1 ? (match.scoring === "low" ? Math.min(...numeric) : Math.max(...numeric)) : null;
  const leaders = best === null ? [] : players.filter((p) => scores[p.userId] === best);
  const leaderId = leaders.length === 1 && best !== 0 ? leaders[0]!.userId : null;
  return (
    <div className={cn("flex items-center", className)}>
      {players.map((p) => (
        <StripSeat
          key={p.userId}
          player={p}
          team={teamStyle(teamOf(match, p))}
          score={scores[p.userId]}
          active={turn === p.userId}
          online={online.has(p.userId)}
          leader={leaderId === p.userId}
          isViewer={p.userId === viewerId}
          showName={players.length <= 4}
          size={size}
          turnLayoutId={turnLayoutId}
        />
      ))}
    </div>
  );
}

function MatchTitle({ app, match, hud, spectating, spectatorCount }: { app: AppManifest; match: Match; hud: HudState; spectating: boolean; spectatorCount: number }) {
  return (
    <>
      <div className="flex min-w-0 items-center gap-2">
        <AppGlyph app={app} size={20} />
        <span className="truncate text-sm font-semibold">{app.name}</span>
        <Badge
          tone={match.mode === "live" ? "live" : match.mode === "practice" ? "neutral" : "nova"}
          pulse={match.mode === "live"}
          className="hidden sm:inline-flex"
        >
          {MODE_LABEL[match.mode]}
        </Badge>
        <TestBuildBadge match={match} compact className="sm:hidden" />
        <TestBuildBadge match={match} className="hidden sm:inline-flex" />
        <RoundCounter round={match.round ?? 0} />
        <WatchersChip spectating={spectating} count={spectatorCount} />
      </div>
      <AnimatePresence mode="popLayout">
        <motion.p
          key={hud.status ?? "none"}
          initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
          transition={{ ...spring.snappy, filter: BLUR_TWEEN }}
          className="mt-0.5 hidden max-w-64 truncate text-xs text-ink-300 md:block"
        >
          {hud.status ?? " "}
        </motion.p>
      </AnimatePresence>
    </>
  );
}

export function Hud({
  app,
  match,
  viewerId,
  online,
  hud,
  spectating = false,
  spectatorCount = 0,
  onBack,
  onReact,
  onForfeit,
  onCopyLink,
  immersive,
  onToggleImmersive,
}: {
  app: AppManifest;
  match: Match;
  viewerId: string;
  online: Set<string>;
  hud: HudState;
  spectating?: boolean;
  spectatorCount?: number;
  onBack: () => void;
  onReact: (emoji: string) => void;
  onForfeit?: () => void;
  onCopyLink: () => void;
  /** Full-screen mode (see `./immersive`). */
  immersive?: boolean;
  onToggleImmersive?: () => void;
}) {
  const seated = seatedPlayers(match).filter((p) => p.state !== "invited");
  const me = seated.find((p) => p.userId === viewerId);
  const others = seated.filter((p) => p.userId !== viewerId);
  const [left, right] = me ? [me, others[0]] : [others[0], others[1]];
  const multiplayer = isMultiplayer(match);
  const turn = match.turnUserId ?? hud.turn;
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

        {multiplayer ? (
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex min-w-0 flex-1 flex-col md:flex-none">
              <MatchTitle app={app} match={match} hud={hud} spectating={spectating} spectatorCount={spectatorCount} />
            </div>
            <PlayerStrip
              match={match}
              players={seated}
              viewerId={viewerId}
              online={online}
              scores={hud.scores}
              turn={turn}
              turnLayoutId="hud-turn-wide"
              size={36}
              className="ml-auto hidden min-w-0 gap-3 px-1.5 pb-2.5 pt-3.5 md:flex"
            />
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
            <PlayerChip
              player={left}
              online={!!left && online.has(left.userId)}
              score={left ? hud.scores[left.userId] : undefined}
              active={!!left && turn === left.userId}
              side="left"
            />
            <div className="hidden min-w-0 flex-col items-center md:flex">
              <MatchTitle app={app} match={match} hud={hud} spectating={spectating} spectatorCount={spectatorCount} />
            </div>
            <div className="flex items-center gap-1.5 md:hidden">
              <TestBuildBadge match={match} compact />
              <RoundCounter round={match.round ?? 0} />
              <WatchersChip spectating={spectating} count={spectatorCount} />
            </div>
            <PlayerChip
              player={right}
              online={!!right && online.has(right.userId)}
              score={right ? hud.scores[right.userId] : undefined}
              active={!!right && turn === right.userId}
              side="right"
            />
          </div>
        )}

        <div ref={menuRef} className="relative flex shrink-0 items-center gap-0.5 sm:gap-1">
          {onToggleImmersive && <ImmersiveButton immersive={!!immersive} onToggle={onToggleImmersive} className="size-10 sm:size-11" />}
          <motion.button
            whileTap={{ scale: 0.88 }}
            onClick={() => {
              setReactOpen((o) => !o);
              setMenuOpen(false);
              play("pop");
            }}
            className="flex size-10 items-center justify-center rounded-full text-ink-200 transition hover:bg-white/10 hover:text-white sm:size-11"
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
            className="flex size-10 items-center justify-center rounded-full text-ink-200 transition hover:bg-white/10 hover:text-white sm:size-11"
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
                  <Link2 className="size-4 text-ink-300" /> {spectating ? "Copy link to watch" : "Copy match link"}
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

      {/* Player strip for small screens (3+ players) */}
      {multiplayer && (
        <motion.div
          className="mt-2 flex justify-center md:hidden"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring.soft}
        >
          <PlayerStrip
            match={match}
            players={seated}
            viewerId={viewerId}
            online={online}
            scores={hud.scores}
            turn={turn}
            turnLayoutId="hud-turn-narrow"
            size={seated.length > 6 ? 30 : 34}
            className={cn(
              "glass no-scrollbar max-w-full overflow-x-auto rounded-full px-3 pb-3 pt-3.5",
              seated.length > 6 ? "gap-2.5" : "gap-3.5",
            )}
          />
        </motion.div>
      )}

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

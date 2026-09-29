"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { AtSign, Bot, Check, Copy, Crown, Eye, Play, Plus, Swords, UserPlus, X as XIcon } from "lucide-react";
import { Fragment, useDeferredValue, useEffect, useRef, useState } from "react";
import { toast } from "@/components/chrome/toasts";
import { AppGlyph } from "@/components/marketplace/app-glyph";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { XLogo } from "@/components/ui/x-logo";
import { haptic } from "@/lib/haptics";
import { play } from "@/lib/sfx";
import { BLUR_TWEEN, spring } from "@/lib/motion";
import { useMounted } from "@/lib/use-mounted";
import { cn } from "@/lib/utils";
import { MODE_LABEL } from "@/platform/match-utils";
import { useBackend } from "@/platform/client";
import { useSearchProfiles } from "@/platform/queries";
import type { AppManifest, Match, MatchPlayer, Profile } from "@/platform/types";
import { maxSeats, SEAT_COLORS, seatedPlayers, tableSizeLabelForMatch, teamStyle } from "./match-view";
import { TestBuildBadge } from "./test-build-badge";

function useElapsed(since: string): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const seconds = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function Radar({ viewer, target, accent }: { viewer: Profile; target?: MatchPlayer; accent: [string, string] }) {
  return (
    <div className="relative mx-auto flex size-64 items-center justify-center sm:size-72">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="absolute inset-0 rounded-full border border-white/10"
          initial={{ scale: 0.3, opacity: 0.7 }}
          animate={{ scale: 1.1, opacity: 0 }}
          transition={{ duration: 3, repeat: Infinity, delay: i, ease: "easeOut" }}
        />
      ))}
      <div className="absolute inset-4 rounded-full border border-white/[0.07]" />
      <div className="absolute inset-16 rounded-full border border-white/[0.07]" />
      <div
        className="absolute inset-0 animate-radar rounded-full motion-reduce:animate-none"
        style={{ background: `conic-gradient(from 0deg, transparent 0deg, ${accent[0]}55 50deg, transparent 90deg)` }}
      />
      <motion.div className="relative" animate={{ scale: [1, 1.05, 1] }} transition={{ duration: 2, repeat: Infinity }}>
        <Avatar person={viewer} size={88} />
      </motion.div>
      {target && (
        <motion.div
          className="absolute -right-2 top-6"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1, y: [0, -6, 0] }}
          transition={{ scale: spring.bouncy, y: { duration: 2.6, repeat: Infinity } }}
        >
          <div className="rounded-full p-1 ring-2 ring-white/20">
            <Avatar person={target.profile} size={52} />
          </div>
        </motion.div>
      )}
    </div>
  );
}

function ShareBox({ link, text, buttonLabel = "Post the challenge on X" }: { link: string; text: string; buttonLabel?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mx-auto mt-6 w-full max-w-md">
      <div className="flex items-center gap-2 rounded-full glass p-1.5 pl-4">
        <span className="min-w-0 flex-1 truncate text-left font-mono text-xs text-ink-300">{link}</span>
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied(true);
              play("pop");
              setTimeout(() => setCopied(false), 1800);
            } catch {
              // ignore
            }
          }}
          className="flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-3.5 text-xs font-semibold transition hover:bg-white/15"
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={copied ? "ok" : "copy"}
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.5, opacity: 0 }}
              className="flex items-center gap-1.5"
            >
              {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
              {copied ? "Copied" : "Copy"}
            </motion.span>
          </AnimatePresence>
        </motion.button>
      </div>
      <Button
        className="mt-3 w-full"
        variant="primary"
        size="lg"
        icon={<XLogo className="size-4" />}
        onClick={() => {
          const intent = new URL("https://x.com/intent/post");
          intent.searchParams.set("text", text);
          intent.searchParams.set("url", link);
          window.open(intent.toString(), "_blank", "noopener,noreferrer,width=600,height=520");
        }}
      >
        {buttonLabel}
      </Button>
    </div>
  );
}

/** Challenger's (and every seated player's) view while the table fills up. */
export function Lobby({
  app,
  match,
  viewer,
  onCancel,
  onStart,
  onPlayBot,
  cancelling,
  starting,
  watching,
}: {
  app: AppManifest;
  match: Match;
  viewer: Profile;
  /** Creator only. */
  onCancel?: () => void;
  /** Creator only: start early once the minimum is seated. */
  onStart?: () => void;
  onPlayBot?: () => void;
  cancelling?: boolean;
  starting?: boolean;
  /** The viewer is a spectator waiting for the match to start. */
  watching?: boolean;
}) {
  if (maxSeats(match) > 2 || match.teams >= 2 || watching) {
    return (
      <TableLobby
        app={app}
        match={match}
        viewer={viewer}
        onCancel={onCancel}
        onStart={onStart}
        cancelling={cancelling}
        starting={starting}
        watching={watching}
      />
    );
  }
  return <DuelLobby app={app} match={match} viewer={viewer} onCancel={onCancel} onPlayBot={onPlayBot} cancelling={cancelling} />;
}

function DuelLobby({
  app,
  match,
  viewer,
  onCancel,
  onPlayBot,
  cancelling,
}: {
  app: AppManifest;
  match: Match;
  viewer: Profile;
  onCancel?: () => void;
  onPlayBot?: () => void;
  cancelling?: boolean;
}) {
  const elapsed = useElapsed(match.createdAt);
  const invited = match.players.find((p) => p.state === "invited");
  const quick = match.settings.quick === true;
  const [showBot, setShowBot] = useState(false);
  const mounted = useMounted();
  const link = mounted ? `${window.location.origin}/play/${match.id}` : "";

  useEffect(() => {
    const t = setTimeout(() => setShowBot(true), 8000);
    return () => clearTimeout(t);
  }, [match.id]);

  const headline = invited
    ? `Waiting for @${invited.profile.handle}`
    : quick
      ? "Finding an opponent"
      : "Waiting for a challenger";

  return (
    <motion.div
      className="mx-auto flex w-full max-w-xl flex-col items-center px-4 pt-6 text-center"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring.soft}
    >
      <div className="flex items-center gap-2">
        <AppGlyph app={app} size={28} />
        <span className="font-semibold">{app.name}</span>
        <Badge tone="nova">{MODE_LABEL[match.mode]}</Badge>
        <TestBuildBadge match={match} />
      </div>
      <Radar viewer={viewer} target={invited} accent={app.accent} />
      <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{headline}</h1>
      <p className="mt-2 font-mono text-sm text-ink-400 tabular">{elapsed}</p>
      {invited ? (
        <p className="mt-3 max-w-sm text-sm text-ink-300">
          They&apos;ll get a notification. Nudge them on X to make it happen faster.
        </p>
      ) : (
        <p className="mt-3 max-w-sm text-sm text-ink-300">
          {quick ? "Hang tight — or share the link and pull in a friend." : "Anyone with the link can take the seat."}
        </p>
      )}

      {link && (
        <ShareBox
          link={link}
          text={
            invited
              ? `@${invited.profile.handle} I challenged you to ${app.name} on XApps ⚡ Accept if you dare:`
              : typeof match.settings.topic === "string"
                ? `Caption battle on XApps ${app.icon} Topic: "${match.settings.topic}". Think you're funnier than me?`
                : match.settings.drop
                  ? `I dropped a meme on XApps ${app.icon} Caption it better than me:`
                  : `I challenge anyone to ${app.name} on XApps ${app.icon} Think you can beat me?`
          }
        />
      )}

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <AnimatePresence>
          {onPlayBot && showBot && (
            <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={spring.bouncy}>
              <Button variant="glass" icon={<Bot className="size-4" />} onClick={onPlayBot}>
                Play a bot instead
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
        {onCancel && (
          <Button variant="ghost" icon={<XIcon className="size-4" />} onClick={onCancel} loading={cancelling}>
            Cancel challenge
          </Button>
        )}
      </div>
    </motion.div>
  );
}

type Slot = { seat: number; player: MatchPlayer | null; team: number | null };

function buildSlots(match: Match): Slot[] {
  const seated = seatedPlayers(match);
  const total = Math.max(maxSeats(match), seated.length);
  const bySeat = new Map<number, MatchPlayer>();
  const floating: MatchPlayer[] = [];
  for (const p of seated) {
    if (p.seat !== null && p.seat < total && !bySeat.has(p.seat)) bySeat.set(p.seat, p);
    else floating.push(p);
  }
  return Array.from({ length: total }, (_, seat) => {
    const player = bySeat.get(seat) ?? (bySeat.size < total ? null : null);
    return { seat, player: player ?? null, team: match.teams >= 2 ? seat % match.teams : null };
  }).map((slot) => (slot.player || floating.length === 0 ? slot : { ...slot, player: floating.shift() ?? null }));
}

/** N-seat lobby: a live seat grid, invites, share link and the creator's Start. */
function TableLobby({
  app,
  match,
  viewer,
  onCancel,
  onStart,
  cancelling,
  starting,
  watching,
}: {
  app: AppManifest;
  match: Match;
  viewer: Profile;
  onCancel?: () => void;
  onStart?: () => void;
  cancelling?: boolean;
  starting?: boolean;
  watching?: boolean;
}) {
  const reduced = useReducedMotion();
  const elapsed = useElapsed(match.createdAt);
  const mounted = useMounted();
  const link = mounted ? `${window.location.origin}/play/${match.id}` : "";
  const slots = buildSlots(match);
  const total = slots.length;
  const filled = slots.filter((s) => s.player && s.player.state !== "invited").length;
  const invitedCount = slots.filter((s) => s.player?.state === "invited").length;
  const min = Math.max(2, match.minPlayers || 2);
  const canStart = filled >= min;
  const host = match.players.find((p) => p.userId === match.createdBy);
  const inviteRef = useRef<HTMLInputElement>(null);

  // Every new arrival gets a pop.
  const lastFilled = useRef(filled);
  useEffect(() => {
    if (filled > lastFilled.current) {
      play("pop");
      haptic("light");
    }
    lastFilled.current = filled;
  }, [filled]);

  const headline = watching
    ? "The table is filling up"
    : filled >= total
      ? "Table's full"
      : filled >= min
        ? onStart
          ? "Ready when you are"
          : `Waiting for @${host?.profile.handle ?? "the host"} to start`
        : "Filling the table";

  const teams = match.teams >= 2 ? match.teams : 0;
  const columns = teams
    ? Array.from({ length: teams }, (_, t) => slots.filter((s) => s.team === t))
    : [slots];

  return (
    <motion.div
      className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 pt-4 text-center"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring.soft}
    >
      <div className="flex flex-wrap items-center justify-center gap-2">
        <AppGlyph app={app} size={28} />
        <span className="font-semibold">{app.name}</span>
        <Badge tone="nova">{MODE_LABEL[match.mode]}</Badge>
        <Badge>{tableSizeLabelForMatch(match)}</Badge>
        <TestBuildBadge match={match} />
        {watching && (
          <Badge tone="flare">
            <Eye className="size-3" /> Watching
          </Badge>
        )}
      </div>

      <AnimatePresence mode="popLayout" initial={false}>
        <motion.h1
          key={headline}
          className="mt-5 font-display text-3xl font-extrabold tracking-tight sm:text-4xl"
          initial={{ opacity: 0, y: 12, filter: "blur(6px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -12, filter: "blur(6px)" }}
          transition={{ ...spring.soft, filter: BLUR_TWEEN }}
        >
          {headline}
        </motion.h1>
      </AnimatePresence>
      <div className="mt-2 flex items-center gap-3 text-sm text-ink-400">
        <span>
          <span className="inline-flex overflow-hidden align-bottom font-mono font-semibold text-ink-100 tabular">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={filled}
                initial={{ y: reduced ? 0 : 14, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: reduced ? 0 : -14, opacity: 0 }}
                transition={spring.snappy}
              >
                {filled}
              </motion.span>
            </AnimatePresence>
          </span>{" "}
          of {total} seated
          {invitedCount > 0 && ` · ${invitedCount} invited`}
        </span>
        <span className="font-mono tabular">{elapsed}</span>
      </div>

      {/* Seat grid */}
      <LayoutGroup>
        <div className={cn("mt-6 w-full", teams === 2 ? "grid grid-cols-[1fr_auto_1fr] items-start gap-2 sm:gap-4" : teams ? "grid gap-4 sm:grid-cols-2" : "")}>
          {columns.map((column, ci) => {
            const style = teams ? teamStyle(ci) : null;
            return (
              <Fragment key={ci}>
                {teams === 2 && ci === 1 && (
                  <span className="self-center font-display text-2xl font-extrabold italic text-ink-400 sm:text-3xl" style={{ fontVariationSettings: "'wdth' 75" }}>
                    VS
                  </span>
                )}
                <div
                  className={cn("rounded-[1.75rem]", style && "p-2 sm:p-3")}
                  style={style ? { background: `linear-gradient(180deg, ${style.color}22, transparent 70%)`, boxShadow: `inset 0 0 0 1px ${style.color}33` } : undefined}
                >
                  {style && (
                    <p className="mb-2 flex items-center justify-center gap-1.5 text-xs font-bold uppercase tracking-[0.18em]" style={{ color: style.color }}>
                      <span className="size-2 rounded-full" style={{ background: style.color }} />
                      {style.name}
                    </p>
                  )}
                  <div
                    className={cn(
                      "grid gap-2 sm:gap-3",
                      teams ? "grid-cols-1 sm:grid-cols-2" : total <= 4 ? "grid-cols-2 sm:grid-cols-4" : total <= 6 ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-4",
                      teams === 2 && column.length <= 2 && "sm:grid-cols-1",
                    )}
                  >
                    {column.map((slot) => (
                      <SeatCard
                        key={slot.seat}
                        slot={slot}
                        match={match}
                        viewerId={viewer.id}
                        accent={style?.color ?? SEAT_COLORS[slot.seat % SEAT_COLORS.length]!}
                        onOpenClick={onStart ? () => inviteRef.current?.focus() : undefined}
                      />
                    ))}
                  </div>
                </div>
              </Fragment>
            );
          })}
        </div>
      </LayoutGroup>

      {/* Start / waiting */}
      {!watching && (
        <div className="mt-6 flex w-full max-w-md flex-col items-center gap-2">
          {onStart ? (
            <>
              <Button
                size="xl"
                variant={canStart ? "accent" : "glass"}
                className="w-full"
                icon={<Play className="size-5" />}
                disabled={!canStart}
                loading={starting}
                onClick={onStart}
                magnetic={canStart}
              >
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={canStart ? `go-${filled}` : "wait"}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={spring.snappy}
                  >
                    {canStart ? (filled >= total ? "Start the match" : `Start with ${filled}`) : `Need ${min - filled} more to start`}
                  </motion.span>
                </AnimatePresence>
              </Button>
              <p className="text-xs text-ink-400">
                {canStart && filled < total
                  ? "Start now and unfilled invites are withdrawn — or wait for a full table."
                  : `Starts automatically when all ${total} seats are taken.`}
              </p>
            </>
          ) : (
            <p className="text-sm text-ink-300">
              {filled >= min ? "The host can start any moment." : `The match starts once ${min} players are in.`} Stay on this page.
            </p>
          )}
        </div>
      )}

      {onStart && filled + invitedCount < total && <InviteMore match={match} inputRef={inviteRef} />}

      {link && (
        <ShareBox
          link={link}
          buttonLabel={watching ? "Share on X" : "Post the table on X"}
          text={
            watching
              ? `A ${app.name} match is about to start on XApps ${app.icon} Come watch:`
              : `${total - filled} seat${total - filled === 1 ? "" : "s"} left at my ${app.name} table on XApps ${app.icon} Pull up a chair:`
          }
        />
      )}

      {onCancel && (
        <div className="mt-6">
          <Button variant="ghost" icon={<XIcon className="size-4" />} onClick={onCancel} loading={cancelling}>
            Cancel match
          </Button>
        </div>
      )}
    </motion.div>
  );
}

function SeatCard({
  slot,
  match,
  viewerId,
  accent,
  onOpenClick,
}: {
  slot: Slot;
  match: Match;
  viewerId: string;
  accent: string;
  onOpenClick?: () => void;
}) {
  const reduced = useReducedMotion();
  const p = slot.player;
  const state = !p ? "open" : p.state === "invited" ? "invited" : "filled";
  const isHost = p?.userId === match.createdBy;
  const isMe = p?.userId === viewerId;
  return (
    <motion.div
      layout
      transition={spring.layout}
      className={cn(
        "relative flex min-h-36 flex-col items-center justify-center overflow-hidden rounded-3xl px-2 py-4",
        state === "filled" && "glass",
        state === "invited" && "border border-dashed border-white/20 bg-white/[0.03]",
        state === "open" && "border border-dashed border-white/12 bg-white/[0.015]",
        isMe && "ring-1 ring-volt/50",
      )}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {state === "open" ? (
          <motion.button
            key="open"
            type="button"
            onClick={onOpenClick}
            disabled={!onOpenClick}
            className="flex flex-col items-center gap-2 text-ink-400 transition enabled:hover:text-ink-100"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={spring.snappy}
            aria-label={`Seat ${slot.seat + 1} is open`}
          >
            <motion.span
              className="flex size-14 items-center justify-center rounded-full border-2 border-dashed border-white/20"
              animate={reduced ? undefined : { scale: [1, 1.05, 1], borderColor: ["rgb(255 255 255 / 0.18)", "rgb(255 255 255 / 0.32)", "rgb(255 255 255 / 0.18)"] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut", delay: slot.seat * 0.2 }}
            >
              <Plus className="size-5" />
            </motion.span>
            <span className="text-xs font-semibold">Open seat</span>
          </motion.button>
        ) : (
          <motion.div
            key={`${p!.userId}-${state}`}
            className="flex w-full min-w-0 flex-col items-center gap-2"
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.3, rotate: -18, y: 10 }}
            animate={{ opacity: 1, scale: 1, rotate: 0, y: 0 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={spring.bouncy}
          >
            <div className="relative">
              {state === "filled" && !reduced && (
                <motion.span
                  aria-hidden
                  className="absolute inset-0 rounded-full"
                  style={{ boxShadow: `0 0 0 3px ${accent}` }}
                  initial={{ scale: 0.8, opacity: 1 }}
                  animate={{ scale: 1.9, opacity: 0 }}
                  transition={{ duration: 0.7, ease: "easeOut" }}
                />
              )}
              {state === "invited" && !reduced && (
                <motion.span
                  aria-hidden
                  className="absolute -inset-1.5 rounded-full border-2 border-dashed"
                  style={{ borderColor: `${accent}99` }}
                  animate={{ rotate: 360 }}
                  transition={{ duration: 9, repeat: Infinity, ease: "linear" }}
                />
              )}
              <div className={cn(state === "invited" && "opacity-55 grayscale-[40%]")}>
                <Avatar person={{ ...p!.profile, isBot: p!.isBot }} size={56} />
              </div>
              {isHost && (
                <span className="absolute -right-1 -top-1 flex size-6 items-center justify-center rounded-full bg-gold text-ink-950 ring-2 ring-ink-900" title="Host">
                  <Crown className="size-3.5" />
                </span>
              )}
            </div>
            <div className="w-full min-w-0 px-1">
              <p className="truncate text-sm font-semibold">{isMe ? "You" : p!.profile.name}</p>
              <p className="truncate text-[11px] text-ink-400">@{p!.profile.handle}</p>
            </div>
            {state === "invited" && (
              <span className="flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink-300">
                <span className="size-1.5 animate-ping-soft rounded-full bg-current motion-reduce:animate-none" />
                Invited
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/** Pull more people in: search a handle and invite them to an open seat. */
function InviteMore({
  match,
  inputRef,
}: {
  match: Match;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const backend = useBackend();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query.trim());
  const people = useSearchProfiles(deferred, deferred.length > 0);
  const [pending, setPending] = useState<string | null>(null);
  const taken = new Set(match.players.map((p) => p.userId));
  const results = (people.data ?? []).filter((p) => !p.isBot || backend.kind === "demo").slice(0, 4);

  const invite = async (profile: Profile) => {
    setPending(profile.id);
    try {
      const updated = await backend.inviteToMatch(match.id, [profile.handle]);
      queryClient.setQueryData(["match", match.id], updated);
      play("whoosh");
      haptic("light");
      toast(`Invited @${profile.handle}`, { description: "They'll get a notification.", tone: "success" });
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't send the invite", { tone: "danger" });
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="mt-6 w-full max-w-md text-left">
      <label className="flex h-12 items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 focus-within:border-nova-400/60 focus-within:bg-white/[0.05]">
        <UserPlus className="size-4 text-ink-400" />
        <AtSign className="-mr-1 size-3.5 text-ink-400" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value.replace(/^@/, ""))}
          placeholder="Invite someone by handle"
          className="h-full w-full bg-transparent text-sm outline-none placeholder:text-ink-500"
          aria-label="Invite someone by handle"
        />
      </label>
      <AnimatePresence initial={false}>
        {deferred && (
          <motion.div
            className="overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={spring.soft}
          >
            <div className="mt-2 space-y-1">
              {results.map((profile, i) => {
                const done = taken.has(profile.id);
                return (
                  <motion.div
                    key={profile.id}
                    className="flex items-center gap-3 rounded-2xl px-3 py-2 hover:bg-white/[0.04]"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0, transition: { delay: i * 0.03 } }}
                  >
                    <Avatar person={profile} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{profile.name}</span>
                      <span className="block truncate text-xs text-ink-400">@{profile.handle}</span>
                    </span>
                    <Button
                      size="sm"
                      variant={done ? "ghost" : "glass"}
                      icon={done ? <Check className="size-3.5 text-success" /> : <UserPlus className="size-3.5" />}
                      disabled={done}
                      loading={pending === profile.id}
                      onClick={() => invite(profile)}
                    >
                      {done ? "At the table" : "Invite"}
                    </Button>
                  </motion.div>
                );
              })}
              {people.data && results.length === 0 && (
                <p className="px-3 py-3 text-center text-sm text-ink-400">Nobody new called @{deferred} — share the link instead.</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Invitee's (or link visitor's) view of a challenge. */
export function InviteCard({
  app,
  match,
  viewer,
  onAccept,
  onDecline,
  onWatch,
  accepting,
  watching,
}: {
  app: AppManifest;
  match: Match;
  viewer: Profile | null;
  onAccept: () => void;
  onDecline?: () => void;
  /** Watch as a spectator instead of taking a seat. */
  onWatch?: () => void;
  accepting?: boolean;
  watching?: boolean;
}) {
  const challenger = match.players.find((p) => p.userId === match.createdBy) ?? match.players[0];
  const scoreToBeat = match.mode === "async" && challenger?.state === "submitted" ? challenger.score : null;
  const table = maxSeats(match) > 2 || match.teams >= 2;
  const seated = seatedPlayers(match).filter((p) => p.state !== "invited" && p.userId !== viewer?.id);
  const total = maxSeats(match);
  const taken = seatedPlayers(match).filter((p) => p.state !== "invited").length;
  const running = match.status === "active";
  return (
    <motion.div
      className="mx-auto w-full max-w-lg px-4 pt-8"
      initial={{ opacity: 0, y: 30, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={spring.soft}
    >
      <div className="relative overflow-hidden rounded-[2.2rem] p-[1.5px]" style={{ background: `linear-gradient(140deg, ${app.accent[0]}, transparent 40%, ${app.accent[1]})` }}>
        <div className="relative rounded-[2.1rem] bg-ink-900/95 p-7 text-center">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-24 left-1/2 size-72 -translate-x-1/2 rounded-full opacity-30 blur-3xl"
            style={{ background: app.accent[0] }}
          />
          {table ? (
            <div className="relative flex items-center justify-center">
              <div className="flex -space-x-3">
                {seated.slice(0, 5).map((p, i) => (
                  <motion.div
                    key={p.userId}
                    className="rounded-full ring-4 ring-ink-900"
                    initial={{ y: 20, opacity: 0, scale: 0.6 }}
                    animate={{ y: 0, opacity: 1, scale: 1 }}
                    transition={{ delay: 0.08 + i * 0.06, ...spring.bouncy }}
                  >
                    <Avatar person={{ ...p.profile, isBot: p.isBot }} size={60} />
                  </motion.div>
                ))}
                {!running &&
                  Array.from({ length: Math.min(3, Math.max(0, total - taken)) }).map((_, i) => (
                    <motion.span
                      key={`open-${i}`}
                      className="flex size-[60px] items-center justify-center rounded-full border-2 border-dashed border-white/25 bg-ink-900 text-ink-400 ring-4 ring-ink-900"
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.35 + i * 0.06, ...spring.wobbly }}
                    >
                      {i === 0 && viewer ? <Avatar person={viewer} size={52} className="opacity-70" /> : <Plus className="size-5" />}
                    </motion.span>
                  ))}
              </div>
            </div>
          ) : (
            <div className="relative flex items-center justify-center gap-4">
              {challenger && (
                <motion.div initial={{ x: -30, opacity: 0, rotate: -10 }} animate={{ x: 0, opacity: 1, rotate: 0 }} transition={{ delay: 0.1, ...spring.bouncy }}>
                  <Avatar person={challenger.profile} size={72} />
                </motion.div>
              )}
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1, rotate: [0, -10, 10, 0] }}
                transition={{ delay: 0.3, scale: spring.wobbly, rotate: { duration: 0.6, ease: "easeInOut" } }}
                className="flex size-12 items-center justify-center rounded-full bg-white/10"
              >
                <Swords className="size-5" />
              </motion.span>
              <motion.div initial={{ x: 30, opacity: 0, rotate: 10 }} animate={{ x: 0, opacity: 1, rotate: 0 }} transition={{ delay: 0.15, ...spring.bouncy }}>
                {viewer ? (
                  <Avatar person={viewer} size={72} />
                ) : (
                  <span className="flex size-[72px] items-center justify-center rounded-full border-2 border-dashed border-white/25 text-2xl">?</span>
                )}
              </motion.div>
            </div>
          )}
          <h1 className="relative mt-6 font-display text-3xl font-extrabold leading-tight tracking-tight">
            {running
              ? `${app.name} is live`
              : table
                ? `@${challenger?.profile.handle ?? "someone"} saved you a seat`
                : `@${challenger?.profile.handle ?? "someone"} challenges you`}
          </h1>
          <div className="relative mt-3 flex flex-wrap items-center justify-center gap-2 text-sm text-ink-300">
            <AppGlyph app={app} size={22} />
            <span className="font-semibold text-ink-100">{app.name}</span>·<span>{MODE_LABEL[match.mode]}</span>
            <TestBuildBadge match={match} />
            {table && (
              <>
                ·<span>{tableSizeLabelForMatch(match)}</span>
                {!running && (
                  <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-xs tabular">
                    {taken}/{total} seated
                  </span>
                )}
              </>
            )}
          </div>
          {scoreToBeat !== null && (
            <motion.div
              className="relative mx-auto mt-5 inline-flex items-baseline gap-2 rounded-2xl bg-white/[0.05] px-4 py-2"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.4, ...spring.bouncy }}
            >
              <span className="text-xs uppercase tracking-widest text-ink-400">Score to beat</span>
              <span className="font-mono text-2xl font-bold text-gold">{scoreToBeat}</span>
            </motion.div>
          )}
          <ol className="relative mx-auto mt-6 max-w-sm space-y-2 text-left text-sm text-ink-300">
            {app.howTo.map((step, i) => (
              <motion.li
                key={step}
                className="flex gap-3"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.35 + i * 0.07 }}
              >
                <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px] font-bold text-ink-100")}>
                  {i + 1}
                </span>
                {step}
              </motion.li>
            ))}
          </ol>
          <div className="relative mt-7 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
            {!running && (
              <Button size="xl" variant="accent" onClick={onAccept} loading={accepting} magnetic className="sm:min-w-44">
                {viewer ? (table ? "Take a seat" : "Accept challenge") : "Sign in to accept"}
              </Button>
            )}
            {onWatch && (
              <Button size="xl" variant={running ? "accent" : "glass"} icon={<Eye className="size-5" />} onClick={onWatch} loading={watching} magnetic={running}>
                {running ? "Watch live" : "Just watch"}
              </Button>
            )}
            {onDecline && viewer && (
              <Button size="xl" variant="ghost" onClick={onDecline}>
                Decline
              </Button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

"use client";

import { AnimatePresence, motion } from "motion/react";
import { Bot, Check, Copy, Swords, X as XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { AppGlyph } from "@/components/marketplace/app-glyph";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { XLogo } from "@/components/ui/x-logo";
import { play } from "@/lib/sfx";
import { spring } from "@/lib/motion";
import { useMounted } from "@/lib/use-mounted";
import { cn } from "@/lib/utils";
import { MODE_LABEL } from "@/platform/match-utils";
import type { AppManifest, Match, MatchPlayer, Profile } from "@/platform/types";

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

function ShareBox({ link, text }: { link: string; text: string }) {
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
        Post the challenge on X
      </Button>
    </div>
  );
}

/** Challenger's view while waiting for someone to accept or join. */
export function Lobby({
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
  onCancel: () => void;
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
        <Button variant="ghost" icon={<XIcon className="size-4" />} onClick={onCancel} loading={cancelling}>
          Cancel challenge
        </Button>
      </div>
    </motion.div>
  );
}

/** Invitee's (or link visitor's) view of a challenge. */
export function InviteCard({
  app,
  match,
  viewer,
  onAccept,
  onDecline,
  accepting,
}: {
  app: AppManifest;
  match: Match;
  viewer: Profile | null;
  onAccept: () => void;
  onDecline?: () => void;
  accepting?: boolean;
}) {
  const challenger = match.players.find((p) => p.userId === match.createdBy) ?? match.players[0];
  const scoreToBeat = match.mode === "async" && challenger?.state === "submitted" ? challenger.score : null;
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
          <h1 className="relative mt-6 font-display text-3xl font-extrabold leading-tight tracking-tight">
            @{challenger?.profile.handle ?? "someone"} challenges you
          </h1>
          <div className="relative mt-3 flex items-center justify-center gap-2 text-sm text-ink-300">
            <AppGlyph app={app} size={22} />
            <span className="font-semibold text-ink-100">{app.name}</span>·<span>{MODE_LABEL[match.mode]}</span>
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
            <Button size="xl" variant="accent" onClick={onAccept} loading={accepting} magnetic className="sm:min-w-44">
              {viewer ? "Accept challenge" : "Sign in to accept"}
            </Button>
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

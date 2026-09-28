"use client";

import { AnimatePresence, motion } from "motion/react";
import { AtSign, Check, Link2, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useDeferredValue, useState } from "react";
import { toast } from "@/components/chrome/toasts";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { play } from "@/lib/sfx";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { MODE_LABEL } from "@/platform/match-utils";
import { useCreateChallenge, useSearchProfiles } from "@/platform/queries";
import type { AppManifest, Profile } from "@/platform/types";

type Target = { kind: "person"; profile: Profile } | { kind: "open" };

export function ChallengeSheet({
  app,
  open,
  onClose,
  initialOpponent,
}: {
  app: AppManifest;
  open: boolean;
  onClose: () => void;
  initialOpponent?: Profile;
}) {
  const router = useRouter();
  const modes = app.modes.filter((m): m is "live" | "async" => m !== "practice");
  const [mode, setMode] = useState<"live" | "async">(modes[0] ?? "live");
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query.trim());
  const [target, setTarget] = useState<Target | null>(initialOpponent ? { kind: "person", profile: initialOpponent } : null);
  const people = useSearchProfiles(deferred, open);
  const create = useCreateChallenge();

  const send = async () => {
    if (!target) return;
    try {
      const match = await create.mutateAsync({
        appSlug: app.slug,
        mode,
        opponentHandle: target.kind === "person" ? target.profile.handle : null,
      });
      play("whoosh");
      toast(target.kind === "person" ? `Challenge sent to @${target.profile.handle}` : "Open challenge created", {
        tone: "success",
        description: mode === "async" ? "You can play your turn right now." : "We'll start the moment they join.",
      });
      onClose();
      router.push(`/play/${match.id}`);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't send the challenge", { tone: "danger" });
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={`Challenge someone to ${app.name}`} description="Pick a rival, or make an open link anyone can take.">
      {modes.length > 1 && (
        <Segmented
          layoutId="challenge-mode"
          value={mode}
          onChange={setMode}
          items={modes.map((m) => ({ id: m, label: MODE_LABEL[m] }))}
          className="mb-4"
          size="sm"
        />
      )}
      <p className="mb-4 text-xs text-ink-400">
        {mode === "live"
          ? "Live: you both play at the same time, head to head."
          : "Play anytime: you go now, they answer whenever they're ready."}
      </p>

      <label className="flex h-12 items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 focus-within:border-nova-400/60 focus-within:bg-white/[0.05]">
        <Search className="size-4 text-ink-400" />
        <AtSign className="-mr-1 size-3.5 text-ink-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value.replace(/^@/, ""))}
          placeholder="handle"
          className="h-full w-full bg-transparent text-sm outline-none placeholder:text-ink-500"
          aria-label="Search players by handle"
          data-autofocus
        />
      </label>

      <div className="mt-3 max-h-64 space-y-1 overflow-y-auto">
        <motion.button
          layout
          onClick={() => setTarget({ kind: "open" })}
          className={cn(
            "flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition",
            target?.kind === "open" ? "bg-white/10" : "hover:bg-white/[0.05]",
          )}
        >
          <span className="flex size-10 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--color-nova-500),var(--color-flare))]">
            <Link2 className="size-4" />
          </span>
          <span className="flex-1">
            <span className="block text-sm font-semibold">Open challenge</span>
            <span className="block text-xs text-ink-400">Share a link — first taker plays you</span>
          </span>
          <AnimatePresence>{target?.kind === "open" && <Tick />}</AnimatePresence>
        </motion.button>
        {(people.data ?? []).map((profile, i) => {
          const selected = target?.kind === "person" && target.profile.id === profile.id;
          return (
            <motion.button
              layout
              key={profile.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0, transition: { delay: i * 0.03 } }}
              onClick={() => {
                setTarget({ kind: "person", profile });
                play("tick");
              }}
              className={cn(
                "flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition",
                selected ? "bg-white/10" : "hover:bg-white/[0.05]",
              )}
            >
              <Avatar person={profile} size={40} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{profile.name}</span>
                <span className="block truncate text-xs text-ink-400">@{profile.handle}</span>
              </span>
              <AnimatePresence>{selected && <Tick />}</AnimatePresence>
            </motion.button>
          );
        })}
        {deferred && people.data?.length === 0 && (
          <p className="px-3 py-4 text-center text-sm text-ink-400">
            Nobody called @{deferred} here yet — send them an open challenge link instead.
          </p>
        )}
      </div>

      <Button className="mt-5 w-full" size="lg" variant="accent" disabled={!target} loading={create.isPending} onClick={send} magnetic>
        {target?.kind === "person" ? `Challenge @${target.profile.handle}` : target?.kind === "open" ? "Create open challenge" : "Pick a rival"}
      </Button>
    </Dialog>
  );
}

function Tick() {
  return (
    <motion.span
      initial={{ scale: 0, rotate: -40 }}
      animate={{ scale: 1, rotate: 0 }}
      exit={{ scale: 0 }}
      transition={spring.wobbly}
      className="flex size-6 items-center justify-center rounded-full bg-volt text-ink-950"
    >
      <Check className="size-3.5" strokeWidth={3} />
    </motion.span>
  );
}

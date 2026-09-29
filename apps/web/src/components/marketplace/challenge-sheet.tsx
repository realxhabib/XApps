"use client";

import { AnimatePresence, motion, useAnimate, useReducedMotion } from "motion/react";
import { AtSign, Check, Link2, Minus, Plus, Search, Settings2, X as XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useDeferredValue, useState } from "react";
import { toast } from "@/components/chrome/toasts";
import { tableSizeLabel } from "@/components/play/match-view";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { haptic } from "@/lib/haptics";
import { play } from "@/lib/sfx";
import { BLUR_TWEEN, spring } from "@/lib/motion";
import { clamp, cn } from "@/lib/utils";
import { MODE_LABEL } from "@/platform/match-utils";
import { useViewer } from "@/platform/client";
import { useCreateChallenge, useSearchProfiles } from "@/platform/queries";
import { AppSetupFrame, type AppSetupResult } from "./app-setup-frame";
import type { AppManifest, Profile } from "@/platform/types";

/** Table sizes the app allows (multiples of the team count in team play). */
function tableRange(app: AppManifest): { min: number; max: number; step: number } {
  const step = (app.teams ?? 0) >= 2 ? app.teams! : 1;
  const max = Math.max(2, app.players.max);
  const min = Math.min(max, Math.ceil(Math.max(2, app.players.min) / step) * step);
  return { min, max, step };
}

function tableLabel(app: AppManifest, size: number): string {
  const teams = app.teams ?? 0;
  if (teams >= 2) return tableSizeLabel({ players: { min: size, max: size }, teams });
  return `${size} players`;
}

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
  const reduced = useReducedMotion();
  const { viewer } = useViewer();
  const modes = app.modes.filter((m): m is "live" | "async" => m !== "practice");
  const [mode, setMode] = useState<"live" | "async">(modes[0] ?? "live");
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query.trim());
  const people = useSearchProfiles(deferred, open);
  const create = useCreateChallenge();
  const [chipsScope, animateChips] = useAnimate();

  const multi = app.players.max > 2;
  const range = tableRange(app);
  const [rivals, setRivals] = useState<Profile[]>(initialOpponent ? [initialOpponent] : []);
  /** 1v1 only: an open link instead of a named rival. */
  const [openLink, setOpenLink] = useState(false);
  /** Null until the challenger picks a size: then it follows the invites. */
  const [pickedSize, setPickedSize] = useState<number | null>(null);
  const autoSize = rivals.length === 0 ? range.max : clamp(Math.ceil((rivals.length + 1) / range.step) * range.step, range.min, range.max);
  const tableSize = multi ? (pickedSize ?? autoSize) : 2;
  const openSeats = Math.max(0, tableSize - 1 - rivals.length);

  // `setup: true` apps render their own setup screen (setup purpose) in the sheet.
  const appSetup = !!app.setup;
  const [setup, setSetup] = useState<AppSetupResult | null>(null);
  const [setupOpen, setSetupOpen] = useState(appSetup);

  const picked = multi ? true : openLink || rivals.length > 0;
  // Setup is optional: an app that isn't set up gets empty settings and uses its defaults.
  const ready = picked;

  const refuse = () => {
    play("error");
    haptic("error");
    if (!reduced && chipsScope.current) void animateChips(chipsScope.current, { x: [0, -8, 7, -5, 3, 0] }, { duration: 0.4 });
  };

  const toggle = (profile: Profile) => {
    if (!multi) {
      setRivals([profile]);
      setOpenLink(false);
      play("tick");
      return;
    }
    if (rivals.some((r) => r.id === profile.id)) {
      setRivals((list) => list.filter((r) => r.id !== profile.id));
      play("tick");
      return;
    }
    const need = rivals.length + 2;
    if (need > range.max) {
      refuse();
      toast(`The table seats ${range.max} at most`, { tone: "info" });
      return;
    }
    // Grow the table if the invites no longer fit.
    if (pickedSize !== null && need > pickedSize) setPickedSize(clamp(Math.ceil(need / range.step) * range.step, range.min, range.max));
    setRivals((list) => [...list, profile]);
    play("pop");
    haptic("light");
  };

  const stepSize = (dir: 1 | -1) => {
    const next = clamp(tableSize + dir * range.step, range.min, range.max);
    if (next === tableSize) return;
    if (next < rivals.length + 1) {
      refuse();
      toast("Remove an invite to shrink the table", { tone: "info" });
      return;
    }
    setPickedSize(next);
    play("tick");
    haptic("light");
  };

  const send = async () => {
    if (!ready) return;
    try {
      const handles = rivals.map((r) => r.handle);
      const match = await create.mutateAsync({
        appSlug: app.slug,
        mode,
        opponentHandle: !multi && rivals[0] ? rivals[0].handle : null,
        opponentHandles: multi && handles.length > 0 ? handles : undefined,
        maxPlayers: multi ? tableSize : undefined,
        settings: appSetup ? (setup?.settings ?? {}) : undefined,
      });
      play("whoosh");
      const names = rivals.map((r) => `@${r.handle}`);
      toast(
        names.length === 0
          ? multi
            ? `Open ${tableLabel(app, tableSize)} table created`
            : "Open challenge created"
          : names.length === 1
            ? `Challenge sent to ${names[0]}`
            : `Invites sent to ${names.slice(0, -1).join(", ")} and ${names.at(-1)}`,
        {
          tone: "success",
          description:
            mode === "async" ? "You can play your turn right now." : multi ? "We'll start when the table fills — or you start it early." : "We'll start the moment they join.",
        },
      );
      onClose();
      router.push(`/play/${match.id}`);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't send the challenge", { tone: "danger" });
    }
  };

  const label = !picked
    ? "Pick a rival"
    : multi
        ? rivals.length === 0
          ? `Open a ${tableLabel(app, tableSize)} table`
          : `Invite ${rivals.length}${openSeats > 0 ? ` + ${openSeats} open` : ""}`
        : rivals[0]
          ? `Challenge @${rivals[0].handle}`
          : "Create open challenge";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={multi ? `Start a ${app.name} table` : `Challenge someone to ${app.name}`}
      description={
        multi
          ? `Invite up to ${range.max - 1} rivals, or leave seats open for anyone with the link.`
          : "Pick a rival, or make an open link anyone can take."
      }
    >
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
          ? multi
            ? "Live: everyone plays at the same time."
            : "Live: you both play at the same time, head to head."
          : app.turnBased
            ? "Play anytime: take your turns whenever — each turn has 3 days."
            : multi
              ? "Play anytime: you go now, everyone else plays when they're ready."
              : "Play anytime: you go now, they answer whenever they're ready."}
      </p>

      {multi && (
        <div className="mb-4 rounded-3xl bg-white/[0.03] p-3 ring-1 ring-white/[0.07]">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Table size</p>
              <p className="text-xs text-ink-400">
                {range.min === range.max ? "Fixed by the app" : `${tableSizeLabel(app)} · pick how many sit down`}
              </p>
            </div>
            <div className="flex items-center gap-1 rounded-full glass p-1">
              <motion.button
                type="button"
                whileTap={{ scale: 0.85 }}
                onClick={() => stepSize(-1)}
                disabled={tableSize <= range.min}
                className="flex size-9 items-center justify-center rounded-full transition hover:bg-white/10 disabled:opacity-30"
                aria-label="Fewer seats"
              >
                <Minus className="size-4" />
              </motion.button>
              <span className="relative flex h-9 min-w-24 items-center justify-center overflow-hidden text-sm font-semibold tabular">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={tableSize}
                    initial={{ y: 16, opacity: 0, filter: "blur(4px)" }}
                    animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
                    exit={{ y: -16, opacity: 0, filter: "blur(4px)" }}
                    transition={{ ...spring.snappy, filter: BLUR_TWEEN }}
                  >
                    {tableLabel(app, tableSize)}
                  </motion.span>
                </AnimatePresence>
              </span>
              <motion.button
                type="button"
                whileTap={{ scale: 0.85 }}
                onClick={() => stepSize(1)}
                disabled={tableSize >= range.max}
                className="flex size-9 items-center justify-center rounded-full transition hover:bg-white/10 disabled:opacity-30"
                aria-label="More seats"
              >
                <Plus className="size-4" />
              </motion.button>
            </div>
          </div>

          {/* You + invites + open seats */}
          <div ref={chipsScope} className="mt-3 flex flex-wrap items-center gap-1.5">
            {viewer && (
              <span className="flex h-8 items-center gap-1.5 rounded-full bg-white/10 py-1 pl-1 pr-2.5 text-xs font-semibold">
                <Avatar person={viewer} size={24} /> You
              </span>
            )}
            <AnimatePresence mode="popLayout" initial={false}>
              {rivals.map((r) => (
                <motion.button
                  layout
                  key={r.id}
                  type="button"
                  onClick={() => toggle(r)}
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.5 }}
                  transition={spring.bouncy}
                  className="group flex h-8 items-center gap-1.5 rounded-full bg-nova-500/20 py-1 pl-1 pr-2 text-xs font-semibold text-nova-300 ring-1 ring-nova-400/30"
                  aria-label={`Remove @${r.handle}`}
                >
                  <Avatar person={r} size={24} />@{r.handle}
                  <XIcon className="size-3.5 opacity-60 transition group-hover:opacity-100" />
                </motion.button>
              ))}
              {Array.from({ length: openSeats }).map((_, i) => (
                <motion.span
                  layout
                  key={`open-${i}`}
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.5 }}
                  transition={spring.bouncy}
                  className="flex h-8 items-center gap-1 rounded-full border border-dashed border-white/20 px-2.5 text-xs text-ink-400"
                >
                  <Plus className="size-3" /> open
                </motion.span>
              ))}
            </AnimatePresence>
          </div>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.p
              key={`${rivals.length}-${openSeats}`}
              className="mt-2 text-xs text-ink-400"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={spring.snappy}
            >
              {openSeats === 0
                ? "Every seat has a name on it."
                : `${openSeats} open seat${openSeats === 1 ? "" : "s"} — anyone with the link can sit down.`}{" "}
              {tableSize > app.players.min && mode === "live" && `You can start once ${app.players.min} are in.`}
            </motion.p>
          </AnimatePresence>
        </div>
      )}

      {appSetup && viewer && (
        <div className="mb-4">
          <AnimatePresence mode="popLayout" initial={false}>
            {setupOpen ? (
              <AppSetupFrame
                key="frame"
                app={app}
                viewer={viewer}
                mode={mode}
                rivals={rivals}
                tableSize={tableSize}
                initial={setup?.settings}
                onSubmit={(result) => {
                  setSetup(result);
                  setSetupOpen(false);
                }}
                onCancel={() => (setup ? setSetupOpen(false) : onClose())}
              />
            ) : (
              <motion.div
                key="summary"
                className="flex items-center gap-3 rounded-2xl bg-white/[0.04] p-2 pl-3 ring-1 ring-white/[0.08]"
                initial={{ opacity: 0, scale: 0.9, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={spring.bouncy}
              >
                <span
                  className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-950"
                  style={{ background: `linear-gradient(135deg, ${app.accent[0]}, ${app.accent[1]})` }}
                >
                  {setup ? <Check className="size-4" strokeWidth={3} /> : <Settings2 className="size-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] uppercase tracking-wider text-ink-400">Round setup</span>
                  <span className="block truncate text-sm font-semibold">{setup ? (setup.summary ?? "Custom settings") : "Not set up yet"}</span>
                </span>
                <Button size="sm" variant="glass" onClick={() => setSetupOpen(true)}>
                  {setup ? "Change" : "Set up"}
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <label className="flex h-12 items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 focus-within:border-nova-400/60 focus-within:bg-white/[0.05]">
        <Search className="size-4 text-ink-400" />
        <AtSign className="-mr-1 size-3.5 text-ink-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value.replace(/^@/, ""))}
          placeholder={multi ? "invite by handle" : "handle"}
          className="h-full w-full bg-transparent text-sm outline-none placeholder:text-ink-500"
          aria-label="Search players by handle"
          data-autofocus={appSetup ? undefined : true}
        />
      </label>

      <div className="mt-3 max-h-64 space-y-1 overflow-y-auto">
        {!multi && (
          <motion.button
            layout
            onClick={() => {
              setOpenLink(true);
              setRivals([]);
            }}
            className={cn(
              "flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition",
              openLink ? "bg-white/10" : "hover:bg-white/[0.05]",
            )}
          >
            <span className="flex size-10 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--color-nova-500),var(--color-flare))]">
              <Link2 className="size-4" />
            </span>
            <span className="flex-1">
              <span className="block text-sm font-semibold">Open challenge</span>
              <span className="block text-xs text-ink-400">Share a link — first taker plays you</span>
            </span>
            <AnimatePresence>{openLink && <Tick />}</AnimatePresence>
          </motion.button>
        )}
        {(people.data ?? [])
          .filter((profile) => profile.id !== viewer?.id)
          .map((profile, i) => {
            const selected = rivals.some((r) => r.id === profile.id);
            return (
              <motion.button
                layout
                key={profile.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0, transition: { delay: i * 0.03 } }}
                onClick={() => toggle(profile)}
                aria-pressed={selected}
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
                <AnimatePresence>
                  {selected ? (
                    <Tick key="tick" />
                  ) : (
                    multi && (
                      <motion.span
                        key="add"
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        exit={{ scale: 0 }}
                        className="flex size-6 items-center justify-center rounded-full border border-white/15 text-ink-400"
                      >
                        <Plus className="size-3.5" />
                      </motion.span>
                    )
                  )}
                </AnimatePresence>
              </motion.button>
            );
          })}
        {deferred && people.data?.length === 0 && (
          <p className="px-3 py-4 text-center text-sm text-ink-400">
            Nobody called @{deferred} here yet — {multi ? "leave a seat open and share the link." : "send them an open challenge link instead."}
          </p>
        )}
      </div>

      <Button className="mt-5 w-full" size="lg" variant="accent" disabled={!ready} loading={create.isPending} onClick={send} magnetic>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={spring.snappy}
          >
            {label}
          </motion.span>
        </AnimatePresence>
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

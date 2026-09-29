"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { z } from "zod";
import { AchievementsEditor, StatsEditor, stripAchievementRows, stripStatRows, type AchievementRow, type StatRow } from "@/components/pages/progress-editors";
import { Segmented } from "@/components/ui/segmented";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { achievementDefsError, manifestShapeError, statDefsError, MANIFEST_DEFAULTS } from "@/platform/catalog";
import { versionUrlError } from "@/platform/shipping";
import { CATEGORIES, type AppCategory, type PlayableMode, type Scoring, type VersionManifest } from "@/platform/types";
import { fieldClass } from "./ui";
import type { ManifestSide } from "./manifest-diff";

/* ---------------------------------------------------------------------- */
/* Form model                                                              */
/* ---------------------------------------------------------------------- */

export interface ManifestForm {
  url: string;
  name: string;
  tagline: string;
  description: string;
  category: AppCategory;
  icon: string;
  accent: [string, string];
  modes: PlayableMode[];
  scoring: Scoring;
  votesToWin: number | null;
  howTo: string[];
  players: { min: number; max: number };
  teams: 0 | 2 | 3 | 4;
  spectators: boolean;
  turnBased: boolean;
  setup: boolean;
  stats: StatRow[];
  achievements: AchievementRow[];
}

export type ManifestErrors = Partial<Record<keyof ManifestForm, string>>;

export const ICONS = ["🎯", "🧠", "🎨", "🎲", "🏁", "🪩", "🧩", "🎤", "🗳️", "🃏", "🏀", "👾"];
export const PALETTES: [string, string][] = [
  ["#5b74ff", "#a35cff"],
  ["#ff5ca8", "#8b5cff"],
  ["#ffe14d", "#ff7a1a"],
  ["#b6ff3d", "#1fd1b2"],
  ["#3d7bff", "#35e0ff"],
  ["#ff9a3d", "#ff3d6e"],
];

export function formFromSide(side: ManifestSide): ManifestForm {
  const m = side.manifest;
  const howTo = [...(m.howTo ?? [])].slice(0, 3);
  while (howTo.length < 3) howTo.push("");
  const teams = m.teams ?? 0;
  return {
    url: side.url,
    name: m.name,
    tagline: m.tagline,
    description: m.description ?? "",
    category: m.category,
    icon: m.icon,
    accent: [m.accent[0], m.accent[1]],
    modes: [...m.modes],
    scoring: m.scoring,
    votesToWin: m.votesToWin ?? null,
    howTo,
    players: { ...(m.players ?? MANIFEST_DEFAULTS.players) },
    teams: (teams === 2 || teams === 3 || teams === 4 ? teams : 0) as ManifestForm["teams"],
    spectators: m.spectators ?? MANIFEST_DEFAULTS.spectators,
    turnBased: m.turnBased ?? MANIFEST_DEFAULTS.turnBased,
    setup: m.setup ?? MANIFEST_DEFAULTS.setup,
    stats: (m.stats ?? []).map((s) => ({ ...s, keyTouched: true })),
    achievements: (m.achievements ?? []).map((a) => ({ ...a, idTouched: true })),
  };
}

/** The version as the backend takes it (no validation). */
export function sideFromForm(form: ManifestForm): ManifestSide {
  const manifest: VersionManifest = {
    name: form.name.trim(),
    tagline: form.tagline.trim(),
    description: form.description.trim(),
    category: form.category,
    icon: form.icon,
    accent: form.accent,
    modes: form.modes,
    players: form.players,
    teams: form.teams,
    spectators: form.spectators,
    setup: form.setup,
    turnBased: form.turnBased,
    scoring: form.scoring,
    ...(form.scoring === "votes" && form.votesToWin ? { votesToWin: form.votesToWin } : {}),
    howTo: form.howTo.map((s) => s.trim()).filter(Boolean),
    stats: stripStatRows(form.stats),
    achievements: stripAchievementRows(form.achievements),
  };
  return { url: form.url.trim(), manifest };
}

/** Same rules as the registration form. */
const scalarSchema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(40),
  tagline: z.string().trim().min(8, "Give it a hook (8+ characters)").max(90),
  description: z.string().trim().max(1200),
  icon: z.string().min(1, "Pick an emoji").max(16),
  accent: z.tuple([z.string().regex(/^#[0-9a-fA-F]{6}$/), z.string().regex(/^#[0-9a-fA-F]{6}$/)]),
  modes: z.array(z.enum(["live", "async", "practice"])).min(1, "Pick at least one mode"),
  howTo: z.array(z.string().trim().max(120)).max(3),
});

export function validateManifestForm(form: ManifestForm): ManifestErrors {
  const errors: ManifestErrors = {};
  const parsed = scalarSchema.safeParse(form);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof ManifestForm;
      errors[key] ??= issue.message;
    }
  }
  const urlError = versionUrlError(form.url.trim());
  if (urlError) errors.url = urlError;
  const side = sideFromForm(form);
  const stats = statDefsError(side.manifest.stats);
  const achievements = achievementDefsError(side.manifest.achievements);
  if (stats) errors.stats = stats;
  if (achievements) errors.achievements = achievements;
  const shape = manifestShapeError({ players: form.players, teams: form.teams });
  if (shape) errors.players = shape;
  if (form.scoring === "votes" && form.votesToWin !== null && (form.votesToWin < 1 || form.votesToWin > 99)) errors.votesToWin = "1–99 votes";
  return errors;
}

/* ---------------------------------------------------------------------- */
/* Field shell                                                             */
/* ---------------------------------------------------------------------- */

export function Field({ label, error, hint, children, as = "label" }: { label: string; error?: string; hint?: ReactNode; children: ReactNode; as?: "label" | "div" }) {
  const reduced = useReducedMotion();
  const Tag = as === "label" ? motion.label : motion.div;
  return (
    <Tag className="block" animate={error && !reduced ? { x: [0, -6, 6, -3, 0] } : { x: 0 }} transition={{ duration: 0.35 }}>
      <span className="text-sm font-semibold text-ink-100">{label}</span>
      <div className="mt-1.5">{children}</div>
      <AnimatePresence mode="wait" initial={false}>
        {error ? (
          <motion.span key="e" className="mt-1 block text-xs text-danger" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {error}
          </motion.span>
        ) : hint ? (
          <motion.span key="h" className="mt-1 block text-xs text-ink-400" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {hint}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </Tag>
  );
}

function Toggle({ on, label, sub, onClick }: { on: boolean; label: string; sub: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className={cn("flex w-full items-center gap-3 rounded-2xl border px-3 py-2 text-left transition", on ? "border-white/30 bg-white/[0.07]" : "border-white/10")}
    >
      <span className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", on ? "bg-volt" : "bg-white/15")}>
        <motion.span className="absolute top-0.5 size-4 rounded-full bg-white shadow" animate={{ left: on ? 18 : 2 }} transition={spring.snappy} />
      </span>
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-xs text-ink-400">{sub}</span>
      </span>
    </button>
  );
}

function Stepper({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-ink-200">{label}</span>
      <div className="flex items-center gap-1 rounded-full glass p-1">
        <button type="button" aria-label={`Fewer (${label})`} onClick={() => onChange(value - 1)} className="flex size-7 items-center justify-center rounded-full text-ink-200 transition hover:bg-white/10">
          −
        </button>
        <motion.span key={value} initial={{ y: -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={spring.snappy} className="w-6 text-center font-mono font-bold tabular">
          {value}
        </motion.span>
        <button type="button" aria-label={`More (${label})`} onClick={() => onChange(value + 1)} className="flex size-7 items-center justify-center rounded-full text-ink-200 transition hover:bg-white/10">
          +
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* The fields                                                              */
/* ---------------------------------------------------------------------- */

/**
 * Every manifest field a version carries (listing + capabilities), laid out
 * like the registration form. `idPrefix` keeps shared-layout ids unique.
 */
export function ManifestFields({
  value,
  errors,
  onChange,
  idPrefix = "manifest",
}: {
  value: ManifestForm;
  errors: ManifestErrors;
  onChange: (patch: Partial<ManifestForm>) => void;
  idPrefix?: string;
}) {
  const setPlayers = (next: { min: number; max: number }) => {
    const lo = Math.min(8, Math.max(2, next.min));
    const hi = Math.min(8, Math.max(lo, next.max));
    onChange({ players: { min: lo, max: hi } });
  };
  return (
    <div className="space-y-6">
      <Field label="App URL" error={errors.url} hint="The build reviewers and testers load. It must allow framing by this site.">
        <input className={cn(fieldClass, "font-mono")} value={value.url} onChange={(e) => onChange({ url: e.target.value })} placeholder="https://tap-race.dev/v2" inputMode="url" />
      </Field>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label="Name" error={errors.name}>
          <input className={fieldClass} value={value.name} onChange={(e) => onChange({ name: e.target.value })} maxLength={40} />
        </Field>
        <Field label="Tagline" error={errors.tagline}>
          <input className={fieldClass} value={value.tagline} onChange={(e) => onChange({ tagline: e.target.value })} maxLength={90} />
        </Field>
      </div>
      <Field label="Description" error={errors.description}>
        <textarea className={cn(fieldClass, "h-28 resize-none py-3")} value={value.description} onChange={(e) => onChange({ description: e.target.value })} maxLength={1200} />
      </Field>

      <Field as="div" label="Category">
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <motion.button
              type="button"
              key={c.id}
              whileTap={{ scale: 0.94 }}
              onClick={() => onChange({ category: c.id })}
              aria-pressed={value.category === c.id}
              className={cn(
                "rounded-full border px-3.5 py-2 text-sm font-semibold transition",
                value.category === c.id ? "border-ink-50 bg-ink-50 text-ink-950" : "border-white/10 text-ink-200 hover:border-white/25",
              )}
            >
              {c.emoji} {c.label}
            </motion.button>
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <Field as="div" label="Icon" error={errors.icon}>
          <div className="flex flex-wrap gap-1.5">
            {(ICONS.includes(value.icon) ? ICONS : [value.icon, ...ICONS]).map((icon) => (
              <motion.button
                type="button"
                key={icon}
                whileHover={{ scale: 1.15, rotate: -6 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => onChange({ icon })}
                className={cn("flex size-10 items-center justify-center rounded-xl text-xl transition", value.icon === icon ? "bg-white/15 ring-2 ring-white/60" : "bg-white/[0.04]")}
                aria-label={`Icon ${icon}`}
                aria-pressed={value.icon === icon}
              >
                {icon}
              </motion.button>
            ))}
          </div>
        </Field>
        <Field as="div" label="Accent" error={errors.accent}>
          <div className="flex flex-wrap gap-2">
            {PALETTES.map((pair) => (
              <motion.button
                type="button"
                key={pair.join()}
                whileHover={{ scale: 1.12 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => onChange({ accent: pair })}
                className={cn("size-10 rounded-xl transition", value.accent.join() === pair.join() && "ring-2 ring-white/80 ring-offset-2 ring-offset-ink-950")}
                style={{ background: `linear-gradient(135deg, ${pair[0]}, ${pair[1]})` }}
                aria-label={`Accent ${pair.join(" to ")}`}
              />
            ))}
            <span className="flex items-center gap-1 rounded-xl border border-white/10 px-2">
              <input type="color" value={value.accent[0]} onChange={(e) => onChange({ accent: [e.target.value, value.accent[1]] })} className="size-6 cursor-pointer bg-transparent" aria-label="Accent start color" />
              <input type="color" value={value.accent[1]} onChange={(e) => onChange({ accent: [value.accent[0], e.target.value] })} className="size-6 cursor-pointer bg-transparent" aria-label="Accent end color" />
            </span>
          </div>
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <Field as="div" label="Modes" error={errors.modes}>
          <div className="space-y-2">
            {(
              [
                ["live", "Live", "Both online at once"],
                ["async", "Play anytime", "Take turns on your own time"],
                ["practice", "Practice", "Your app plays a bot"],
              ] as [PlayableMode, string, string][]
            ).map(([mode, label, sub]) => {
              const on = value.modes.includes(mode);
              return (
                <button
                  type="button"
                  key={mode}
                  aria-pressed={on}
                  onClick={() => onChange({ modes: on ? value.modes.filter((m) => m !== mode) : [...value.modes, mode] })}
                  className={cn("flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition", on ? "border-white/30 bg-white/[0.07]" : "border-white/10")}
                >
                  <span className={cn("flex size-5 items-center justify-center rounded-md border transition", on ? "border-volt bg-volt text-ink-950" : "border-white/25")}>{on && "✓"}</span>
                  <span>
                    <span className="block text-sm font-semibold">{label}</span>
                    <span className="block text-xs text-ink-400">{sub}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </Field>
        <Field as="div" label="Who wins?" error={errors.votesToWin}>
          <div className="space-y-2">
            {(
              [
                ["high", "Highest score", "Points, rounds, streaks"],
                ["low", "Lowest score", "Times, moves, strokes"],
                ["votes", "The crowd", "Arena voters judge entries"],
              ] as [Scoring, string, string][]
            ).map(([scoring, label, sub]) => (
              <button
                type="button"
                key={scoring}
                aria-pressed={value.scoring === scoring}
                onClick={() => onChange({ scoring })}
                className={cn("relative flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition", value.scoring === scoring ? "border-white/30" : "border-white/10")}
              >
                {value.scoring === scoring && <motion.span layoutId={`${idPrefix}-scoring`} className="absolute inset-0 rounded-2xl bg-white/[0.07]" transition={spring.layout} />}
                <span className={cn("relative size-4 rounded-full border-2 transition", value.scoring === scoring ? "border-volt bg-volt" : "border-white/25")} />
                <span className="relative">
                  <span className="block text-sm font-semibold">{label}</span>
                  <span className="block text-xs text-ink-400">{sub}</span>
                </span>
              </button>
            ))}
            {value.scoring === "votes" && (
              <label className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 px-3 py-2">
                <span className="text-sm text-ink-200">Votes to win</span>
                <input
                  type="number"
                  min={1}
                  max={99}
                  className="h-9 w-20 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-right font-mono text-sm outline-none focus:border-nova-400/60"
                  value={value.votesToWin ?? ""}
                  placeholder="auto"
                  onChange={(e) => onChange({ votesToWin: e.target.value ? Number(e.target.value) : null })}
                />
              </label>
            )}
          </div>
        </Field>
      </div>

      <Field as="div" label="Table" error={errors.players}>
        <div className="grid grid-cols-1 gap-4 rounded-3xl border border-white/10 p-4 sm:grid-cols-2">
          <div className="space-y-3">
            <Stepper label="Fewest players" value={value.players.min} onChange={(n) => setPlayers({ ...value.players, min: n })} />
            <Stepper label="Most players" value={value.players.max} onChange={(n) => setPlayers({ ...value.players, max: n })} />
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-ink-200">Teams</span>
              <Segmented
                layoutId={`${idPrefix}-teams`}
                size="sm"
                value={String(value.teams) as "0" | "2" | "3" | "4"}
                onChange={(t) => onChange({ teams: Number(t) as ManifestForm["teams"] })}
                items={[
                  { id: "0", label: "None" },
                  { id: "2", label: "2" },
                  { id: "3", label: "3" },
                  { id: "4", label: "4" },
                ]}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Toggle on={value.spectators} label="Spectators" sub="Others can watch live matches" onClick={() => onChange({ spectators: !value.spectators })} />
            <Toggle on={value.turnBased} label="Turn-based" sub="Players take turns; we ping whoever's up" onClick={() => onChange({ turnBased: !value.turnBased })} />
            <Toggle on={value.setup} label="Custom setup" sub="You render the challenge setup screen" onClick={() => onChange({ setup: !value.setup })} />
          </div>
        </div>
      </Field>

      <StatsEditor value={value.stats} error={errors.stats} onChange={(stats) => onChange({ stats })} />
      <AchievementsEditor value={value.achievements} error={errors.achievements} onChange={(achievements) => onChange({ achievements })} />

      <Field as="div" label="How to play (up to 3 steps)" error={errors.howTo}>
        <div className="space-y-2">
          {value.howTo.map((step, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] font-mono text-xs">{i + 1}</span>
              <input
                className={fieldClass}
                value={step}
                maxLength={120}
                aria-label={`How to play step ${i + 1}`}
                onChange={(e) => onChange({ howTo: value.howTo.map((s, j) => (j === i ? e.target.value : s)) })}
              />
            </div>
          ))}
        </div>
      </Field>
    </div>
  );
}

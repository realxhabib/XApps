"use client";

import { LIMITS } from "@xapps/sdk";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Plus, Trash2 } from "lucide-react";
import { Segmented } from "@/components/ui/segmented";
import { spring } from "@/lib/motion";
import { play } from "@/lib/sfx";
import { cn } from "@/lib/utils";
import { ACHIEVEMENT_DESCRIPTION_MAX, ACHIEVEMENT_XP_MAX, DEF_LABEL_MAX } from "@/platform/catalog";
import type { AchievementDef, StatDef } from "@/platform/types";

/** Editor rows remember whether the id was typed by hand (else it follows the name). */
export type StatRow = StatDef & { keyTouched?: boolean };
export type AchievementRow = AchievementDef & { idTouched?: boolean };

const field =
  "h-10 w-full min-w-0 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm outline-none transition placeholder:text-ink-500 focus:border-nova-400/60 focus:bg-white/[0.05]";

/** "Best time (ms)" → "best_time_ms". */
export function toDefId(text: string): string {
  const id = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .replace(/_+$/g, "")
    .slice(0, 32);
  return id.replace(/_+$/g, "");
}

export function stripStatRows(rows: StatRow[]): StatDef[] {
  return rows.map(({ key, label, aggregate, format }) => ({ key, label: label.trim(), aggregate, ...(format ? { format } : {}) }));
}

export function stripAchievementRows(rows: AchievementRow[]): AchievementDef[] {
  return rows.map(({ id, name, description, icon, xp, secret }) => ({
    id,
    name: name.trim(),
    description: description.trim(),
    icon: icon.trim(),
    xp,
    ...(secret ? { secret: true } : {}),
  }));
}

function RowShell({ children, onRemove, label }: { children: React.ReactNode; onRemove: () => void; label: string }) {
  const reduced = useReducedMotion();
  return (
    <motion.li
      layout={!reduced}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
      transition={spring.soft}
      className="relative rounded-2xl border border-white/10 bg-white/[0.02] p-3 pr-11"
    >
      {children}
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-full text-ink-400 transition hover:bg-white/10 hover:text-danger"
        aria-label={`Remove ${label}`}
      >
        <Trash2 className="size-4" />
      </button>
    </motion.li>
  );
}

function AddButton({ onClick, disabled, children }: { onClick: () => void; disabled: boolean; children: React.ReactNode }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.96 }}
      className="mt-2 flex h-10 w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-white/15 text-sm font-semibold text-ink-200 transition hover:border-white/30 hover:bg-white/[0.03] disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Plus className="size-4" /> {children}
    </motion.button>
  );
}

function SectionError({ error }: { error?: string }) {
  return (
    <AnimatePresence initial={false}>
      {error && (
        <motion.p className="mt-1.5 text-xs text-danger" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
          {error}
        </motion.p>
      )}
    </AnimatePresence>
  );
}

/* ---------------------------------------------------------------------- */
/* Stats                                                                  */
/* ---------------------------------------------------------------------- */

export function StatsEditor({ value, error, onChange }: { value: StatRow[]; error?: string; onChange: (rows: StatRow[]) => void }) {
  const patch = (i: number, next: Partial<StatRow>) => onChange(value.map((row, j) => (j === i ? { ...row, ...next } : row)));
  const add = () => {
    play("pop");
    onChange([...value, { key: "", label: "", aggregate: "max", format: "number" }]);
  };
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold">Stats & leaderboards</span>
        <span className="font-mono text-xs text-ink-400">
          {value.length}/{LIMITS.maxStats}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-ink-400">Numbers you report with xapps.stats.report(). Each gets a leaderboard tab on your listing.</p>
      <motion.ul className="mt-2 space-y-2" animate={error ? { x: [0, -6, 6, -3, 0] } : { x: 0 }} transition={{ duration: 0.35 }}>
        <AnimatePresence initial={false}>
          {value.map((row, i) => (
            <RowShell key={i} onRemove={() => onChange(value.filter((_, j) => j !== i))} label={row.label || `stat ${i + 1}`}>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <input
                  className={field}
                  value={row.label}
                  maxLength={DEF_LABEL_MAX}
                  placeholder="Best time"
                  aria-label={`Stat ${i + 1} label`}
                  onChange={(e) => patch(i, { label: e.target.value, ...(row.keyTouched ? {} : { key: toDefId(e.target.value) }) })}
                />
                <input
                  className={cn(field, "font-mono")}
                  value={row.key}
                  maxLength={32}
                  placeholder="best_time"
                  aria-label={`Stat ${i + 1} key`}
                  onChange={(e) => patch(i, { key: e.target.value.toLowerCase(), keyTouched: true })}
                />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Segmented
                  size="sm"
                  layoutId={`stat-agg-${i}`}
                  value={row.aggregate}
                  onChange={(aggregate) => patch(i, { aggregate })}
                  items={[
                    { id: "max", label: "Max" },
                    { id: "min", label: "Min" },
                    { id: "sum", label: "Sum" },
                    { id: "last", label: "Last" },
                  ]}
                />
                <Segmented
                  size="sm"
                  layoutId={`stat-format-${i}`}
                  value={row.format ?? "number"}
                  onChange={(format) => patch(i, { format })}
                  items={[
                    { id: "number", label: "123" },
                    { id: "ms", label: "ms" },
                    { id: "percent", label: "%" },
                  ]}
                />
              </div>
            </RowShell>
          ))}
        </AnimatePresence>
      </motion.ul>
      <AddButton onClick={add} disabled={value.length >= LIMITS.maxStats}>
        Add a stat
      </AddButton>
      <SectionError error={error} />
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Achievements                                                           */
/* ---------------------------------------------------------------------- */

export function AchievementsEditor({
  value,
  error,
  onChange,
}: {
  value: AchievementRow[];
  error?: string;
  onChange: (rows: AchievementRow[]) => void;
}) {
  const patch = (i: number, next: Partial<AchievementRow>) => onChange(value.map((row, j) => (j === i ? { ...row, ...next } : row)));
  const total = value.reduce((sum, a) => sum + (Number.isFinite(a.xp) ? a.xp : 0), 0);
  const over = total > LIMITS.maxAchievementXpPerApp;
  const add = () => {
    play("pop");
    onChange([...value, { id: "", name: "", description: "", icon: "🏆", xp: 10 }]);
  };
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold">Achievements</span>
        <span className="font-mono text-xs text-ink-400">
          {value.length}/{LIMITS.maxAchievements}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-ink-400">Unlocked with xapps.achievements.unlock(id). XP is awarded once per player.</p>
      <div className="mt-2 flex items-center gap-2 text-xs">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10" aria-hidden>
          <motion.div
            className={cn("h-full rounded-full", over ? "bg-danger" : "bg-volt")}
            animate={{ width: `${Math.min(100, (total / LIMITS.maxAchievementXpPerApp) * 100)}%` }}
            transition={spring.soft}
          />
        </div>
        <span className={cn("font-mono tabular", over ? "text-danger" : "text-ink-300")}>
          {total}/{LIMITS.maxAchievementXpPerApp} XP
        </span>
      </div>
      <motion.ul className="mt-2 space-y-2" animate={error ? { x: [0, -6, 6, -3, 0] } : { x: 0 }} transition={{ duration: 0.35 }}>
        <AnimatePresence initial={false}>
          {value.map((row, i) => (
            <RowShell key={i} onRemove={() => onChange(value.filter((_, j) => j !== i))} label={row.name || `achievement ${i + 1}`}>
              <div className="flex gap-2">
                <input
                  className={cn(field, "w-12 shrink-0 px-0 text-center text-xl")}
                  value={row.icon}
                  maxLength={16}
                  aria-label={`Achievement ${i + 1} emoji`}
                  onChange={(e) => patch(i, { icon: e.target.value.trim() })}
                />
                <input
                  className={field}
                  value={row.name}
                  maxLength={DEF_LABEL_MAX}
                  placeholder="First win"
                  aria-label={`Achievement ${i + 1} name`}
                  onChange={(e) => patch(i, { name: e.target.value, ...(row.idTouched ? {} : { id: toDefId(e.target.value) }) })}
                />
              </div>
              <input
                className={cn(field, "mt-2")}
                value={row.description}
                maxLength={ACHIEVEMENT_DESCRIPTION_MAX}
                placeholder="Win your first match"
                aria-label={`Achievement ${i + 1} description`}
                onChange={(e) => patch(i, { description: e.target.value })}
              />
              <div className="mt-2 grid grid-cols-1 gap-2 min-[400px]:grid-cols-[1fr_auto_auto] min-[400px]:items-center">
                <input
                  className={cn(field, "font-mono")}
                  value={row.id}
                  maxLength={32}
                  placeholder="first_win"
                  aria-label={`Achievement ${i + 1} id`}
                  onChange={(e) => patch(i, { id: e.target.value.toLowerCase(), idTouched: true })}
                />
                <label className="flex h-10 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm">
                  <span className="text-ink-400">XP</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={ACHIEVEMENT_XP_MAX}
                    step={5}
                    value={Number.isFinite(row.xp) ? row.xp : ""}
                    onChange={(e) => patch(i, { xp: e.target.value === "" ? Number.NaN : Math.round(Number(e.target.value)) })}
                    className="w-12 bg-transparent font-mono tabular outline-none"
                    aria-label={`Achievement ${i + 1} XP`}
                  />
                </label>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!!row.secret}
                  onClick={() => patch(i, { secret: !row.secret })}
                  className={cn(
                    "flex h-10 items-center gap-2 rounded-xl border px-3 text-sm transition",
                    row.secret ? "border-white/30 bg-white/[0.07]" : "border-white/10",
                  )}
                >
                  <span className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", row.secret ? "bg-volt" : "bg-white/15")}>
                    <motion.span className="absolute top-0.5 size-4 rounded-full bg-white shadow" animate={{ left: row.secret ? 18 : 2 }} transition={spring.snappy} />
                  </span>
                  Secret
                </button>
              </div>
            </RowShell>
          ))}
        </AnimatePresence>
      </motion.ul>
      <AddButton onClick={add} disabled={value.length >= LIMITS.maxAchievements}>
        Add an achievement
      </AddButton>
      <SectionError error={error} />
    </div>
  );
}

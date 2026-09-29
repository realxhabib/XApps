"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown, Save, Send, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "@/components/chrome/toasts";
import { Button } from "@/components/ui/button";
import { haptic } from "@/lib/haptics";
import { spring } from "@/lib/motion";
import { play } from "@/lib/sfx";
import { cn } from "@/lib/utils";
import { useCreateVersion, useSubmitVersion, useUpdateVersion } from "@/platform/queries";
import type { AppManifest, AppVersion } from "@/platform/types";
import type { ManifestSide } from "./manifest-diff";
import { diffManifests } from "./manifest-diff";
import { ManifestFields, formFromSide, sideFromForm, validateManifestForm, type ManifestErrors, type ManifestForm } from "./manifest-fields";
import { VERSION_NOTES_MAX, manifestOf, versionLabelError } from "@/platform/shipping";
import { bumpSemver, compareSemver, latestSemver, type Bump } from "./semver";
import { ManifestDiff, Panel, fieldClass } from "./ui";

/** The live listing as a version-shaped manifest (for apps without versions yet). */
export function sideOfApp(app: AppManifest): ManifestSide {
  return { url: app.url, manifest: manifestOf(app) };
}

export const sideOf = (v: AppVersion): ManifestSide => ({ url: v.url, manifest: v.manifest });

/**
 * Create a new version (prefilled from the newest one) or edit a draft /
 * rejected version.
 */
export function VersionEditor({
  app,
  versions,
  editing,
  onDone,
}: {
  app: AppManifest;
  versions: AppVersion[];
  editing: AppVersion | null;
  onDone: (saved: AppVersion | null) => void;
}) {
  const reduced = useReducedMotion();
  const live = versions.find((v) => v.status === "published") ?? null;
  const latestVersion = latestSemver(versions.map((v) => v.version)) ?? "1.0.0";
  const base = editing ?? versions.find((v) => v.version === latestVersion) ?? null;
  const [form, setForm] = useState<ManifestForm>(() => formFromSide(base ? sideOf(base) : sideOfApp(app)));
  const [version, setVersion] = useState(() => editing?.version ?? bumpSemver(latestVersion, "patch"));
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [errors, setErrors] = useState<ManifestErrors>({});
  const [versionError, setVersionError] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(true);
  const create = useCreateVersion(app.slug);
  const update = useUpdateVersion(app.slug);
  const submit = useSubmitVersion(app.slug);
  const busy = create.isPending || update.isPending || submit.isPending;
  const [intent, setIntent] = useState<"draft" | "submit">("draft");

  const compareTo = live ? sideOf(live) : null;
  const side = useMemo(() => sideFromForm(form), [form]);
  const changeCount = diffManifests(compareTo, side).length;

  const patch = (next: Partial<ManifestForm>) => {
    setForm((f) => ({ ...f, ...next }));
    setErrors((e) => {
      const copy = { ...e };
      for (const k of Object.keys(next) as (keyof ManifestForm)[]) delete copy[k];
      return copy;
    });
  };

  const checkVersion = (v: string): string | null => {
    if (editing) return null;
    const label = versionLabelError(v);
    if (label) return label;
    if (versions.some((x) => x.version === v)) return `v${v} already exists`;
    if (compareSemver(v, latestVersion) <= 0) return `Must be newer than v${latestVersion}`;
    return null;
  };

  const save = async (andSubmit: boolean) => {
    const vErr = checkVersion(version.trim());
    const fErr = validateManifestForm(form);
    setVersionError(vErr);
    setErrors(fErr);
    if (vErr || Object.keys(fErr).length) {
      play("error");
      haptic("error");
      toast("Fix the highlighted fields", { tone: "danger" });
      return;
    }
    setIntent(andSubmit ? "submit" : "draft");
    try {
      let saved = editing
        ? await update.mutateAsync({ versionId: editing.id, url: side.url, manifest: side.manifest, notes: notes.trim() })
        : await create.mutateAsync({ version: version.trim(), url: side.url, manifest: side.manifest, notes: notes.trim() || undefined });
      if (andSubmit) saved = await submit.mutateAsync(saved.id);
      play(andSubmit ? "whoosh" : "pop");
      haptic("success");
      toast(andSubmit ? `v${saved.version} sent for review` : `v${saved.version} saved as a draft`, {
        tone: "success",
        description: andSubmit ? "You and your testers can play it while you wait." : "Submit it when it's ready.",
      });
      onDone(saved);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't save the version", { tone: "danger" });
    }
  };

  const bumps: Bump[] = ["patch", "minor", "major"];

  return (
    <motion.div initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={spring.soft}>
      <Panel>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-ink-400">{editing ? "Edit version" : "New version"}</p>
            <h2 className="mt-1 font-display text-2xl font-extrabold tracking-tight">
              {editing ? `v${editing.version}` : "Ship an update"}
            </h2>
            <p className="mt-1 text-sm text-ink-400">
              {editing ? "Drafts and versions with requested changes can be edited." : base ? `Prefilled from v${base.version}.` : "Prefilled from your listing."}
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label="Close editor" onClick={() => onDone(null)}>
            <X className="size-4" />
          </Button>
        </div>

        {!editing && (
          <div className="mt-6">
            <span className="text-sm font-semibold">Version</span>
            <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                className={cn(fieldClass, "font-mono sm:w-40")}
                value={version}
                aria-label="Version number"
                aria-invalid={!!versionError}
                onChange={(e) => {
                  setVersion(e.target.value);
                  setVersionError(null);
                }}
              />
              <div className="flex gap-1.5" role="group" aria-label="Bump from the latest version">
                {bumps.map((b) => {
                  const next = bumpSemver(latestVersion, b);
                  const on = next === version.trim();
                  return (
                    <motion.button
                      key={b}
                      type="button"
                      whileTap={{ scale: 0.95 }}
                      aria-pressed={on}
                      onClick={() => {
                        setVersion(next);
                        setVersionError(null);
                        play("tick");
                      }}
                      className={cn(
                        "flex flex-1 flex-col items-center rounded-2xl border px-3 py-1.5 transition sm:flex-none",
                        on ? "border-white/40 bg-white/[0.08]" : "border-white/10 hover:border-white/25",
                      )}
                    >
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">{b}</span>
                      <span className="font-mono text-sm">{next}</span>
                    </motion.button>
                  );
                })}
              </div>
            </div>
            <AnimatePresence initial={false}>
              {versionError ? (
                <motion.p key="err" className="mt-1 text-xs text-danger" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  {versionError}
                </motion.p>
              ) : (
                <motion.p key="hint" className="mt-1 text-xs text-ink-400" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  Latest is v{latestVersion}. Patch for fixes, minor for features, major for breaking changes.
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        )}

        <div className="mt-6">
          <ManifestFields value={form} errors={errors} onChange={patch} idPrefix="version-editor" />
        </div>

        <label className="mt-6 block">
          <span className="text-sm font-semibold">Release notes</span>
          <span className="mt-0.5 block text-xs text-ink-400">What changed and what reviewers should look at.</span>
          <textarea
            className={cn(fieldClass, "mt-1.5 h-24 resize-none py-3")}
            value={notes}
            maxLength={VERSION_NOTES_MAX}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="New power-ups, fixed the timer on slow phones."
          />
        </label>

        <div className="mt-6">
          <button
            type="button"
            onClick={() => setShowDiff((s) => !s)}
            aria-expanded={showDiff}
            className="flex w-full items-center gap-2 text-left text-sm font-semibold"
          >
            Changes vs {live ? `live v${live.version}` : "nothing published"}
            <span className="rounded-full bg-white/10 px-1.5 text-[11px] tabular">{changeCount}</span>
            <motion.span className="ml-auto" animate={{ rotate: showDiff ? 180 : 0 }} transition={spring.snappy}>
              <ChevronDown className="size-4 text-ink-400" />
            </motion.span>
          </button>
          <AnimatePresence initial={false}>
            {showDiff && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={reduced ? { duration: 0 } : spring.soft}
                className="overflow-hidden"
              >
                <ManifestDiff className="mt-3" before={compareTo} after={side} beforeLabel={live ? `v${live.version}` : "Published"} afterLabel={editing ? `v${editing.version}` : `v${version}`} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="mt-8 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={() => onDone(null)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="glass" icon={<Save className="size-4" />} loading={busy && intent === "draft"} disabled={busy} onClick={() => save(false)}>
            Save draft
          </Button>
          <Button variant="accent" icon={<Send className="size-4" />} loading={busy && intent === "submit"} disabled={busy} onClick={() => save(true)}>
            Save &amp; submit for review
          </Button>
        </div>
      </Panel>
    </motion.div>
  );
}

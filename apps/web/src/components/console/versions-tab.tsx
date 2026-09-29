"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown, FlaskConical, GitCompare, Pencil, Play, Plus, Rocket, Send, Swords, Undo2 } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "@/components/chrome/toasts";
import { celebrate } from "@/components/motion/confetti";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { haptic } from "@/lib/haptics";
import { spring } from "@/lib/motion";
import { play } from "@/lib/sfx";
import { cn } from "@/lib/utils";
import { usePublishVersion, useAppVersions, useSubmitVersion, useWithdrawVersion } from "@/platform/queries";
import type { AppManifest, AppVersion } from "@/platform/types";
import { ConfirmDialog } from "./confirm";
import { sandboxHref } from "./overview-tab";
import { compareSemver } from "./semver";
import { ChallengeTesterSheet, usePlayTestBuild } from "./test-build";
import { TestersPanel } from "./testers";
import { ManifestDiff, Panel, PanelTitle, VERSION_STATUS, VersionStatusChip, useNow, ago } from "./ui";
import { VersionEditor, sideOf } from "./version-editor";

type Editor = { kind: "new" } | { kind: "edit"; version: AppVersion } | null;
type Confirm = { kind: "submit" | "withdraw" | "publish"; version: AppVersion } | null;

export function VersionsTab({ app }: { app: AppManifest }) {
  const { data, isPending, isError } = useAppVersions(app.slug);
  const [editor, setEditor] = useState<Editor>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [challenge, setChallenge] = useState<AppVersion | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const submit = useSubmitVersion(app.slug);
  const withdraw = useWithdrawVersion(app.slug);
  const publish = usePublishVersion(app.slug);
  const playBuild = usePlayTestBuild(app.slug);
  const closeConfirm = useCallback(() => setConfirm(null), []);
  const closeChallenge = useCallback(() => setChallenge(null), []);

  const versions = [...(data ?? [])].sort((a, b) => compareSemver(b.version, a.version));
  const live = versions.find((v) => v.status === "published") ?? null;

  const run = async () => {
    if (!confirm) return;
    const { kind, version } = confirm;
    try {
      if (kind === "submit") {
        await submit.mutateAsync(version.id);
        play("whoosh");
        toast(`v${version.version} sent for review`, { tone: "success", description: "We'll let you know in your inbox." });
      } else if (kind === "withdraw") {
        await withdraw.mutateAsync(version.id);
        play("pop");
        toast(`v${version.version} is a draft again`, { tone: "success" });
      } else {
        await publish.mutateAsync(version.id);
        play("win");
        haptic("success");
        celebrate({ pattern: "cannons", colors: [app.accent[0], app.accent[1], "#ffffff"] });
        toast(`v${version.version} is live`, { tone: "success", description: "Every new match loads this build." });
      }
      setConfirm(null);
    } catch (error) {
      toast(error instanceof Error ? error.message : "That didn't work", { tone: "danger" });
    }
  };

  if (editor) {
    return (
      <VersionEditor
        key={editor.kind === "edit" ? editor.version.id : "new"}
        app={app}
        versions={versions}
        editing={editor.kind === "edit" ? editor.version : null}
        onDone={(saved) => {
          setEditor(null);
          if (saved) setOpen(saved.id);
        }}
      />
    );
  }

  const busy = submit.isPending || withdraw.isPending || publish.isPending;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
      <Panel>
        <PanelTitle
          sub="Every build you've shipped, newest first"
          action={
            <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditor({ kind: "new" })}>
              New version
            </Button>
          }
        >
          Versions
        </PanelTitle>

        {isPending ? (
          <div className="mt-4 space-y-3">
            <Skeleton className="h-24 rounded-2xl" />
            <Skeleton className="h-24 rounded-2xl" />
          </div>
        ) : isError ? (
          <p className="mt-4 text-sm text-danger">Couldn&apos;t load versions.</p>
        ) : versions.length === 0 ? (
          <EmptyState emoji="📦" title="No versions yet" className="mt-4 py-10" action={<Button onClick={() => setEditor({ kind: "new" })}>Create one</Button>}>
            Versions let you test changes with testers before they go live.
          </EmptyState>
        ) : (
          <ol className="relative mt-5">
            <span aria-hidden className="absolute bottom-6 left-[0.6875rem] top-3 w-px bg-white/10" />
            {versions.map((v, i) => (
              <VersionItem
                key={v.id}
                version={v}
                live={live}
                index={i}
                open={open === v.id}
                onToggle={() => setOpen((o) => (o === v.id ? null : v.id))}
                onEdit={() => setEditor({ kind: "edit", version: v })}
                onConfirm={(kind) => setConfirm({ kind, version: v })}
                onPlay={() => playBuild.mutate(v)}
                playing={playBuild.isPending && playBuild.variables?.id === v.id}
                onChallenge={() => setChallenge(v)}
              />
            ))}
          </ol>
        )}
      </Panel>

      <TestersPanel app={app} />

      <ConfirmDialog
        open={!!confirm}
        onClose={closeConfirm}
        busy={busy}
        onConfirm={run}
        tone={confirm?.kind === "withdraw" ? "danger" : confirm?.kind === "publish" ? "volt" : "accent"}
        icon={confirm?.kind === "publish" ? <Rocket className="size-4" /> : confirm?.kind === "withdraw" ? <Undo2 className="size-4" /> : <Send className="size-4" />}
        title={
          confirm?.kind === "publish"
            ? `Publish v${confirm.version.version}?`
            : confirm?.kind === "withdraw"
              ? `Withdraw v${confirm?.version.version} from review?`
              : `Submit v${confirm?.version.version} for review?`
        }
        description={
          confirm?.kind === "publish"
            ? live
              ? `Players get it on their next match. v${live.version} is retired.`
              : "Players get it on their next match."
            : confirm?.kind === "withdraw"
              ? "It goes back to draft so you can keep editing. You'll need to resubmit."
              : "A reviewer checks the build and the listing. You can't edit it while it's in review."
        }
        confirmLabel={confirm?.kind === "publish" ? "Publish now" : confirm?.kind === "withdraw" ? "Withdraw" : "Submit"}
      >
        {confirm && confirm.kind !== "withdraw" && (
          <div className="max-h-[40dvh] overflow-y-auto">
            <ManifestDiff before={live && live.id !== confirm.version.id ? sideOf(live) : null} after={sideOf(confirm.version)} beforeLabel={live ? `v${live.version}` : "Published"} afterLabel={`v${confirm.version.version}`} />
          </div>
        )}
      </ConfirmDialog>
      <ChallengeTesterSheet version={challenge} open={!!challenge} onClose={closeChallenge} />
    </div>
  );
}

function VersionItem({
  version: v,
  live,
  index,
  open,
  onToggle,
  onEdit,
  onConfirm,
  onPlay,
  playing,
  onChallenge,
}: {
  version: AppVersion;
  live: AppVersion | null;
  index: number;
  open: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onConfirm: (kind: "submit" | "withdraw" | "publish") => void;
  onPlay: () => void;
  playing: boolean;
  onChallenge: () => void;
}) {
  const reduced = useReducedMotion();
  const now = useNow(60_000);
  const status = VERSION_STATUS[v.status];
  const Icon = status.icon;
  const editable = v.status === "draft" || v.status === "rejected";
  const playable = v.status !== "retired";
  const timeline = [
    { label: "Created", at: v.createdAt },
    { label: "Submitted", at: v.submittedAt },
    { label: v.status === "rejected" ? "Changes requested" : "Approved", at: v.reviewedAt },
    { label: "Published", at: v.publishedAt },
  ].filter((t) => t.at);

  return (
    <motion.li
      layout={!reduced}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring.soft, delay: reduced ? 0 : Math.min(index, 6) * 0.04 }}
      className="relative pb-4 pl-9 last:pb-0"
    >
      <span
        aria-hidden
        className={cn(
          "absolute left-0 top-2.5 flex size-[1.375rem] items-center justify-center rounded-full border-2 border-ink-850",
          v.status === "published" ? "bg-success text-ink-950" : v.status === "rejected" ? "bg-danger text-white" : v.status === "in_review" ? "bg-gold text-ink-950" : v.status === "approved" ? "bg-volt text-ink-950" : "bg-ink-600 text-ink-200",
        )}
      >
        <Icon className="size-3" />
      </span>
      <div className={cn("rounded-2xl border transition", open ? "border-white/15 bg-white/[0.04]" : "border-white/[0.08] bg-white/[0.02]", v.status === "retired" && "opacity-70")}>
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-2 px-3.5 pb-2 pt-3 text-left">
          <span className="font-mono text-base font-bold">v{v.version}</span>
          <VersionStatusChip status={v.status} />
          <span className="ml-auto shrink-0 text-xs text-ink-400">{ago(v.publishedAt ?? v.reviewedAt ?? v.submittedAt ?? v.createdAt, now)}</span>
          <motion.span animate={{ rotate: open ? 180 : 0 }} transition={spring.snappy}>
            <ChevronDown className="size-4 text-ink-400" />
          </motion.span>
        </button>
        <div className="px-3.5 pb-3">
          <p className="truncate font-mono text-xs text-ink-400">{v.url}</p>
          {v.notes && <p className="mt-1.5 line-clamp-2 text-sm text-ink-200">{v.notes}</p>}
          {v.reviewNotes && (
            <p className={cn("mt-2 rounded-xl px-3 py-2 text-sm", v.status === "rejected" ? "bg-danger/10 text-ink-100" : "bg-white/[0.04] text-ink-200")}>
              <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-ink-400">Reviewer</span>
              {v.reviewNotes}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-1.5">
            {editable && (
              <Button size="sm" variant="outline" icon={<Pencil className="size-3.5" />} onClick={onEdit}>
                Edit
              </Button>
            )}
            {editable && (
              <Button size="sm" variant="accent" icon={<Send className="size-3.5" />} onClick={() => onConfirm("submit")}>
                {v.status === "rejected" ? "Resubmit" : "Submit for review"}
              </Button>
            )}
            {v.status === "in_review" && (
              <Button size="sm" variant="outline" icon={<Undo2 className="size-3.5" />} onClick={() => onConfirm("withdraw")}>
                Withdraw
              </Button>
            )}
            {v.status === "approved" && (
              <Button size="sm" variant="volt" icon={<Rocket className="size-3.5" />} onClick={() => onConfirm("publish")}>
                Publish
              </Button>
            )}
            {playable && (
              <Button size="sm" variant="glass" icon={<Play className="size-3.5" />} loading={playing} onClick={onPlay}>
                {v.status === "published" ? "Practice" : "Play test build"}
              </Button>
            )}
            {playable && v.manifest.modes.some((m) => m !== "practice") && (
              <Button size="sm" variant="glass" icon={<Swords className="size-3.5" />} onClick={onChallenge}>
                Challenge a tester
              </Button>
            )}
            <Button size="sm" variant="ghost" icon={<FlaskConical className="size-3.5" />} href={sandboxHref(v.url, v.manifest.scoring)}>
              Sandbox
            </Button>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={reduced ? { duration: 0 } : spring.soft}
              className="overflow-hidden"
            >
              <div className="border-t border-white/[0.06] px-3.5 pb-3.5 pt-3">
                <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-400">
                  {timeline.map((t) => (
                    <li key={t.label}>
                      <span className="text-ink-300">{t.label}</span> {new Date(t.at!).toLocaleString("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </li>
                  ))}
                </ol>
                <p className="mb-2 mt-3 flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.16em] text-ink-400">
                  <GitCompare className="size-3.5" /> {v.id === live?.id ? "Live manifest" : live ? `Changes vs live v${live.version}` : "Manifest"}
                </p>
                {v.id === live?.id ? (
                  <p className="text-sm text-ink-300">This is what players get today.</p>
                ) : (
                  <ManifestDiff before={live ? sideOf(live) : null} after={sideOf(v)} beforeLabel={live ? `v${live.version}` : "Published"} afterLabel={`v${v.version}`} />
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.li>
  );
}

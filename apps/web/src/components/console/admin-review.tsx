"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, Check, ExternalLink, FlaskConical, Gavel, Monitor, RotateCw, ShieldCheck, Smartphone, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "@/components/chrome/toasts";
import { AppCard } from "@/components/marketplace/app-card";
import { AppGlyph } from "@/components/marketplace/app-glyph";
import { SignInPrompt } from "@/components/pages/sign-in-prompt";
import { APP_ALLOW, APP_SANDBOX } from "@/components/play/use-app-bridge";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { haptic } from "@/lib/haptics";
import { spring } from "@/lib/motion";
import { play } from "@/lib/sfx";
import { useMounted } from "@/lib/use-mounted";
import { cn } from "@/lib/utils";
import { useBackend, useViewer } from "@/platform/client";
import { useIsAdmin, useReviewQueue, useReviewVersion } from "@/platform/queries";
import { REVIEW_NOTES_MAX, applyVersionToApp } from "@/platform/shipping";
import type { ReviewItem } from "@/platform/types";
import { ConfirmDialog } from "./confirm";
import { sandboxHref } from "./overview-tab";
import { ManifestDiff, Panel, PanelTitle, fieldClass, useNow, ago } from "./ui";
import { sideOf } from "./version-editor";

/** `/admin/review`: the queue of versions waiting for a decision. */
export function AdminReview() {
  const { viewer, loading } = useViewer();
  const isAdmin = useIsAdmin();
  const backend = useBackend();
  const mounted = useMounted();

  if (!mounted || loading) return <Skeleton className="h-96 rounded-[2rem]" />;
  if (!viewer) return <SignInPrompt title="Sign in to review apps">The review queue is for XApps reviewers.</SignInPrompt>;
  if (!isAdmin) {
    return backend.demo ? (
      <EmptyState emoji="🛡️" title="Reviewers only" action={<AdminToggle on={false} />}>
        In demo mode you can make yourself a reviewer to try the queue. With Supabase, admins are set in SQL.
      </EmptyState>
    ) : (
      <EmptyState emoji="🧭" title="This page got ratioed." action={<Button href="/">Back to XApps</Button>}>
        It doesn&apos;t exist, or it moved.
      </EmptyState>
    );
  }
  return <Queue />;
}

function AdminToggle({ on }: { on: boolean }) {
  const backend = useBackend();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  if (!backend.demo) return null;
  return (
    <Button
      variant={on ? "outline" : "volt"}
      size={on ? "sm" : "md"}
      loading={busy}
      icon={<ShieldCheck className="size-4" />}
      onClick={async () => {
        setBusy(true);
        try {
          await backend.demo?.setAdmin(!on);
          await queryClient.invalidateQueries({ queryKey: ["viewer"] });
          void queryClient.invalidateQueries({ queryKey: ["review-queue"] });
          toast(on ? "You're a regular player again" : "You're a reviewer (demo)", { tone: "success" });
        } catch (error) {
          toast(error instanceof Error ? error.message : "Couldn't change that", { tone: "danger" });
        } finally {
          setBusy(false);
        }
      }}
    >
      {on ? "Leave admin (demo)" : "Become admin (demo)"}
    </Button>
  );
}

function Queue() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const reduced = useReducedMotion();
  const now = useNow(60_000);
  const { data, isPending, isError } = useReviewQueue();
  const selectedId = params.get("v");
  const items = data ?? [];
  const selected = items.find((i) => i.version.id === selectedId) ?? null;

  const select = (id: string | null) => {
    router.replace(id ? `${pathname}?v=${id}` : pathname, { scroll: false });
  };

  return (
    <div>
      <motion.header className="flex flex-wrap items-end justify-between gap-3" initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={spring.soft}>
        <div>
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.22em] text-ink-400">
            <Gavel className="size-3.5" /> Admin
          </p>
          <h1 className="mt-1.5 font-display text-4xl font-extrabold tracking-tight">Review queue</h1>
          <p className="mt-1 text-sm text-ink-300">Oldest first. Approving a new app lists it; rejecting sends your notes to the developer.</p>
        </div>
        <AdminToggle on />
      </motion.header>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div className={cn(selected && "hidden lg:block")}>
          {isPending ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-20 rounded-2xl" />
              ))}
            </div>
          ) : isError ? (
            <p className="text-sm text-danger">Couldn&apos;t load the queue.</p>
          ) : items.length === 0 ? (
            <EmptyState emoji="🎉" title="Inbox zero">
              Nothing is waiting for review.
            </EmptyState>
          ) : (
            <ul className="space-y-2">
              <AnimatePresence initial={false}>
                {items.map((item, i) => {
                  const on = item.version.id === selected?.version.id;
                  return (
                    <motion.li
                      key={item.version.id}
                      layout={!reduced}
                      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={reduced ? { opacity: 0 } : { opacity: 0, x: -24, transition: { duration: 0.18 } }}
                      transition={{ ...spring.soft, delay: reduced ? 0 : Math.min(i, 6) * 0.03 }}
                    >
                      <button
                        type="button"
                        onClick={() => select(item.version.id)}
                        aria-current={on}
                        className={cn("relative flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition", on ? "border-white/25" : "border-white/[0.08] hover:border-white/20")}
                      >
                        {on && <motion.span layoutId="review-pick" className="absolute inset-0 rounded-2xl bg-white/[0.06]" transition={spring.layout} />}
                        <AppGlyph app={item.app} size={40} />
                        <span className="relative min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate font-semibold">{item.version.manifest.name}</span>
                            <span className="shrink-0 font-mono text-xs text-ink-300">v{item.version.version}</span>
                          </span>
                          <span className="block truncate text-xs text-ink-400">
                            @{item.developer.handle} · {ago(item.version.submittedAt ?? item.version.createdAt, now)}
                          </span>
                        </span>
                        {!item.published && (
                          <Badge tone="nova" className="relative">
                            New
                          </Badge>
                        )}
                      </button>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          )}
        </div>

        <div className={cn(!selected && "hidden lg:block")}>
          <AnimatePresence mode="wait" initial={false}>
            {selected ? (
              <motion.div
                key={selected.version.id}
                initial={reduced ? { opacity: 0 } : { opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, x: -12, transition: { duration: 0.12 } }}
                transition={spring.soft}
              >
                <ReviewDetail
                  item={selected}
                  onBack={() => select(null)}
                  onDecided={() => {
                    const next = items.find((i) => i.version.id !== selected.version.id);
                    select(next?.version.id ?? null);
                  }}
                />
              </motion.div>
            ) : (
              items.length > 0 && (
                <motion.div key="pick" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <EmptyState emoji="👈" title="Pick a version">
                    Its diff, a live preview and the decision live here.
                  </EmptyState>
                </motion.div>
              )
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function ReviewDetail({ item, onBack, onDecided }: { item: ReviewItem; onBack: () => void; onDecided: () => void }) {
  const now = useNow(60_000);
  const review = useReviewVersion();
  const [notes, setNotes] = useState("");
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [notesError, setNotesError] = useState(false);
  const closeConfirm = useCallback(() => setDecision(null), []);
  const { version, app, developer, published } = item;
  const preview = applyVersionToApp(app, version);

  const ask = (d: "approve" | "reject") => {
    if (d === "reject" && !notes.trim()) {
      setNotesError(true);
      play("error");
      haptic("error");
      return;
    }
    setDecision(d);
  };

  const decide = async () => {
    if (!decision) return;
    try {
      await review.mutateAsync({ versionId: version.id, decision, notes: notes.trim() });
      play(decision === "approve" ? "win" : "thump");
      haptic("success");
      toast(decision === "approve" ? `Approved ${version.manifest.name} v${version.version}` : `Sent v${version.version} back with notes`, {
        tone: "success",
        description: decision === "approve" ? (published ? "The developer can publish it now." : "The app is listed.") : "The developer gets your notes in their inbox.",
      });
      setDecision(null);
      onDecided();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't record the decision", { tone: "danger" });
    }
  };

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm text-ink-400 hover:text-ink-100 lg:hidden">
        <ArrowLeft className="size-4" /> Queue
      </button>

      <Panel>
        <div className="flex items-start gap-3">
          <AppGlyph app={preview} size={52} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-2xl font-extrabold tracking-tight">
              {version.manifest.name} <span className="font-mono text-base text-ink-300">v{version.version}</span>
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-400">
              <Link href={`/u/${developer.handle}`} className="inline-flex items-center gap-1.5 hover:text-ink-100">
                <Avatar person={developer} size={18} /> @{developer.handle}
              </Link>
              <span>· submitted {ago(version.submittedAt ?? version.createdAt, now)}</span>
              <span>· {published ? `replaces v${published.version}` : "new app"}</span>
            </div>
          </div>
        </div>
        {version.notes && (
          <blockquote className="mt-4 whitespace-pre-wrap rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-ink-100">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-ink-400">Release notes</span>
            {version.notes}
          </blockquote>
        )}
      </Panel>

      <Preview url={version.url} scoring={version.manifest.scoring} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <Panel>
          <PanelTitle sub={published ? `Against live v${published.version}` : "First version: the whole listing is new"}>Manifest diff</PanelTitle>
          <ManifestDiff className="mt-3" before={published ? sideOf(published) : null} after={sideOf(version)} beforeLabel={published ? `v${published.version}` : "Published"} afterLabel={`v${version.version}`} />
        </Panel>
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-ink-400">Listing card</p>
          <div onClickCapture={(e) => e.preventDefault()}>
            <AppCard app={preview} morph={false} />
          </div>
        </div>
      </div>

      <Panel>
        <PanelTitle sub="Required when requesting changes. The developer sees these in their console and inbox.">Decision</PanelTitle>
        <motion.textarea
          className={cn(fieldClass, "mt-3 h-28 resize-none py-3", notesError && "border-danger/60")}
          value={notes}
          maxLength={REVIEW_NOTES_MAX}
          placeholder="What works, what to fix. Be specific and kind."
          aria-label="Review notes"
          aria-invalid={notesError}
          animate={notesError ? { x: [0, -6, 6, -3, 0] } : { x: 0 }}
          transition={{ duration: 0.35 }}
          onChange={(e) => {
            setNotes(e.target.value);
            setNotesError(false);
          }}
        />
        <AnimatePresence>
          {notesError && (
            <motion.p className="mt-1 text-xs text-danger" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              Tell the developer what to change before rejecting.
            </motion.p>
          )}
        </AnimatePresence>
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="danger" icon={<X className="size-4" />} onClick={() => ask("reject")}>
            Request changes
          </Button>
          <Button variant="volt" icon={<Check className="size-4" />} onClick={() => ask("approve")}>
            Approve
          </Button>
        </div>
      </Panel>

      <ConfirmDialog
        open={decision !== null}
        onClose={closeConfirm}
        busy={review.isPending}
        onConfirm={decide}
        tone={decision === "reject" ? "danger" : "volt"}
        icon={decision === "reject" ? <X className="size-4" /> : <Check className="size-4" />}
        title={decision === "reject" ? `Request changes on v${version.version}?` : `Approve v${version.version}?`}
        description={
          decision === "reject"
            ? "The version goes back to the developer with your notes."
            : published
              ? "The developer can publish it whenever they're ready."
              : `${version.manifest.name} gets listed in the marketplace.`
        }
        confirmLabel={decision === "reject" ? "Send notes" : "Approve"}
      >
        {notes.trim() && <p className="whitespace-pre-wrap rounded-2xl bg-white/[0.04] px-4 py-3 text-sm text-ink-200">{notes.trim()}</p>}
      </ConfirmDialog>
    </div>
  );
}

/** The version's URL in a sandboxed frame: opened directly, apps run their mock host. */
function Preview({ url, scoring }: { url: string; scoring: string }) {
  const [device, setDevice] = useState<"phone" | "desktop">("phone");
  const [nonce, setNonce] = useState(0);
  return (
    <Panel>
      <PanelTitle
        sub="Standalone, with the SDK's mock host. Use the Sandbox for both seats and the protocol log."
        action={
          <div className="flex items-center gap-1.5">
            <Segmented
              size="sm"
              layoutId="review-device"
              value={device}
              onChange={setDevice}
              items={[
                { id: "phone", label: <span className="sr-only">Phone</span>, icon: <Smartphone className="size-3.5" /> },
                { id: "desktop", label: <span className="sr-only">Desktop</span>, icon: <Monitor className="size-3.5" /> },
              ]}
            />
            <Button size="icon-sm" variant="ghost" aria-label="Reload preview" onClick={() => setNonce((n) => n + 1)} icon={<RotateCw className="size-4" />} />
          </div>
        }
      >
        Live preview
      </PanelTitle>
      <motion.div
        layout
        transition={spring.soft}
        className={cn("mx-auto mt-4 overflow-hidden rounded-[1.75rem] border border-white/10 bg-black", device === "phone" ? "h-[620px] max-h-[75dvh] w-full max-w-[380px]" : "aspect-video w-full")}
      >
        <iframe key={nonce} src={url} title="Version preview" sandbox={APP_SANDBOX} allow={APP_ALLOW} className="size-full" referrerPolicy="no-referrer" />
      </motion.div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-400">{url}</span>
        <Button size="sm" variant="glass" icon={<FlaskConical className="size-3.5" />} href={sandboxHref(url, scoring)}>
          Both seats in Sandbox
        </Button>
        <Button size="sm" variant="ghost" iconRight={<ExternalLink className="size-3.5" />} href={url} target="_blank" rel="noreferrer">
          Open
        </Button>
      </div>
    </Panel>
  );
}

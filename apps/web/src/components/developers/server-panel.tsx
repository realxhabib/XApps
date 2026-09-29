"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AlertTriangle,
  Check,
  Copy,
  Eye,
  EyeOff,
  FlaskConical,
  KeyRound,
  Link2,
  RefreshCw,
  Scale,
  Send,
  ServerCog,
  ShieldCheck,
  Smartphone,
  Trash2,
  Webhook,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "@/components/chrome/toasts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { haptic } from "@/lib/haptics";
import { popIn, spring } from "@/lib/motion";
import { play } from "@/lib/sfx";
import { cn, timeAgo } from "@/lib/utils";
import { BackendError } from "@/platform/backend";
import { useBackend, useViewer } from "@/platform/client";
import {
  useAppServerConfig,
  useRotateAppSecret,
  useRotateWebhookSecret,
  useSendTestWebhook,
  useSetAppAuthority,
  useSetAppWebhook,
  useWebhookDeliveries,
} from "@/platform/queries";
import type { AppAuthority, AppManifest, AppServerConfig, WebhookDelivery } from "@/platform/types";
import { webhookUrlError } from "@/platform/webhook-url";
import { useOrigin } from "@/lib/use-origin";
import { reportSnippet, webhookSnippet } from "./server-snippets";

/** Give-up point for webhook retries (backoff 1, 2, 4 … 256 min). */
const MAX_ATTEMPTS = 9;

/** True when the signed-in viewer is this app's developer. */
export function useIsAppOwner(app: AppManifest | null | undefined): boolean {
  const { viewer } = useViewer();
  return !!app && !!viewer && !app.official && !!app.developer.id && app.developer.id === viewer.id;
}

export function webhookUrlProblem(url: string): string | null {
  return url.trim() ? webhookUrlError(url) : null;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof BackendError || error instanceof Error ? error.message : fallback;
}

function useNow(every = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [every]);
  return now;
}

/* ---------------------------------------------------------------------- */
/* Panel                                                                  */
/* ---------------------------------------------------------------------- */

type Reveal = { kind: "app" | "webhook"; secret: string; rotated: boolean };
type Confirm = "rotate-secret" | "rotate-webhook" | "clear-webhook" | "authority-server";

/** Owner-only settings for an app's own server: secret, webhook, authority, deliveries. */
export function ServerPanel({ app, className }: { app: AppManifest; className?: string }) {
  const backend = useBackend();
  const config = useAppServerConfig(app.slug);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [revealOpen, setRevealOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const rotateSecret = useRotateAppSecret(app.slug);
  const setWebhook = useSetAppWebhook(app.slug);
  const rotateWebhook = useRotateWebhookSecret(app.slug);
  const setAuthority = useSetAppAuthority(app.slug);

  const showSecret = (next: Reveal) => {
    setReveal(next);
    setRevealOpen(true);
    play("whoosh");
    haptic("success");
  };
  // Stable, so the dialogs don't re-run their focus handling on every render.
  const closeReveal = useCallback(() => {
    setRevealOpen(false);
    // Drop the secret from memory once the sheet has animated away.
    setTimeout(() => setReveal(null), 500);
  }, []);
  const closeConfirm = useCallback(() => setConfirm(null), []);

  const doRotateSecret = async () => {
    const rotated = !!config.data?.hasSecret;
    try {
      const secret = await rotateSecret.mutateAsync();
      setConfirm(null);
      showSecret({ kind: "app", secret, rotated });
    } catch (error) {
      setConfirm(null);
      toast(errorMessage(error, "Couldn't create a secret"), { tone: "danger" });
    }
  };

  const doSaveWebhook = async (url: string | null) => {
    try {
      const secret = await setWebhook.mutateAsync(url);
      setConfirm(null);
      if (secret) showSecret({ kind: "webhook", secret, rotated: !!config.data?.hasWebhook });
      else if (url) toast("Webhook URL unchanged", { description: "Your signing secret still works." });
      else toast("Webhook removed", { tone: "success", description: "No more events will be queued." });
      return true;
    } catch (error) {
      setConfirm(null);
      toast(errorMessage(error, "Couldn't save the webhook"), { tone: "danger" });
      return false;
    }
  };

  const doRotateWebhook = async () => {
    try {
      const secret = await rotateWebhook.mutateAsync();
      setConfirm(null);
      showSecret({ kind: "webhook", secret, rotated: true });
    } catch (error) {
      setConfirm(null);
      toast(errorMessage(error, "Couldn't rotate the signing secret"), { tone: "danger" });
    }
  };

  const doSetAuthority = async (authority: AppAuthority) => {
    try {
      await setAuthority.mutateAsync(authority);
      setConfirm(null);
      play("thump");
      haptic("medium");
      toast(authority === "server" ? "Your server is the referee now" : "Players' clients settle matches again", {
        tone: "success",
        description: authority === "server" ? "Report every result with POST /api/v1/matches/:id/result." : undefined,
      });
    } catch (error) {
      setConfirm(null);
      toast(errorMessage(error, "Couldn't change who settles matches"), { tone: "danger" });
    }
  };

  const busyConfirm =
    confirm === "rotate-secret"
      ? rotateSecret.isPending
      : confirm === "rotate-webhook"
        ? rotateWebhook.isPending
        : confirm === "clear-webhook"
          ? setWebhook.isPending
          : setAuthority.isPending;

  return (
    <section id="server" className={cn("scroll-mt-24", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.22em] text-ink-400">
            <ShieldCheck className="size-3.5" /> Owner only
          </p>
          <h2 className="mt-1.5 font-display text-3xl font-extrabold tracking-tight">Server</h2>
          <p className="mt-1 max-w-xl text-sm text-ink-300">
            Let your own backend referee {app.name}: read and write matches with a secret, receive signed webhooks and settle
            results players can&apos;t fake.
          </p>
        </div>
        {config.data && (
          <Badge tone={config.data.authority === "server" ? "volt" : "neutral"}>
            {config.data.authority === "server" ? <ServerCog className="size-3" /> : <Smartphone className="size-3" />}
            {config.data.authority === "server" ? "Server settles" : "Clients settle"}
          </Badge>
        )}
      </div>

      {!backend.serverApi && <DemoNotice />}

      {config.isPending ? (
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-56 rounded-[2rem]" />
          <Skeleton className="h-56 rounded-[2rem]" />
          <Skeleton className="h-44 rounded-[2rem] lg:col-span-2" />
        </div>
      ) : config.error || !config.data ? (
        <div className="mt-6 flex items-start gap-3 rounded-[2rem] border border-danger/25 bg-danger/[0.06] p-6 text-sm">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" />
          <div>
            <p className="font-semibold text-ink-50">Server settings are unavailable</p>
            <p className="mt-1 text-ink-300">{errorMessage(config.error, "Try again in a moment.")}</p>
          </div>
        </div>
      ) : (
        <motion.div
          className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2"
          initial="hidden"
          animate="show"
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
        >
          <SecretCard config={config.data} busy={rotateSecret.isPending} onCreate={doRotateSecret} onRotate={() => setConfirm("rotate-secret")} />
          <WebhookCard
            key={config.data.webhookUrl ?? ""}
            config={config.data}
            saving={setWebhook.isPending && confirm !== "clear-webhook"}
            onSave={doSaveWebhook}
            onRotate={() => setConfirm("rotate-webhook")}
            onClear={() => setConfirm("clear-webhook")}
          />
          <AuthorityCard
            className="lg:col-span-2"
            app={app}
            config={config.data}
            demo={!backend.serverApi}
            onChange={(authority) => (authority === "server" ? setConfirm("authority-server") : void doSetAuthority("client"))}
          />
          <DeliveriesCard className="lg:col-span-2" app={app} config={config.data} />
          <SnippetsCard className="lg:col-span-2" />
        </motion.div>
      )}

      <ConfirmDialog
        open={confirm === "rotate-secret"}
        onClose={closeConfirm}
        busy={busyConfirm}
        tone="danger"
        title="Rotate the app secret?"
        confirmLabel="Rotate secret"
        onConfirm={doRotateSecret}
      >
        <p>
          The current secret <b className="font-mono text-ink-50">{config.data?.secretPrefix}…</b> stops working{" "}
          <b className="text-ink-50">immediately</b>. Your server gets 401s from the API until you deploy the new one.
        </p>
        {config.data?.authority === "server" && (
          <p className="mt-2">
            {app.name} is server-authoritative, so no match can settle until then (the 24 h safety valve still applies).
          </p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm === "rotate-webhook"}
        onClose={closeConfirm}
        busy={busyConfirm}
        tone="danger"
        title="Rotate the signing secret?"
        confirmLabel="Rotate signing secret"
        onConfirm={doRotateWebhook}
      >
        <p>
          Deliveries are signed with the new secret straight away, so your receiver rejects them until you deploy it. Failed
          deliveries are retried for a few hours.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm === "clear-webhook"}
        onClose={closeConfirm}
        busy={busyConfirm}
        tone="danger"
        title="Remove the webhook?"
        confirmLabel="Remove webhook"
        onConfirm={() => void doSaveWebhook(null)}
      >
        <p>No more events are queued for {app.name}, and the signing secret is deleted. Adding a URL again creates a new one.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm === "authority-server"}
        onClose={closeConfirm}
        busy={busyConfirm}
        title="Make your server the referee?"
        confirmLabel="Switch to server"
        onConfirm={() => void doSetAuthority("server")}
      >
        <ul className="space-y-2">
          <li className="flex gap-2">
            <Check className="mt-0.5 size-4 shrink-0 text-volt" />
            <span>
              Your server settles every match with <code className="font-mono text-ink-50">POST /api/v1/matches/:id/result</code>.
            </span>
          </li>
          <li className="flex gap-2">
            <Check className="mt-0.5 size-4 shrink-0 text-volt" />
            <span>Players still submit, but their scores become claims — never final on their own.</span>
          </li>
          <li className="flex gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-gold" />
            <span>If everyone has submitted and your server stays silent for 24 h, the match settles as a draw.</span>
          </li>
        </ul>
      </ConfirmDialog>

      <SecretDialog reveal={reveal} open={revealOpen} onClose={closeReveal} />
    </section>
  );
}

/* ---------------------------------------------------------------------- */
/* Pieces                                                                 */
/* ---------------------------------------------------------------------- */

const cardVariants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: spring.soft },
};

function Card({ icon, title, action, children, className }: { icon: ReactNode; title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <motion.div variants={cardVariants} className={cn("min-w-0 rounded-[2rem] glass p-5 sm:p-6", className)}>
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-white/[0.06]">{icon}</span>
        <h3 className="min-w-0 flex-1 font-display text-lg font-extrabold">{title}</h3>
        {action}
      </div>
      {children}
    </motion.div>
  );
}

function DemoNotice() {
  return (
    <div className="mt-5 flex items-start gap-3 rounded-3xl border border-gold/25 bg-gold/[0.07] p-4 text-sm">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold">
        <FlaskConical className="size-4" />
      </span>
      <p className="leading-relaxed text-ink-200">
        <b className="text-ink-50">Demo mode.</b> The server API and webhooks need Supabase, so nothing here ever leaves this
        browser and matches still settle on the client. Everything else — secrets, the webhook, authority and the deliveries
        log — is a faithful preview.
      </p>
    </div>
  );
}

function MaskedValue({ prefix, empty }: { prefix: string | null; empty: string }) {
  if (!prefix) {
    return (
      <div className="flex h-12 items-center rounded-2xl border border-dashed border-white/15 px-4 text-sm text-ink-400">{empty}</div>
    );
  }
  return (
    <div className="flex h-12 min-w-0 items-center gap-1 overflow-hidden rounded-2xl border border-white/10 bg-ink-950/60 px-4 font-mono text-sm">
      <span className="text-ink-50">{prefix}</span>
      <span className="truncate tracking-[0.2em] text-ink-500" aria-hidden>
        ••••••••••••••••••••••••••••
      </span>
      <span className="sr-only">(hidden)</span>
    </div>
  );
}

function SecretCard({ config, busy, onCreate, onRotate }: { config: AppServerConfig; busy: boolean; onCreate: () => void; onRotate: () => void }) {
  return (
    <Card icon={<KeyRound className="size-5 text-nova-300" />} title="App secret" action={config.hasSecret ? <Badge tone="success">Active</Badge> : undefined}>
      <p className="mt-3 text-sm text-ink-300">
        Your server sends it as <code className="font-mono text-[13px] text-ink-100">Authorization: Bearer xas_…</code> to the
        server API. Keep it out of your app&apos;s browser code.
      </p>
      <div className="mt-4">
        <MaskedValue prefix={config.hasSecret ? config.secretPrefix : null} empty="No secret yet" />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {config.hasSecret ? (
          <Button variant="outline" size="md" icon={<RefreshCw className="size-4" />} onClick={onRotate}>
            Rotate secret
          </Button>
        ) : (
          <Button variant="primary" size="md" icon={<KeyRound className="size-4" />} loading={busy} onClick={onCreate}>
            Create secret
          </Button>
        )}
      </div>
    </Card>
  );
}

function WebhookCard({
  config,
  saving,
  onSave,
  onRotate,
  onClear,
}: {
  config: AppServerConfig;
  saving: boolean;
  onSave: (url: string) => Promise<boolean>;
  onRotate: () => void;
  onClear: () => void;
}) {
  const [draft, setDraft] = useState(config.webhookUrl ?? "");
  const [touched, setTouched] = useState(false);
  const problem = webhookUrlProblem(draft);
  const clean = draft.trim();
  const changed = clean !== (config.webhookUrl ?? "");
  const showProblem = touched && !!problem;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (problem) {
      play("error");
      haptic("error");
      return;
    }
    if (!clean || !changed) return;
    await onSave(clean);
  };

  return (
    <Card
      icon={<Webhook className="size-5 text-flare" />}
      title="Webhook"
      action={config.hasWebhook ? <Badge tone="success">Signing</Badge> : undefined}
    >
      <p className="mt-3 text-sm text-ink-300">
        We POST match events here, signed with a separate <code className="font-mono text-[13px] text-ink-100">whsec_…</code>{" "}
        secret. Any 2xx counts as delivered.
      </p>
      <form onSubmit={submit} className="mt-4" noValidate>
        <label htmlFor="webhook-url" className="sr-only">
          Webhook URL
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <motion.input
            id="webhook-url"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="https://api.example.com/xapps/webhook"
            aria-invalid={showProblem}
            aria-describedby="webhook-url-help"
            animate={showProblem ? { x: [0, -6, 6, -3, 3, 0] } : { x: 0 }}
            transition={{ duration: 0.35 }}
            className={cn(
              "h-12 min-w-0 flex-1 rounded-2xl border bg-white/[0.03] px-4 font-mono text-sm outline-none transition placeholder:text-ink-500 focus:bg-white/[0.05]",
              showProblem ? "border-danger/60" : "border-white/10 focus:border-nova-400/60",
            )}
          />
          <Button type="submit" variant="primary" size="lg" loading={saving} disabled={!clean || !changed}>
            {config.hasWebhook ? "Save" : "Add webhook"}
          </Button>
        </div>
        <p id="webhook-url-help" className={cn("mt-2 min-h-5 text-xs", showProblem ? "text-danger" : "text-ink-400")}>
          {showProblem ? problem : changed && clean && config.hasWebhook ? "Saving a new URL creates a new signing secret." : "https only."}
        </p>
      </form>
      {config.hasWebhook && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" icon={<RefreshCw className="size-3.5" />} onClick={onRotate}>
            Rotate signing secret
          </Button>
          <Button variant="ghost" size="sm" icon={<Trash2 className="size-3.5" />} onClick={onClear}>
            Remove
          </Button>
        </div>
      )}
    </Card>
  );
}

function AuthorityCard({
  app,
  config,
  demo,
  onChange,
  className,
}: {
  app: AppManifest;
  config: AppServerConfig;
  demo: boolean;
  onChange: (authority: AppAuthority) => void;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const votes = app.scoring === "votes";
  const serverBlocked = votes
    ? "Crowd-judged apps are settled by votes, so there's nothing for a server to referee."
    : !config.hasSecret
      ? "Create an app secret first — your server needs it to report results."
      : null;
  const current = config.authority;
  const options: { id: AppAuthority; label: string; icon: ReactNode; disabled: boolean }[] = [
    { id: "client", label: "Client", icon: <Smartphone className="size-4" />, disabled: false },
    { id: "server", label: "Server", icon: <ServerCog className="size-4" />, disabled: current !== "server" && !!serverBlocked },
  ];

  return (
    <Card icon={<Scale className="size-5 text-volt" />} title="Who settles matches" className={className}>
      <div className="mt-4 grid grid-cols-1 gap-5 md:grid-cols-[auto_1fr] md:items-start">
        <div>
          <div role="radiogroup" aria-label="Match authority" className="inline-flex items-center gap-1 rounded-full glass p-1">
            {options.map((option) => {
              const active = option.id === current;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-disabled={option.disabled}
                  disabled={option.disabled}
                  onClick={() => {
                    if (active || option.disabled) return;
                    play("tick");
                    haptic("light");
                    onChange(option.id);
                  }}
                  className={cn(
                    "relative flex h-10 items-center gap-2 rounded-full px-5 text-sm font-semibold transition-colors",
                    active ? "text-ink-950" : option.disabled ? "cursor-not-allowed text-ink-500" : "text-ink-300 hover:text-ink-50",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId={`authority-${app.slug}`}
                      className={cn("absolute inset-0 rounded-full", option.id === "server" ? "bg-volt" : "bg-ink-50")}
                      transition={spring.layout}
                    />
                  )}
                  <span className="relative flex items-center gap-2">
                    {option.icon}
                    {option.label}
                  </span>
                </button>
              );
            })}
          </div>
          {serverBlocked && current !== "server" && (
            <p className="mt-3 flex max-w-xs gap-2 text-xs text-ink-400">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-gold" />
              {serverBlocked}
            </p>
          )}
        </div>
        <div className="relative min-h-32">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={current}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10, filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8, filter: "blur(6px)" }}
              transition={{ ...spring.soft, filter: { duration: 0.3 } }}
              className="text-sm text-ink-300"
            >
              {current === "server" ? (
                <ul className="space-y-2.5">
                  <li className="flex gap-2.5">
                    <ServerCog className="mt-0.5 size-4 shrink-0 text-volt" />
                    <span>
                      <b className="text-ink-50">Your server settles every match</b> via{" "}
                      <code className="font-mono text-[13px] text-ink-100">POST /api/v1/matches/:id/result</code>.
                    </span>
                  </li>
                  <li className="flex gap-2.5">
                    <Smartphone className="mt-0.5 size-4 shrink-0 text-ink-400" />
                    <span>
                      Players&apos; scores become <b className="text-ink-50">claims</b>: stored with their entry, never final on
                      their own.
                    </span>
                  </li>
                  <li className="flex gap-2.5">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-gold" />
                    <span>
                      <b className="text-ink-50">24 h safety valve:</b> once everyone has submitted, an unreported match settles
                      as a draw (<code className="font-mono text-[13px]">reason: &quot;server_timeout&quot;</code>).
                    </span>
                  </li>
                </ul>
              ) : (
                <ul className="space-y-2.5">
                  <li className="flex gap-2.5">
                    <Smartphone className="mt-0.5 size-4 shrink-0 text-ink-100" />
                    <span>
                      <b className="text-ink-50">Players&apos; clients report scores</b> and the platform settles as soon as
                      everyone has submitted. Zero infrastructure.
                    </span>
                  </li>
                  <li className="flex gap-2.5">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-gold" />
                    <span>A modified client can claim any score. Fine for casual play; switch to server for anything competitive.</span>
                  </li>
                  <li className="flex gap-2.5">
                    <ServerCog className="mt-0.5 size-4 shrink-0 text-ink-400" />
                    <span>Your server can still report results early with the secret — it just isn&apos;t required.</span>
                  </li>
                </ul>
              )}
              {demo && current === "server" && (
                <p className="mt-3 text-xs text-ink-400">Demo mode has no server to report, so matches here still settle in the browser.</p>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </Card>
  );
}

type DeliveryStatus = { label: string; tone: "success" | "gold" | "danger" | "neutral" | "nova"; pulse?: boolean };

export function deliveryStatus(d: WebhookDelivery): DeliveryStatus {
  if (d.id.startsWith("optimistic-")) return { label: "Sending", tone: "nova", pulse: true };
  if (d.deliveredAt) return { label: "Delivered", tone: "success" };
  if (d.attempts >= MAX_ATTEMPTS) return { label: `Failed · ${d.attempts} tries`, tone: "danger" };
  if (d.attempts > 0) return { label: `Retrying · ${d.attempts}/${MAX_ATTEMPTS}`, tone: "gold", pulse: true };
  if (d.lastError) return { label: "Not sent", tone: "neutral" };
  return { label: "Queued", tone: "nova", pulse: true };
}

function DeliveriesCard({ app, config, className }: { app: AppManifest; config: AppServerConfig; className?: string }) {
  const deliveries = useWebhookDeliveries(app.slug);
  const sendTest = useSendTestWebhook(app.slug);
  const now = useNow();
  const reduced = useReducedMotion();
  const rows = deliveries.data ?? [];

  const send = async () => {
    haptic("light");
    try {
      await sendTest.mutateAsync();
      toast("Test event queued", { tone: "success", description: "A ping is on its way to your webhook." });
    } catch (error) {
      toast(errorMessage(error, "Couldn't send a test event"), { tone: "danger" });
    }
  };

  return (
    <Card
      icon={<Send className="size-5 text-nova-300" />}
      title="Deliveries"
      className={className}
      action={
        <Button
          variant="glass"
          size="sm"
          icon={<Send className="size-3.5" />}
          onClick={send}
          disabled={!config.hasWebhook || sendTest.isPending}
          title={config.hasWebhook ? undefined : "Add a webhook URL first"}
        >
          <span className="hidden sm:inline">Send test event</span>
          <span className="sm:hidden">Test</span>
        </Button>
      }
    >
      <p className="mt-3 flex items-center gap-2 text-xs text-ink-400">
        <span className="relative flex size-2">
          {config.hasWebhook && !reduced && <span className="absolute inset-0 animate-ping-soft rounded-full bg-success" />}
          <span className={cn("relative size-2 rounded-full", config.hasWebhook ? "bg-success" : "bg-ink-500")} />
        </span>
        {config.hasWebhook ? "Live · refreshes every 10 s · retries back off up to 256 min, 9 attempts" : "Add a webhook URL to start receiving events."}
      </p>

      {deliveries.isPending ? (
        <div className="mt-4 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-2xl" />
          ))}
        </div>
      ) : deliveries.error ? (
        <p className="mt-4 text-sm text-danger">{errorMessage(deliveries.error, "Couldn't load deliveries")}</p>
      ) : rows.length === 0 ? (
        <div className="mt-4 rounded-3xl border border-dashed border-white/10 px-5 py-8 text-center">
          <p className="font-semibold text-ink-100">No deliveries yet</p>
          <p className="mt-1 text-sm text-ink-400">
            {config.hasWebhook ? "Send a test event, or play a match of your app." : "Set a webhook URL, then send a test event."}
          </p>
        </div>
      ) : (
        <div className="mt-4">
          <div className="hidden grid-cols-[9rem_7rem_11rem_1fr_5rem] gap-3 px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-500 md:grid">
            <span>Event</span>
            <span>Match</span>
            <span>Status</span>
            <span>Last response</span>
            <span className="text-right">When</span>
          </div>
          <ul className="space-y-1.5">
            <AnimatePresence initial={false}>
              {rows.map((d) => {
                const status = deliveryStatus(d);
                return (
                  <motion.li
                    key={d.id}
                    layout={!reduced}
                    variants={popIn}
                    initial={reduced ? false : "hidden"}
                    animate="show"
                    exit={{ opacity: 0 }}
                    transition={spring.snappy}
                    className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 rounded-2xl border border-white/[0.06] bg-ink-900/50 px-3 py-2.5 text-sm md:grid-cols-[9rem_7rem_11rem_1fr_5rem]"
                  >
                    <span className="truncate font-mono text-[13px] text-ink-50">{d.event}</span>
                    <span className="order-last col-span-2 truncate md:order-none md:col-span-1">
                      {d.matchId ? (
                        <Link href={`/play/${d.matchId}`} className="inline-flex items-center gap-1 font-mono text-xs text-nova-300 hover:underline">
                          <Link2 className="size-3" />
                          {d.matchId.slice(0, 8)}
                        </Link>
                      ) : (
                        <span className="hidden text-xs text-ink-500 md:inline">—</span>
                      )}
                    </span>
                    <span className="justify-self-end md:justify-self-start">
                      <Badge tone={status.tone} pulse={status.pulse}>
                        {status.label}
                      </Badge>
                    </span>
                    <span className="order-last col-span-2 min-w-0 text-xs md:order-none md:col-span-1" title={d.lastError ?? undefined}>
                      {d.lastStatus !== null && (
                        <span className={cn("mr-2 font-mono", d.lastStatus >= 200 && d.lastStatus < 300 ? "text-success" : "text-danger")}>
                          HTTP {d.lastStatus}
                        </span>
                      )}
                      <span className={cn("line-clamp-2 md:line-clamp-1", d.lastError ? "text-ink-300" : "text-ink-500")}>
                        {d.lastError ?? (d.deliveredAt ? `Delivered ${timeAgo(d.deliveredAt, now)}` : "Waiting for the next attempt")}
                      </span>
                    </span>
                    <span className="col-start-2 row-start-1 hidden text-right text-xs tabular text-ink-400 md:col-start-auto md:row-start-auto md:block">
                      {timeAgo(d.createdAt, now)}
                    </span>
                    <span className="order-last col-span-2 text-xs tabular text-ink-500 md:hidden">
                      {timeAgo(d.createdAt, now)}
                      {d.attempts > 0 && ` · ${d.attempts} ${d.attempts === 1 ? "attempt" : "attempts"}`}
                    </span>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        </div>
      )}
    </Card>
  );
}

function SnippetsCard({ className }: { className?: string }) {
  const [tab, setTab] = useState<"verify" | "report">("verify");
  const host = useOrigin();
  return (
    <Card icon={<ShieldCheck className="size-5 text-success" />} title="Wire up your server" className={className}>
      <p className="mt-3 text-sm text-ink-300">
        Store the secrets as <code className="font-mono text-[13px] text-ink-100">XAPPS_SECRET</code> and{" "}
        <code className="font-mono text-[13px] text-ink-100">XAPPS_WEBHOOK_SECRET</code>, then:
      </p>
      <Segmented
        className="mt-4"
        size="sm"
        layoutId="server-snippet"
        value={tab}
        onChange={setTab}
        items={[
          { id: "verify", label: "Verify a webhook" },
          { id: "report", label: "Report a result" },
        ]}
      />
      <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring.snappy} className="mt-3">
        <CodeBlock
          filename={tab === "verify" ? "app/api/xapps/webhook/route.ts" : "lib/xapps.ts"}
          code={tab === "verify" ? webhookSnippet() : reportSnippet(host)}
        />
      </motion.div>
    </Card>
  );
}

/* ---------------------------------------------------------------------- */
/* Dialogs                                                                */
/* ---------------------------------------------------------------------- */

function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  confirmLabel,
  busy,
  tone = "primary",
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  confirmLabel: string;
  busy: boolean;
  tone?: "primary" | "danger";
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <div className="text-sm leading-relaxed text-ink-300">{children}</div>
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" size="lg" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant={tone === "danger" ? "danger" : "volt"} size="lg" loading={busy} onClick={onConfirm} data-autofocus>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}

const HEX = "0123456789abcdef";

/** Unmasks a secret with a quick decode shimmer (instant with reduced motion). */
function DecodeText({ text, prefixLength }: { text: string; prefixLength: number }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? text.length : prefixLength);
  const [noise, setNoise] = useState("");
  useEffect(() => {
    if (reduced) return;
    let frame = 0;
    let raf = 0;
    const step = () => {
      frame++;
      const next = Math.min(text.length, prefixLength + frame * 2);
      setShown(next);
      let scrambled = "";
      for (let i = next; i < Math.min(text.length, next + 6); i++) scrambled += HEX[Math.floor(Math.random() * 16)];
      setNoise(scrambled);
      if (next < text.length) raf = requestAnimationFrame(step);
      else setNoise("");
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [text, prefixLength, reduced]);
  const visible = reduced ? text.length : shown;
  return (
    <>
      {text.slice(0, visible)}
      {visible < text.length && <span className="text-nova-300/70">{noise}</span>}
    </>
  );
}

function SecretDialog({ reveal, open, onClose }: { reveal: Reveal | null; open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} className="max-w-xl">
      {reveal && <SecretReveal key={reveal.secret} reveal={reveal} onClose={onClose} />}
    </Dialog>
  );
}

function SecretReveal({ reveal, onClose }: { reveal: Reveal; onClose: () => void }) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const isApp = reveal.kind === "app";
  const prefixLength = isApp ? 4 : 6;
  const envName = isApp ? "XAPPS_SECRET" : "XAPPS_WEBHOOK_SECRET";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reveal.secret);
      setCopied(true);
      play("pop");
      haptic("light");
    } catch {
      setVisible(true);
      toast("Couldn't reach the clipboard", { tone: "warning", description: "The secret is revealed — copy it by hand." });
    }
  };

  return (
    <div>
      <motion.div
        className="mx-auto flex size-14 items-center justify-center rounded-3xl bg-[linear-gradient(135deg,var(--color-nova-500),var(--color-flare))] text-white shadow-[0_10px_40px_-10px_rgb(123_97_255/0.8)]"
        initial={{ scale: 0.4, rotate: -20, opacity: 0 }}
        animate={{ scale: 1, rotate: 0, opacity: 1 }}
        transition={spring.wobbly}
      >
        {isApp ? <KeyRound className="size-6" /> : <Webhook className="size-6" />}
      </motion.div>
      <h2 className="mt-4 text-center font-display text-2xl font-bold tracking-tight">
        {isApp ? (reveal.rotated ? "Your new app secret" : "Your app secret") : "Your webhook signing secret"}
      </h2>
      <p className="mt-1.5 text-center text-sm text-ink-300">
        {isApp
          ? reveal.rotated
            ? "The old secret has stopped working. Deploy this one now."
            : "Your server uses it to call the XApps server API."
          : "Use it to verify the X-XApps-Signature header on every delivery."}
      </p>

      <div className="mt-5 flex items-start gap-3 rounded-2xl border border-danger/30 bg-danger/[0.08] p-3.5 text-sm">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
        <p className="text-ink-200">
          <b className="text-ink-50">You won&apos;t see this again.</b> We only keep a hash. Store it in your server&apos;s
          environment as <code className="font-mono text-[13px] text-ink-50">{envName}</code> — if you lose it, rotate.
        </p>
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-2xl border border-white/10 bg-ink-950/70 p-2 pl-4">
        <code className={cn("min-w-0 flex-1 font-mono text-[13px] leading-relaxed text-ink-50", visible ? "break-all" : "overflow-hidden whitespace-nowrap")} aria-live="polite">
          {visible ? (
            <DecodeText text={reveal.secret} prefixLength={prefixLength} />
          ) : (
            <>
              {reveal.secret.slice(0, prefixLength)}
              <span className="tracking-[0.15em] text-ink-500">{"•".repeat(Math.min(16, reveal.secret.length - prefixLength))}</span>
            </>
          )}
        </code>
        <button
          type="button"
          onClick={() => {
            play("tick");
            setVisible((v) => !v);
          }}
          className="flex size-10 shrink-0 items-center justify-center rounded-xl text-ink-300 transition hover:bg-white/10 hover:text-white"
          aria-label={visible ? "Hide secret" : "Reveal secret"}
          aria-pressed={visible}
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>

      <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
        <Button
          size="lg"
          variant={copied ? "glass" : "primary"}
          className="sm:flex-1"
          icon={
            <AnimatePresence mode="wait" initial={false}>
              <motion.span key={copied ? "done" : "copy"} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring.bouncy}>
                {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
              </motion.span>
            </AnimatePresence>
          }
          onClick={copy}
          data-autofocus
        >
          {copied ? "Copied" : "Copy secret"}
        </Button>
        <Button size="lg" variant={copied ? "primary" : "ghost"} className="sm:flex-1" onClick={onClose}>
          {copied ? "I've stored it" : "Close without copying"}
        </Button>
      </div>
    </div>
  );
}

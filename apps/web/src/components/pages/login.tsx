"use client";

import { motion } from "motion/react";
import { ArrowRight, FlaskConical, TriangleAlert } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { LogoMark } from "@/components/chrome/logo";
import { toast } from "@/components/chrome/toasts";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { XLogo } from "@/components/ui/x-logo";
import { spring } from "@/lib/motion";
import { isSupabaseConfigured } from "@/lib/env";
import { useMounted } from "@/lib/use-mounted";
import { setDemoForced, useBackend, useViewer } from "@/platform/client";
import type { Profile } from "@/platform/types";

function safeNext(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

const MESSAGES: Record<string, string> = {
  "not-configured": "Supabase isn't configured on this deployment yet.",
  "missing-code": "X didn't send back a sign-in code. Please try again.",
};

/** Plain-language fixes for the errors Supabase and X send back most often. */
const HINTS: [RegExp, string][] = [
  [/provider is not enabled|unsupported provider/i, "Turn on X / Twitter (OAuth 2.0) in Supabase → Authentication → Sign In / Providers."],
  [
    /code verifier|flow state|both auth code/i,
    "Sign-in finished on a different address than it started on. Use one address for the site, and add <that address>/auth/callback to Supabase → Authentication → URL Configuration → Redirect URLs.",
  ],
  [
    /exchange external code|invalid_client|unauthorized_client|invalid_request/i,
    "Supabase couldn't finish sign-in with X. Check the Client ID and Client Secret for the X provider in Supabase. On the X developer portal, the app needs OAuth 2.0 as a Web App, with https://<project-ref>.supabase.co/auth/v1/callback as a callback URL.",
  ],
  [/email/i, "X didn't share an email address. In the X developer portal, open the app's User authentication settings and turn on Request email from users."],
  [/access_denied|denied|cancel/i, "Sign-in was cancelled on X."],
];

export function Login() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const error = params.get("error");
  const hint = error ? HINTS.find(([pattern]) => pattern.test(error))?.[1] : undefined;
  const backend = useBackend();
  const { viewer } = useViewer();
  const [pending, setPending] = useState(false);
  const [handle, setHandle] = useState("");
  const mounted = useMounted();
  const personas: Profile[] = useMemo(() => (mounted && backend.demo ? backend.demo.personas().slice(0, 6) : []), [backend, mounted]);

  useEffect(() => {
    if (viewer) router.replace(next);
  }, [next, router, viewer]);

  const signInWithX = async () => {
    setPending(true);
    try {
      await backend.signInWithX(next);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't start sign in", { tone: "danger" });
      setPending(false);
    }
  };

  const demoSignIn = async (h: string) => {
    if (!backend.demo) return;
    try {
      const profile = await backend.demo.signInAs({ handle: h });
      toast(`Welcome, @${profile.handle}`, { tone: "success" });
      router.replace(next);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't sign in", { tone: "danger" });
    }
  };

  const demo = backend.kind === "demo";

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center">
      <motion.div
        className="relative overflow-hidden rounded-[2.5rem] glass-strong p-8 text-center shadow-2xl"
        initial={{ opacity: 0, y: 30, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={spring.soft}
      >
        <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 size-72 -translate-x-1/2 rounded-full bg-nova-500/30 blur-3xl" />
        <motion.div className="relative mx-auto w-fit" initial={{ rotate: -20, scale: 0.6 }} animate={{ rotate: 0, scale: 1 }} transition={spring.wobbly}>
          <LogoMark size={64} />
        </motion.div>
        <h1 className="relative mt-6 font-display text-4xl font-extrabold tracking-tight">Jump in</h1>
        <p className="relative mt-2 text-ink-300">Your X handle is your player card. One tap and you&apos;re in.</p>

        {error && (
          <div className="relative mt-5 flex items-start gap-2 rounded-2xl border border-danger/30 bg-danger/10 p-3 text-left text-sm text-[#ffb3ba]">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              {MESSAGES[error] ?? error}
              {hint && <span className="mt-1 block text-ink-200">{hint}</span>}
            </span>
          </div>
        )}

        <Button
          className="relative mt-7 w-full"
          size="xl"
          variant="primary"
          icon={<XLogo className="size-5" />}
          onClick={signInWithX}
          loading={pending}
          disabled={demo}
          magnetic
        >
          Continue with X
        </Button>
        {demo && (
          <p className="relative mt-2 text-xs text-ink-400">
            {isSupabaseConfigured
              ? "Demo mode is on for this browser."
              : "X sign-in turns on once Supabase keys are configured."}
          </p>
        )}
        {demo && isSupabaseConfigured && (
          <button onClick={() => setDemoForced(false)} className="relative mt-1 text-xs font-semibold text-nova-300 hover:underline">
            Switch back to Supabase
          </button>
        )}

        {demo && backend.demo && (
          <div className="relative mt-8 border-t border-white/[0.08] pt-6 text-left">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <FlaskConical className="size-4 text-gold" /> Try the demo
            </p>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void demoSignIn(handle || "player1");
              }}
            >
              <label className="flex h-11 flex-1 items-center rounded-full border border-white/10 bg-white/[0.03] px-4 focus-within:border-nova-400/60">
                <span className="text-ink-400">@</span>
                <input
                  value={handle}
                  onChange={(e) => setHandle(e.target.value.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 15))}
                  placeholder="pick a handle"
                  className="h-full w-full bg-transparent pl-0.5 text-sm outline-none placeholder:text-ink-500"
                  aria-label="Demo handle"
                />
              </label>
              <Button type="submit" size="md" variant="accent" iconRight={<ArrowRight className="size-4" />}>
                Go
              </Button>
            </form>
            {personas.length > 0 && (
              <>
                <p className="mt-4 text-xs text-ink-400">…or play as one of the regulars (open a second tab as another to duel yourself live):</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {personas.map((p, i) => (
                    <motion.button
                      key={p.id}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1, transition: { delay: 0.2 + i * 0.04, ...spring.bouncy } }}
                      whileHover={{ y: -2 }}
                      whileTap={{ scale: 0.94 }}
                      onClick={() => void demoSignIn(p.handle)}
                      className="flex items-center gap-1.5 rounded-full bg-white/[0.05] py-1 pl-1 pr-3 text-xs transition hover:bg-white/10"
                    >
                      <Avatar person={p} size={22} />@{p.handle}
                    </motion.button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </motion.div>
      <p className="mt-6 text-center text-xs text-ink-500">
        We only read your public X profile (name, handle, avatar). We never post without you pressing the button.
      </p>
    </div>
  );
}

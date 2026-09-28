"use client";

import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, FlaskConical, Rocket } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { z } from "zod";
import { toast } from "@/components/chrome/toasts";
import { AppCard } from "@/components/marketplace/app-card";
import { celebrate } from "@/components/motion/confetti";
import { Button } from "@/components/ui/button";
import { play } from "@/lib/sfx";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useBackend, useViewer } from "@/platform/client";
import { useRegisterApp } from "@/platform/queries";
import { CATEGORIES, type AppCategory, type AppManifest, type PlayableMode, type Scoring } from "@/platform/types";
import { SignInPrompt } from "./sign-in-prompt";

const ICONS = ["🎯", "🧠", "🎨", "🎲", "🏁", "🪩", "🧩", "🎤", "🗳️", "🃏", "🏀", "👾"];
const PALETTES: [string, string][] = [
  ["#5b74ff", "#a35cff"],
  ["#ff5ca8", "#8b5cff"],
  ["#ffe14d", "#ff7a1a"],
  ["#b6ff3d", "#1fd1b2"],
  ["#3d7bff", "#35e0ff"],
  ["#ff9a3d", "#ff3d6e"],
];

const schema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(40),
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, "3–40 lowercase letters, numbers or dashes"),
  tagline: z.string().trim().min(8, "Give it a hook (8+ characters)").max(90),
  description: z.string().trim().max(1200),
  category: z.enum(["games", "contests", "debates", "trivia", "creative", "social"]),
  icon: z.string().min(1, "Pick an emoji").max(16),
  accent: z.tuple([z.string().regex(/^#[0-9a-fA-F]{6}$/), z.string().regex(/^#[0-9a-fA-F]{6}$/)]),
  url: z.string().url("Must be a full URL").refine((u) => u.startsWith("https://") || u.startsWith("http://localhost"), "Use https (or http://localhost while testing)"),
  modes: z.array(z.enum(["live", "async", "practice"])).min(1, "Pick at least one mode"),
  scoring: z.enum(["high", "low", "votes"]),
  howTo: z.array(z.string().trim().max(120)).max(3),
});

type Form = z.infer<typeof schema>;
type Errors = Partial<Record<keyof Form, string>>;

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <motion.label className="block" animate={error ? { x: [0, -6, 6, -3, 0] } : { x: 0 }} transition={{ duration: 0.35 }}>
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
    </motion.label>
  );
}

const input =
  "h-11 w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 text-sm outline-none transition placeholder:text-ink-500 focus:border-nova-400/60 focus:bg-white/[0.05]";

export function RegisterApp() {
  const router = useRouter();
  const backend = useBackend();
  const { viewer, loading } = useViewer();
  const register = useRegisterApp();
  const [slugTouched, setSlugTouched] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [done, setDone] = useState<AppManifest | null>(null);
  const [form, setForm] = useState<Form>({
    name: "",
    slug: "",
    tagline: "",
    description: "",
    category: "games",
    icon: "🎯",
    accent: PALETTES[0]!,
    url: "https://",
    modes: ["live", "practice"],
    scoring: "high",
    howTo: ["", "", ""],
  });

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value, ...(key === "name" && !slugTouched ? { slug: slugify(String(value)) } : {}) }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const preview: AppManifest = useMemo(
    () => ({
      slug: form.slug || "your-app",
      name: form.name || "Your app",
      tagline: form.tagline || "A one-line hook that makes people tap.",
      description: form.description,
      category: form.category,
      icon: form.icon || "✨",
      accent: form.accent,
      url: form.url,
      modes: form.modes,
      players: { min: 2, max: 2 },
      scoring: form.scoring,
      durationLabel: "Community",
      howTo: form.howTo.filter(Boolean),
      official: false,
      developer: { id: viewer?.id ?? null, handle: viewer?.handle ?? "you", name: viewer?.name ?? "You" },
      status: "pending",
      playCount: 0,
      createdAt: new Date().toISOString(),
      tags: [],
    }),
    [form, viewer],
  );

  if (loading) return null;
  if (!viewer) return <SignInPrompt title="Sign in to register an app">Apps are tied to your X account so players know who built them.</SignInPrompt>;

  const submit = async () => {
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof Form;
        next[key] ??= issue.message;
      }
      setErrors(next);
      play("error");
      return;
    }
    try {
      const app = await register.mutateAsync({ ...parsed.data, howTo: parsed.data.howTo.filter(Boolean) });
      setDone(app);
      play("win");
      celebrate({ pattern: "cannons", colors: [app.accent[0], app.accent[1], "#ffffff"] });
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't register the app", { tone: "danger" });
    }
  };

  if (done) {
    return (
      <motion.div className="mx-auto max-w-xl text-center" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={spring.soft}>
        <motion.div initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={spring.wobbly} className="mx-auto w-fit">
          <CheckCircle2 className="size-16 text-volt" />
        </motion.div>
        <h1 className="mt-5 font-display text-4xl font-extrabold tracking-tight">
          {done.status === "published" ? `${done.name} is live!` : `${done.name} is in review`}
        </h1>
        <p className="mt-3 text-ink-300">
          {done.status === "published"
            ? "Demo mode auto-approves submissions so you can try it right away."
            : "We'll take a look soon. You can already play it in practice mode and test both seats in the Sandbox."}
        </p>
        <div className="mx-auto mt-8 max-w-sm">
          <AppCard app={done} morph={false} />
        </div>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button size="lg" variant="accent" icon={<Rocket className="size-4" />} onClick={() => router.push(`/apps/${done.slug}`)}>
            View listing
          </Button>
          <Button size="lg" variant="glass" icon={<FlaskConical className="size-4" />} href={`/developers/sandbox?url=${encodeURIComponent(done.url)}&scoring=${done.scoring}`}>
            Open in Sandbox
          </Button>
        </div>
      </motion.div>
    );
  }

  return (
    <div>
      <motion.header initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={spring.soft}>
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-ink-400">Developers</p>
        <h1 className="mt-2 font-display text-5xl font-extrabold tracking-tight">Register an app</h1>
        <p className="mt-3 text-ink-300">
          {backend.kind === "demo" ? "In demo mode your app is listed instantly (in this browser)." : "Submissions are reviewed before they're listed."}
        </p>
      </motion.header>

      <div className="mt-10 grid gap-10 lg:grid-cols-[1.2fr_1fr]">
        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          noValidate
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Name" error={errors.name}>
              <input className={input} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Tap Race" maxLength={40} />
            </Field>
            <Field label="Slug" error={errors.slug} hint={`xapps/apps/${form.slug || "…"}`}>
              <input
                className={cn(input, "font-mono")}
                value={form.slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  set("slug", e.target.value.toLowerCase());
                }}
                placeholder="tap-race"
                maxLength={40}
              />
            </Field>
          </div>
          <Field label="Tagline" error={errors.tagline}>
            <input className={input} value={form.tagline} onChange={(e) => set("tagline", e.target.value)} placeholder="Ten seconds. Fastest thumbs win." maxLength={90} />
          </Field>
          <Field label="Description" error={errors.description}>
            <textarea
              className={cn(input, "h-28 resize-none py-3")}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="What happens in a match, and why it's fun to play against a friend."
              maxLength={1200}
            />
          </Field>
          <Field label="App URL" error={errors.url} hint="Your app must allow framing: frame-ancestors <this site>">
            <input className={cn(input, "font-mono")} value={form.url} onChange={(e) => set("url", e.target.value)} placeholder="https://tap-race.dev" />
          </Field>

          <div>
            <span className="text-sm font-semibold">Category</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <motion.button
                  type="button"
                  key={c.id}
                  whileTap={{ scale: 0.94 }}
                  onClick={() => set("category", c.id as AppCategory)}
                  className={cn(
                    "rounded-full border px-3.5 py-2 text-sm font-semibold transition",
                    form.category === c.id ? "border-ink-50 bg-ink-50 text-ink-950" : "border-white/10 text-ink-200 hover:border-white/25",
                  )}
                >
                  {c.emoji} {c.label}
                </motion.button>
              ))}
            </div>
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <span className="text-sm font-semibold">Icon</span>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {ICONS.map((icon) => (
                  <motion.button
                    type="button"
                    key={icon}
                    whileHover={{ scale: 1.15, rotate: -6 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => set("icon", icon)}
                    className={cn("flex size-10 items-center justify-center rounded-xl text-xl transition", form.icon === icon ? "bg-white/15 ring-2 ring-white/60" : "bg-white/[0.04]")}
                    aria-label={`Icon ${icon}`}
                  >
                    {icon}
                  </motion.button>
                ))}
              </div>
            </div>
            <div>
              <span className="text-sm font-semibold">Accent</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {PALETTES.map((pair) => (
                  <motion.button
                    type="button"
                    key={pair.join()}
                    whileHover={{ scale: 1.12 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => set("accent", pair)}
                    className={cn("size-10 rounded-xl transition", form.accent.join() === pair.join() && "ring-2 ring-white/80 ring-offset-2 ring-offset-ink-950")}
                    style={{ background: `linear-gradient(135deg, ${pair[0]}, ${pair[1]})` }}
                    aria-label={`Accent ${pair.join(" to ")}`}
                  />
                ))}
                <label className="flex items-center gap-1 rounded-xl border border-white/10 px-2">
                  <input type="color" value={form.accent[0]} onChange={(e) => set("accent", [e.target.value, form.accent[1]])} className="size-6 cursor-pointer bg-transparent" aria-label="Accent start color" />
                  <input type="color" value={form.accent[1]} onChange={(e) => set("accent", [form.accent[0], e.target.value])} className="size-6 cursor-pointer bg-transparent" aria-label="Accent end color" />
                </label>
              </div>
            </div>
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <span className="text-sm font-semibold">Modes</span>
              <div className="mt-2 space-y-2">
                {(
                  [
                    ["live", "Live", "Both online at once"],
                    ["async", "Play anytime", "Take turns on your own time"],
                    ["practice", "Practice", "Your app plays a bot"],
                  ] as [PlayableMode, string, string][]
                ).map(([mode, label, sub]) => {
                  const on = form.modes.includes(mode);
                  return (
                    <button
                      type="button"
                      key={mode}
                      onClick={() => set("modes", on ? form.modes.filter((m) => m !== mode) : [...form.modes, mode])}
                      className={cn("flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition", on ? "border-white/30 bg-white/[0.07]" : "border-white/10")}
                    >
                      <span className={cn("flex size-5 items-center justify-center rounded-md border transition", on ? "border-volt bg-volt text-ink-950" : "border-white/25")}>
                        {on && "✓"}
                      </span>
                      <span>
                        <span className="block text-sm font-semibold">{label}</span>
                        <span className="block text-xs text-ink-400">{sub}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {errors.modes && <p className="mt-1 text-xs text-danger">{errors.modes}</p>}
            </div>
            <div>
              <span className="text-sm font-semibold">Who wins?</span>
              <div className="mt-2 space-y-2">
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
                    onClick={() => set("scoring", scoring)}
                    className={cn(
                      "relative flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition",
                      form.scoring === scoring ? "border-white/30" : "border-white/10",
                    )}
                  >
                    {form.scoring === scoring && <motion.span layoutId="scoring-pick" className="absolute inset-0 rounded-2xl bg-white/[0.07]" transition={spring.layout} />}
                    <span className={cn("relative size-4 rounded-full border-2 transition", form.scoring === scoring ? "border-volt bg-volt" : "border-white/25")} />
                    <span className="relative">
                      <span className="block text-sm font-semibold">{label}</span>
                      <span className="block text-xs text-ink-400">{sub}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <span className="text-sm font-semibold">How to play (up to 3 steps)</span>
            <div className="mt-2 space-y-2">
              {form.howTo.map((step, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] font-mono text-xs">{i + 1}</span>
                  <input
                    className={input}
                    value={step}
                    maxLength={120}
                    onChange={(e) => set("howTo", form.howTo.map((s, j) => (j === i ? e.target.value : s)))}
                    placeholder={["Both players see the same…", "Tap / type / drag to…", "Highest score wins."][i]}
                  />
                </div>
              ))}
            </div>
          </div>

          <Button type="submit" size="xl" variant="accent" loading={register.isPending} icon={<Rocket className="size-5" />} magnetic className="w-full sm:w-auto">
            Submit app
          </Button>
        </form>

        <div className="lg:sticky lg:top-28 lg:h-fit">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.22em] text-ink-400">Live preview</p>
          <motion.div layout transition={spring.soft} onClickCapture={(e) => e.preventDefault()}>
            <AppCard app={preview} morph={false} />
          </motion.div>
          <p className="mt-4 text-xs text-ink-500">This is exactly how your card appears in the marketplace.</p>
        </div>
      </div>
    </div>
  );
}

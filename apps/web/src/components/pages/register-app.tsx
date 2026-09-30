"use client";

import { AnimatePresence, motion } from "motion/react";
import { AppWindow, CheckCircle2, FlaskConical, LayoutDashboard, Rocket } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { z } from "zod";
import { toast } from "@/components/chrome/toasts";
import { AppCard } from "@/components/marketplace/app-card";
import { celebrate } from "@/components/motion/confetti";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { play } from "@/lib/sfx";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { CoverField, IconField } from "@/components/developers/app-images-field";
import { KindPicker } from "@/components/developers/kind-picker";
import { useBackend, useViewer } from "@/platform/client";
import { achievementDefsError, manifestShapeError, statDefsError } from "@/platform/catalog";
import { useRegisterApp } from "@/platform/queries";
import { CATEGORIES, type AppCategory, type AppManifest, type AppVersion, type PlayableMode, type Scoring } from "@/platform/types";
import {
  AchievementsEditor,
  StatsEditor,
  stripAchievementRows,
  stripStatRows,
  type AchievementRow,
  type StatRow,
} from "./progress-editors";
import { SignInPrompt } from "./sign-in-prompt";

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
  category: z.enum(CATEGORIES.map((c) => c.id) as [AppCategory, ...AppCategory[]]),
  kind: z.enum(["game", "app"]),
  icon: z.string().min(1, "Pick an emoji").max(16),
  iconImage: z.string().nullable(),
  coverImage: z.string().nullable(),
  accent: z.tuple([z.string().regex(/^#[0-9a-fA-F]{6}$/), z.string().regex(/^#[0-9a-fA-F]{6}$/)]),
  url: z.string().url("Must be a full URL").refine((u) => u.startsWith("https://") || u.startsWith("http://localhost"), "Use https (or http://localhost while testing)"),
  modes: z.array(z.enum(["live", "async", "practice"])).min(1, "Pick at least one mode"),
  scoring: z.enum(["high", "low", "votes"]),
  howTo: z.array(z.string().trim().max(120)).max(3),
  players: z.object({ min: z.number().int().min(2).max(8), max: z.number().int().min(2).max(8) }),
  teams: z.union([z.literal(0), z.literal(2), z.literal(3), z.literal(4)]),
  spectators: z.boolean(),
  turnBased: z.boolean(),
  setup: z.boolean(),
  // Checked with the same rules as the database (statDefsError / achievementDefsError).
  stats: z.array(z.custom<StatRow>()),
  achievements: z.array(z.custom<AchievementRow>()),
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

/** "v1.0.0 · Live now" / "v1.0.0 · In review" under the registration result. */
function VersionState({ version, live }: { version: AppVersion | null; live: boolean }) {
  const label = version?.version ?? "1.0.0";
  const published = version ? version.status === "published" : live;
  return (
    <motion.p
      className={cn(
        "mx-auto mt-4 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold",
        published ? "border-volt/30 bg-volt/10 text-volt" : "border-gold/30 bg-gold/10 text-gold",
      )}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring.soft, delay: 0.2 }}
    >
      <span className="font-mono tabular">v{label}</span>
      <span aria-hidden>·</span>
      <span>{published ? "Live now" : `${label} is in review`}</span>
    </motion.p>
  );
}

export function RegisterApp() {
  const router = useRouter();
  const backend = useBackend();
  const { viewer, loading } = useViewer();
  const register = useRegisterApp();
  const [slugTouched, setSlugTouched] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [done, setDone] = useState<AppManifest | null>(null);
  /** Version 1.0.0, created with the app (in review; demo mode publishes it right away). */
  const [firstVersion, setFirstVersion] = useState<AppVersion | null>(null);
  const [form, setForm] = useState<Form>({
    name: "",
    slug: "",
    tagline: "",
    description: "",
    category: "games",
    kind: "game",
    icon: "🎯",
    iconImage: null,
    coverImage: null,
    accent: PALETTES[0]!,
    url: "https://",
    modes: ["live", "practice"],
    scoring: "high",
    howTo: ["", "", ""],
    players: { min: 2, max: 2 },
    teams: 0,
    spectators: true,
    turnBased: false,
    setup: false,
    stats: [],
    achievements: [],
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
      kind: form.kind,
      icon: form.icon || "✨",
      iconImage: form.iconImage,
      coverImage: form.coverImage,
      accent: form.accent,
      url: form.url,
      modes: form.modes,
      players: form.players,
      teams: form.teams,
      spectators: form.spectators,
      turnBased: form.turnBased,
      setup: form.setup,
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
    const stats = stripStatRows(form.stats);
    const achievements = stripAchievementRows(form.achievements);
    const progressErrors: Errors = {};
    const statsError = statDefsError(stats);
    const achievementsError = achievementDefsError(achievements);
    if (statsError) progressErrors.stats = statsError;
    if (achievementsError) progressErrors.achievements = achievementsError;
    const shape = parsed.success ? manifestShapeError({ ...parsed.data, stats: [], achievements: [] }) : null;
    if (shape || statsError || achievementsError) {
      setErrors({ ...(shape ? { players: shape } : {}), ...progressErrors });
      play("error");
      return;
    }
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
      const app = await register.mutateAsync({ ...parsed.data, howTo: parsed.data.howTo.filter(Boolean), stats, achievements });
      const versions = await backend.listAppVersions(app.slug).catch(() => [] as AppVersion[]);
      setFirstVersion(versions.find((v) => v.version === "1.0.0") ?? versions[0] ?? null);
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
            ? "Demo mode auto-approves your first version so you can try it right away. Later versions go through the review queue."
            : done.kind === "app"
              ? "We'll take a look soon. You can already open it from your console."
              : "We'll take a look soon. You can already play it in practice mode and test both seats in the Sandbox."}
        </p>
        <VersionState version={firstVersion} live={done.status === "published"} />
        <div className="mx-auto mt-8 max-w-sm">
          <AppCard app={done} morph={false} upvote={false} />
        </div>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button size="lg" variant="accent" icon={<Rocket className="size-4" />} onClick={() => router.push(`/apps/${done.slug}`)}>
            View listing
          </Button>
          <Button size="lg" variant="glass" icon={<LayoutDashboard className="size-4" />} href={`/developers/apps/${done.slug}`}>
            Open app console
          </Button>
          {done.kind === "app" ? (
            <Button size="lg" variant="glass" icon={<AppWindow className="size-4" />} href={`/apps/${done.slug}/open`}>
              Open it
            </Button>
          ) : (
            <Button size="lg" variant="glass" icon={<FlaskConical className="size-4" />} href={`/developers/sandbox?url=${encodeURIComponent(done.url)}&scoring=${done.scoring}`}>
              Open in Sandbox
            </Button>
          )}
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

      <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-[1.2fr_1fr]">
        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          noValidate
        >
          <KindPicker
            value={form.kind}
            idPrefix="register-kind"
            onChange={(kind) =>
              setForm((f) => ({
                ...f,
                kind,
                // Apps rarely belong in Games; start them in Tools.
                category: kind === "app" && f.category === "games" ? "tools" : kind === "game" && ["news", "tools", "finance"].includes(f.category) ? "games" : f.category,
              }))
            }
          />

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
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

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <IconField
              icon={form.icon}
              iconImage={form.iconImage}
              accent={form.accent}
              name={form.name}
              onChange={(next) => setForm((f) => ({ ...f, ...next }))}
              error={errors.icon}
              idPrefix="register-icon"
            />
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

          <CoverField
            coverImage={form.coverImage}
            accent={form.accent}
            onChange={(next) => setForm((f) => ({ ...f, ...next }))}
            idPrefix="register-cover"
          />

          {form.kind === "game" && (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
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
          )}

          {form.kind === "game" && (
            <TableSettings
              value={{ players: form.players, teams: form.teams, spectators: form.spectators, turnBased: form.turnBased, setup: form.setup }}
              error={errors.players}
              onChange={(next) => {
                setForm((f) => ({ ...f, ...next }));
                setErrors((e) => ({ ...e, players: undefined }));
              }}
            />
          )}

          <StatsEditor value={form.stats} error={errors.stats} onChange={(rows) => set("stats", rows)} />
          <AchievementsEditor value={form.achievements} error={errors.achievements} onChange={(rows) => set("achievements", rows)} />

          <div>
            <span className="text-sm font-semibold">{form.kind === "app" ? "How it works (up to 3 steps)" : "How to play (up to 3 steps)"}</span>
            <div className="mt-2 space-y-2">
              {form.howTo.map((step, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] font-mono text-xs">{i + 1}</span>
                  <input
                    className={input}
                    value={step}
                    maxLength={120}
                    onChange={(e) => set("howTo", form.howTo.map((s, j) => (j === i ? e.target.value : s)))}
                    placeholder={(form.kind === "app" ? ["Pick the topics you follow…", "We pull the latest from X…", "Save what matters."] : ["Both players see the same…", "Tap / type / drag to…", "Highest score wins."])[i]}
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
            <AppCard app={preview} morph={false} upvote={false} />
          </motion.div>
          <p className="mt-4 text-xs text-ink-500">This is exactly how your card appears in the marketplace.</p>
        </div>
      </div>
    </div>
  );
}

type TableValue = Pick<Form, "players" | "teams" | "spectators" | "turnBased" | "setup">;

/** Seats, teams and the Stage 1 capabilities an app declares. */
function TableSettings({ value, error, onChange }: { value: TableValue; error?: string; onChange: (next: Partial<TableValue>) => void }) {
  const { min, max } = value.players;
  const setPlayers = (next: { min: number; max: number }) => {
    const lo = Math.min(8, Math.max(2, next.min));
    const hi = Math.min(8, Math.max(lo, next.max));
    onChange({ players: { min: lo, max: hi } });
  };
  const toggles: [keyof Pick<TableValue, "spectators" | "turnBased" | "setup">, string, string][] = [
    ["spectators", "Spectators", "Others can watch live matches"],
    ["turnBased", "Turn-based", "Players take turns; we ping whoever's up"],
    ["setup", "Custom setup", "You render the challenge setup screen"],
  ];
  return (
    <div>
      <span className="text-sm font-semibold">Table</span>
      <motion.div
        className="mt-2 grid grid-cols-1 gap-4 rounded-3xl border border-white/10 p-4 sm:grid-cols-2"
        animate={error ? { x: [0, -6, 6, -3, 0] } : { x: 0 }}
        transition={{ duration: 0.35 }}
      >
        <div className="space-y-3">
          {(
            [
              ["Fewest players", "min"],
              ["Most players", "max"],
            ] as const
          ).map(([label, key]) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <span className="text-sm text-ink-200">{label}</span>
              <div className="flex items-center gap-1 rounded-full glass p-1">
                <button
                  type="button"
                  aria-label={`Fewer (${label})`}
                  onClick={() => setPlayers({ ...value.players, [key]: value.players[key] - 1 })}
                  className="flex size-7 items-center justify-center rounded-full text-ink-200 transition hover:bg-white/10"
                >
                  −
                </button>
                <motion.span key={value.players[key]} initial={{ y: -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={spring.snappy} className="w-6 text-center font-mono font-bold tabular">
                  {value.players[key]}
                </motion.span>
                <button
                  type="button"
                  aria-label={`More (${label})`}
                  onClick={() => setPlayers({ ...value.players, [key]: value.players[key] + 1 })}
                  className="flex size-7 items-center justify-center rounded-full text-ink-200 transition hover:bg-white/10"
                >
                  +
                </button>
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-ink-200">Teams</span>
            <Segmented
              layoutId="register-teams"
              size="sm"
              value={String(value.teams) as "0" | "2" | "3" | "4"}
              onChange={(t) => onChange({ teams: Number(t) as TableValue["teams"] })}
              items={[
                { id: "0", label: "None" },
                { id: "2", label: "2" },
                { id: "3", label: "3" },
                { id: "4", label: "4" },
              ]}
            />
          </div>
          <p className="text-xs text-ink-400">
            {min === max ? `${min} players` : `${min}–${max} players`}
            {value.teams ? ` · ${value.teams} teams (seat s plays for team s % ${value.teams})` : " · free for all"}
          </p>
        </div>
        <div className="space-y-2">
          {toggles.map(([key, label, sub]) => {
            const on = value[key];
            return (
              <button
                type="button"
                key={key}
                role="switch"
                aria-checked={on}
                onClick={() => onChange({ [key]: !on })}
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
          })}
        </div>
      </motion.div>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

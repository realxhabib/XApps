import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { BackendError, type Backend, type RoomTransport } from "../backend";
import { OFFICIAL_APPS, getOfficialApp } from "../catalog";
import type {
  AppCategory,
  AppManifest,
  AppStatus,
  CreateChallengeInput,
  Json,
  LeaderRow,
  Match,
  PlayableMode,
  Profile,
  RegisterAppInput,
  Scoring,
  SubmitInput,
} from "../types";
import { getBrowserSupabase } from "./client";
import { createSupabaseRoom } from "./room";

interface ProfileRow {
  id: string;
  handle: string;
  name: string;
  avatar_url: string | null;
  bio: string;
  xp: number;
  wins: number;
  losses: number;
  draws: number;
  streak: number;
  best_streak: number;
  created_at: string;
  is_bot: boolean;
}

interface AppRow {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  category: AppCategory;
  icon: string;
  accent_from: string;
  accent_to: string;
  url: string;
  modes: PlayableMode[];
  min_players: number;
  max_players: number;
  scoring: Scoring;
  votes_to_win: number;
  duration_label: string;
  how_to: string[];
  tags: string[];
  official: boolean;
  developer_id: string | null;
  status: AppStatus;
  play_count: number;
  created_at: string;
  developer?: { handle: string; name: string } | null;
}

const APP_COLUMNS = "*, developer:profiles!apps_developer_id_fkey(handle, name)";

function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    handle: row.handle,
    name: row.name || row.handle,
    avatarUrl: row.avatar_url,
    bio: row.bio,
    xp: row.xp,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    streak: row.streak,
    bestStreak: row.best_streak,
    createdAt: row.created_at,
    isBot: row.is_bot,
  };
}

function toApp(row: AppRow): AppManifest {
  const official = row.official ? getOfficialApp(row.slug) : undefined;
  if (official) return { ...official, playCount: row.play_count };
  return {
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    description: row.description,
    category: row.category,
    icon: row.icon,
    accent: [row.accent_from, row.accent_to],
    url: row.url,
    modes: row.modes,
    players: { min: row.min_players, max: row.max_players },
    scoring: row.scoring,
    votesToWin: row.votes_to_win,
    durationLabel: row.duration_label || "Community",
    howTo: row.how_to,
    official: row.official,
    developer: {
      id: row.developer_id,
      handle: row.developer?.handle ?? "community",
      name: row.developer?.name ?? "Community developer",
    },
    status: row.status,
    playCount: row.play_count,
    createdAt: row.created_at,
    tags: row.tags,
  };
}

function fail(error: PostgrestError | Error | null | undefined, fallback = "Something went wrong"): never {
  const code = (error as PostgrestError | undefined)?.code;
  // PostgREST can't find our tables/functions: the migration hasn't been applied.
  if (code === "PGRST205" || code === "PGRST202" || code === "42P01" || code === "42883") {
    throw new BackendError(
      "Supabase is connected, but the XApps database schema isn't installed yet. Run the SQL in supabase/migrations.",
      "setup_required",
    );
  }
  const message = error?.message || fallback;
  const kind: BackendError["code"] =
    code === "28000"
      ? "unauthenticated"
      : code === "P0002"
        ? "not_found"
        : code === "42501"
          ? "forbidden"
          : code === "22023" || code === "23514"
            ? "invalid"
            : code === "55000" || code === "23505" || code === "54000"
              ? "conflict"
              : "internal";
  throw new BackendError(message, kind);
}

type XProvider = "x" | "twitter";

/**
 * Supabase has two separate X providers: "X / Twitter (OAuth 2.0)" (`x`) and the
 * legacy "Twitter" one (`twitter`, OAuth 1.0a). Use whichever is switched on,
 * preferring NEXT_PUBLIC_SUPABASE_X_PROVIDER, so either dashboard setup works.
 */
async function resolveXProvider(): Promise<XProvider> {
  const preferred = env.xProvider;
  let external: Partial<Record<string, boolean>> | undefined;
  try {
    const res = await fetch(`${env.supabaseUrl}/auth/v1/settings`, { headers: { apikey: env.supabaseKey } });
    if (res.ok) external = ((await res.json()) as { external?: Record<string, boolean> }).external;
  } catch {
    // Offline or blocked: let Supabase report the problem on the redirect.
  }
  if (!external) return preferred;
  const order: XProvider[] = preferred === "twitter" ? ["twitter", "x"] : ["x", "twitter"];
  const enabled = order.find((p) => external[p]);
  if (enabled) return enabled;
  if ("x" in external || "twitter" in external) {
    throw new BackendError(
      "Sign in with X is switched off in Supabase. Turn on X / Twitter (OAuth 2.0) under Authentication → Sign In / Providers.",
      "setup_required",
    );
  }
  return preferred;
}

/** The production backend: X sign-in, Postgres + RLS, Realtime rooms. */
export class SupabaseBackend implements Backend {
  readonly kind = "supabase" as const;
  private client: SupabaseClient | null;

  constructor(client?: SupabaseClient) {
    // Created lazily so constructing the backend during SSR never touches Supabase.
    this.client = client ?? null;
  }

  private get sb(): SupabaseClient {
    this.client ??= getBrowserSupabase();
    return this.client;
  }

  /* ---------------------------------------------------------------- */
  /* Session                                                          */
  /* ---------------------------------------------------------------- */

  private async userId(): Promise<string | null> {
    const { data } = await this.sb.auth.getSession();
    return data.session?.user.id ?? null;
  }

  private async requireUserId(): Promise<string> {
    const id = await this.userId();
    if (!id) throw new BackendError("Sign in to play", "unauthenticated");
    return id;
  }

  async getViewer(): Promise<Profile | null> {
    const id = await this.userId();
    if (!id) return null;
    const { data, error } = await this.sb.from("profiles").select("*").eq("id", id).maybeSingle<ProfileRow>();
    if (error) fail(error);
    return data ? toProfile(data) : null;
  }

  onViewerChange(handler: (viewer: Profile | null) => void): () => void {
    const { data } = this.sb.auth.onAuthStateChange((event) => {
      if (event === "TOKEN_REFRESHED") return;
      // Defer: calling Supabase inside the callback can deadlock the auth lock.
      setTimeout(() => {
        void this.getViewer().then(handler, () => handler(null));
      }, 0);
    });
    return () => data.subscription.unsubscribe();
  }

  async signInWithX(next = "/"): Promise<void> {
    const provider = await resolveXProvider();
    // Always come back to the address sign-in started on: the PKCE verifier cookie lives there.
    const { error } = await this.sb.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (error) fail(error);
  }

  async signOut(): Promise<void> {
    const { error } = await this.sb.auth.signOut();
    if (error) fail(error);
  }

  /* ---------------------------------------------------------------- */
  /* Catalog                                                          */
  /* ---------------------------------------------------------------- */

  async listApps(): Promise<AppManifest[]> {
    const { data, error } = await this.sb.from("apps").select(APP_COLUMNS).order("created_at");
    if (error) fail(error);
    const rows = (data ?? []) as AppRow[];
    const bySlug = new Map(rows.map((r) => [r.slug, r]));
    // Keep the official order from the catalog, then community apps.
    const official = OFFICIAL_APPS.map((app) => {
      const row = bySlug.get(app.slug);
      return { ...app, playCount: row?.play_count ?? 0 };
    });
    const community = rows.filter((r) => !getOfficialApp(r.slug)).map(toApp);
    return [...official, ...community];
  }

  async getApp(slug: string): Promise<AppManifest | null> {
    const { data, error } = await this.sb.from("apps").select(APP_COLUMNS).eq("slug", slug).maybeSingle<AppRow>();
    if (error) fail(error);
    if (!data) return getOfficialApp(slug) ?? null;
    return toApp(data);
  }

  async registerApp(input: RegisterAppInput): Promise<AppManifest> {
    await this.requireUserId();
    const { data, error } = await this.sb
      .from("apps")
      .insert({
        slug: input.slug,
        name: input.name,
        tagline: input.tagline,
        description: input.description,
        category: input.category,
        icon: input.icon,
        accent_from: input.accent[0],
        accent_to: input.accent[1],
        url: input.url,
        modes: input.modes,
        scoring: input.scoring,
        how_to: input.howTo,
      })
      .select(APP_COLUMNS)
      .single<AppRow>();
    if (error) {
      if (error.code === "23505") throw new BackendError("That slug is taken", "conflict");
      fail(error);
    }
    return toApp(data);
  }

  async listMyApps(): Promise<AppManifest[]> {
    const id = await this.userId();
    if (!id) return [];
    const { data, error } = await this.sb.from("apps").select(APP_COLUMNS).eq("developer_id", id).order("created_at", { ascending: false });
    if (error) fail(error);
    return ((data ?? []) as AppRow[]).map(toApp);
  }

  /* ---------------------------------------------------------------- */
  /* People                                                           */
  /* ---------------------------------------------------------------- */

  async getProfile(handle: string): Promise<Profile | null> {
    const clean = handle.replace(/^@/, "").toLowerCase();
    const { data, error } = await this.sb.from("profiles").select("*").eq("handle", clean).maybeSingle<ProfileRow>();
    if (error) fail(error);
    return data ? toProfile(data) : null;
  }

  async searchProfiles(query: string): Promise<Profile[]> {
    const q = query.replace(/^@/, "").toLowerCase().replace(/[^a-z0-9_ ]/g, "").trim();
    const me = await this.userId();
    let request = this.sb.from("profiles").select("*").eq("is_bot", false).order("xp", { ascending: false }).limit(8);
    if (q) request = request.or(`handle.ilike.%${q}%,name.ilike.%${q}%`);
    if (me) request = request.neq("id", me);
    const { data, error } = await request;
    if (error) fail(error);
    return ((data ?? []) as ProfileRow[]).map(toProfile);
  }

  async leaderboard(appSlug?: string): Promise<LeaderRow[]> {
    const { data, error } = await this.sb.rpc("leaderboard", { p_app: appSlug ?? null });
    if (error) fail(error);
    return (data ?? []) as LeaderRow[];
  }

  /* ---------------------------------------------------------------- */
  /* Matches                                                          */
  /* ---------------------------------------------------------------- */

  private async rpcId(fn: string, args: Record<string, unknown>): Promise<Match> {
    const { data, error } = await this.sb.rpc(fn, args);
    if (error) fail(error);
    const match = await this.getMatch(data as string);
    if (!match) throw new BackendError("Match not found", "not_found");
    return match;
  }

  private async rpcThenGet(fn: string, matchId: string, args: Record<string, unknown> = {}): Promise<Match> {
    const { error } = await this.sb.rpc(fn, { p_match: matchId, ...args });
    if (error) fail(error);
    const match = await this.getMatch(matchId);
    if (!match) throw new BackendError("Match not found", "not_found");
    return match;
  }

  createChallenge(input: CreateChallengeInput): Promise<Match> {
    return this.rpcId("create_challenge", {
      p_app: input.appSlug,
      p_mode: input.mode,
      p_opponent: input.opponentHandle ?? null,
    });
  }

  quickMatch(appSlug: string): Promise<Match> {
    return this.rpcId("quick_match", { p_app: appSlug });
  }

  startPractice(appSlug: string): Promise<Match> {
    return this.rpcId("start_practice", { p_app: appSlug });
  }

  joinMatch(matchId: string): Promise<Match> {
    return this.rpcThenGet("join_match", matchId);
  }

  declineMatch(matchId: string): Promise<Match> {
    return this.rpcThenGet("decline_match", matchId);
  }

  cancelMatch(matchId: string): Promise<Match> {
    return this.rpcThenGet("cancel_match", matchId);
  }

  async getMatch(matchId: string): Promise<Match | null> {
    const { data, error } = await this.sb.rpc("get_match", { p_match: matchId });
    if (error) {
      if (error.code === "22P02") return null; // not a uuid
      fail(error);
    }
    return (data as Match | null) ?? null;
  }

  markStarted(matchId: string): Promise<Match> {
    return this.rpcThenGet("mark_started", matchId);
  }

  async heartbeat(matchId: string): Promise<void> {
    await this.sb.rpc("heartbeat", { p_match: matchId });
  }

  claimForfeit(matchId: string): Promise<Match> {
    return this.rpcThenGet("claim_forfeit", matchId);
  }

  forfeit(matchId: string): Promise<Match> {
    return this.rpcThenGet("forfeit_match", matchId);
  }

  submit(matchId: string, input: SubmitInput): Promise<Match> {
    return this.rpcThenGet("submit_entry", matchId, {
      p_player: input.playerId ?? null,
      p_score: typeof input.score === "number" ? input.score : null,
      p_data: input.data ?? null,
      p_display: input.display ?? null,
    });
  }

  vote(matchId: string, choiceUserId: string): Promise<Match> {
    return this.rpcThenGet("cast_vote", matchId, { p_choice: choiceUserId });
  }

  private async list(fn: string, args: Record<string, unknown> = {}): Promise<Match[]> {
    const { data, error } = await this.sb.rpc(fn, args);
    if (error) fail(error);
    return (data ?? []) as Match[];
  }

  async listMyMatches(): Promise<Match[]> {
    if (!(await this.userId())) return [];
    return this.list("list_my_matches");
  }

  listVotingMatches(): Promise<Match[]> {
    return this.list("list_voting_matches");
  }

  listRecentActivity(): Promise<Match[]> {
    return this.list("list_recent_activity");
  }

  listUserMatches(userId: string): Promise<Match[]> {
    return this.list("list_user_matches", { p_user: userId });
  }

  /* ---------------------------------------------------------------- */
  /* Realtime                                                         */
  /* ---------------------------------------------------------------- */

  watchMatch(matchId: string, handler: (match: Match) => void): () => void {
    let alive = true;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (pending) return;
      // Coalesce bursts (a settle touches several rows at once).
      pending = setTimeout(async () => {
        pending = null;
        const match = await this.getMatch(matchId).catch(() => null);
        if (alive && match) handler(match);
      }, 120);
    };
    refresh();
    const channel = this.sb
      .channel(`watch-match:${matchId}:${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "matches", filter: `id=eq.${matchId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "match_players", filter: `match_id=eq.${matchId}` }, refresh)
      .subscribe();
    // Safety net for missed events (sleeping laptops, flaky networks).
    const interval = setInterval(refresh, 15_000);
    return () => {
      alive = false;
      clearInterval(interval);
      if (pending) clearTimeout(pending);
      void this.sb.removeChannel(channel);
    };
  }

  watchInbox(handler: () => void): () => void {
    let channel: ReturnType<SupabaseClient["channel"]> | null = null;
    let alive = true;
    void this.userId().then((id) => {
      if (!id || !alive) return;
      channel = this.sb
        .channel(`inbox:${id}:${Math.random().toString(36).slice(2, 8)}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "match_players", filter: `user_id=eq.${id}` }, () =>
          handler(),
        )
        .subscribe();
    });
    const interval = setInterval(handler, 20_000);
    return () => {
      alive = false;
      clearInterval(interval);
      if (channel) void this.sb.removeChannel(channel);
    };
  }

  openRoom(matchId: string, viewerId: string): RoomTransport {
    return createSupabaseRoom(this.sb, matchId, viewerId);
  }

  /* ---------------------------------------------------------------- */
  /* Storage                                                          */
  /* ---------------------------------------------------------------- */

  async storageGet(appSlug: string, key: string): Promise<Json | null> {
    const id = await this.requireUserId();
    const { data, error } = await this.sb
      .from("app_storage")
      .select("value")
      .match({ app_slug: appSlug, user_id: id, key })
      .maybeSingle<{ value: Json }>();
    if (error) fail(error);
    return data?.value ?? null;
  }

  async storageSet(appSlug: string, key: string, value: Json): Promise<void> {
    const id = await this.requireUserId();
    const { error } = await this.sb
      .from("app_storage")
      .upsert({ app_slug: appSlug, user_id: id, key, value, updated_at: new Date().toISOString() });
    if (error) fail(error);
  }
}

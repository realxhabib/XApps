import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { BackendError, type Backend, type RoomTransport } from "../backend";
import { OFFICIAL_APPS, getOfficialApp, manifestShapeError, withManifestDefaults } from "../catalog";
import type {
  AppAuthority,
  AppManifest,
  AppServerConfig,
  CreateChallengeInput,
  Json,
  LeaderRow,
  Match,
  Profile,
  RegisterAppInput,
  SubmitInput,
  WebhookDelivery,
} from "../types";
import { getBrowserSupabase } from "./client";
import {
  appInsert,
  challengeArgs,
  normalizeMatch,
  toApp,
  toBackendError,
  toSecret,
  toServerConfig,
  toWebhookDeliveries,
  type AppRow,
} from "./mapping";
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

function fail(error: PostgrestError | Error | null | undefined, fallback = "Something went wrong"): never {
  throw toBackendError(error as { code?: string; message?: string } | null | undefined, fallback);
}

/**
 * Supabase has two separate X providers: "X / Twitter (OAuth 2.0)" (`x`) and the
 * legacy "Twitter" one (`twitter`, OAuth 1.0a). NEXT_PUBLIC_SUPABASE_X_PROVIDER
 * picks one explicitly. Otherwise use `twitter` when the auth settings say it's on
 * (those settings don't report `x` at all), and `x` in every other case.
 */
async function resolveXProvider(): Promise<"x" | "twitter"> {
  if (env.xProvider) return env.xProvider;
  try {
    const res = await fetch(`${env.supabaseUrl}/auth/v1/settings`, { headers: { apikey: env.supabaseKey } });
    if (res.ok) {
      const { external } = (await res.json()) as { external?: Record<string, boolean> };
      if (external?.twitter && external.x !== true) return "twitter";
    }
  } catch {
    // Offline or blocked: fall through to the OAuth 2.0 provider.
  }
  return "x";
}

/** The production backend: X sign-in, Postgres + RLS, Realtime rooms. */
export class SupabaseBackend implements Backend {
  readonly kind = "supabase" as const;
  readonly serverApi = true;
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
      return withManifestDefaults({ ...app, playCount: row?.play_count ?? 0 });
    });
    const community = rows.filter((r) => !getOfficialApp(r.slug)).map(toApp);
    return [...official, ...community];
  }

  async getApp(slug: string): Promise<AppManifest | null> {
    const { data, error } = await this.sb.from("apps").select(APP_COLUMNS).eq("slug", slug).maybeSingle<AppRow>();
    if (error) fail(error);
    if (!data) {
      const official = getOfficialApp(slug);
      return official ? withManifestDefaults(official) : null;
    }
    return toApp(data);
  }

  async registerApp(input: RegisterAppInput): Promise<AppManifest> {
    await this.requireUserId();
    const shapeError = manifestShapeError(input);
    if (shapeError) throw new BackendError(shapeError, "invalid");
    const { data, error } = await this.sb
      .from("apps")
      .insert(appInsert(input))
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
  /* App server settings (owner only)                                 */
  /* ---------------------------------------------------------------- */

  private async ownerRpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
    await this.requireUserId();
    const { data, error } = await this.sb.rpc(fn, args);
    if (error) fail(error);
    return data;
  }

  private async secretRpc(fn: string, args: Record<string, unknown>): Promise<string> {
    const secret = toSecret(await this.ownerRpc(fn, args));
    if (!secret) throw new BackendError("The server didn't return a secret", "internal");
    return secret;
  }

  async getAppServerConfig(appSlug: string): Promise<AppServerConfig> {
    return toServerConfig(await this.ownerRpc("get_app_server_config", { p_app: appSlug }));
  }

  rotateAppSecret(appSlug: string): Promise<string> {
    return this.secretRpc("rotate_app_secret", { p_app: appSlug });
  }

  async setAppWebhook(appSlug: string, url: string | null): Promise<string | null> {
    const clean = url?.trim() || null;
    return toSecret(await this.ownerRpc("set_app_webhook", { p_app: appSlug, p_url: clean }));
  }

  rotateWebhookSecret(appSlug: string): Promise<string> {
    return this.secretRpc("rotate_webhook_secret", { p_app: appSlug });
  }

  async setAppAuthority(appSlug: string, authority: AppAuthority): Promise<void> {
    await this.ownerRpc("set_app_authority", { p_app: appSlug, p_authority: authority });
  }

  async listWebhookDeliveries(appSlug: string): Promise<WebhookDelivery[]> {
    return toWebhookDeliveries(await this.ownerRpc("list_webhook_deliveries", { p_app: appSlug, p_limit: 50 }));
  }

  async sendTestWebhook(appSlug: string): Promise<void> {
    await this.ownerRpc("send_test_webhook", { p_app: appSlug });
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
    return this.rpcId("create_challenge", challengeArgs(input));
  }

  async uploadImage(image: Blob): Promise<string> {
    const { data: auth } = await this.sb.auth.getUser();
    if (!auth.user) throw new BackendError("Sign in to upload", "unauthenticated");
    const ext = image.type === "image/png" ? "png" : image.type === "image/webp" ? "webp" : image.type === "image/gif" ? "gif" : "jpg";
    const path = `${auth.user.id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await this.sb.storage.from("meme-drops").upload(path, image, {
      contentType: image.type || "image/jpeg",
      cacheControl: "31536000",
      upsert: false,
    });
    if (error) {
      if (/bucket not found/i.test(error.message)) {
        throw new BackendError("Image uploads need the latest database migration (supabase/migrations).", "setup_required");
      }
      throw new BackendError(error.message, "internal");
    }
    return this.sb.storage.from("meme-drops").getPublicUrl(path).data.publicUrl;
  }

  quickMatch(appSlug: string): Promise<Match> {
    return this.rpcId("quick_match", { p_app: appSlug });
  }

  startPractice(appSlug: string, players?: number): Promise<Match> {
    // Only name p_players when asked, so a v1 schema still resolves the call.
    return this.rpcId("start_practice", players === undefined ? { p_app: appSlug } : { p_app: appSlug, p_players: players });
  }

  startMatch(matchId: string): Promise<Match> {
    return this.rpcThenGet("start_match", matchId);
  }

  spectate(matchId: string): Promise<Match> {
    return this.rpcThenGet("spectate_match", matchId);
  }

  inviteToMatch(matchId: string, handles: string[]): Promise<Match> {
    return this.rpcThenGet("invite_to_match", matchId, {
      p_handles: handles.map((h) => h.replace(/^@/, "").trim().toLowerCase()).filter(Boolean),
    });
  }

  async updateState(matchId: string, state: Json, expectedVersion: number): Promise<{ version: number; match: Match }> {
    const { data, error } = await this.sb.rpc("update_match_state", {
      p_match: matchId,
      p_state: state,
      p_expected_version: expectedVersion,
    });
    if (error) fail(error);
    const version = typeof data === "number" ? data : Number(data);
    const match = await this.getMatch(matchId);
    if (!match) throw new BackendError("Match not found", "not_found");
    return { version: Number.isFinite(version) ? version : match.stateVersion, match };
  }

  endTurn(matchId: string, next?: string | null): Promise<Match> {
    return this.rpcThenGet("end_turn", matchId, { p_next: next ?? null });
  }

  setRound(matchId: string, round: number): Promise<Match> {
    return this.rpcThenGet("set_round", matchId, { p_round: round });
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
    return data ? normalizeMatch(data as Match) : null;
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
    return ((data ?? []) as Match[]).map(normalizeMatch);
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

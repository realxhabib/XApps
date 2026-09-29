"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { getOfficialApp } from "./catalog";
import { useBackend, useViewer } from "./client";
import { isYourTurn, needsAttention } from "./match-utils";
import type {
  AppAuthority,
  AppLogEntry,
  AppServerConfig,
  AppVersion,
  CreateChallengeInput,
  DeveloperNotice,
  Json,
  LogLevel,
  Match,
  Profile,
  RegisterAppInput,
  VersionManifest,
  WebhookDelivery,
} from "./types";

export function useApps() {
  const backend = useBackend();
  return useQuery({ queryKey: ["apps"], queryFn: () => backend.listApps(), staleTime: 60_000 });
}

export function useApp(slug: string, enabled = true) {
  const backend = useBackend();
  const official = getOfficialApp(slug);
  return useQuery({
    queryKey: ["app", slug],
    queryFn: () => backend.getApp(slug),
    enabled: enabled && !!slug,
    // Official apps render instantly (and morph in with their view transition).
    placeholderData: official,
    staleTime: 60_000,
  });
}

export function useMyApps() {
  const backend = useBackend();
  const { viewer } = useViewer();
  return useQuery({
    queryKey: ["my-apps", viewer?.id],
    queryFn: () => backend.listMyApps(),
    enabled: !!viewer,
  });
}

export function useProfile(handle: string) {
  const backend = useBackend();
  return useQuery({ queryKey: ["profile", handle.toLowerCase()], queryFn: () => backend.getProfile(handle) });
}

export function useSearchProfiles(query: string, enabled = true) {
  const backend = useBackend();
  return useQuery({
    queryKey: ["search-profiles", query],
    queryFn: () => backend.searchProfiles(query),
    enabled,
    staleTime: 5_000,
  });
}

export function useLeaderboard(appSlug?: string) {
  const backend = useBackend();
  return useQuery({ queryKey: ["leaderboard", appSlug ?? "all"], queryFn: () => backend.leaderboard(appSlug) });
}

/** One stat's leaderboard for an app (Stage 3). */
export function useStatLeaderboard(appSlug: string, key: string | null) {
  const backend = useBackend();
  return useQuery({
    queryKey: ["stat-leaderboard", appSlug, key],
    queryFn: () => backend.statLeaderboard(appSlug, key as string),
    enabled: !!appSlug && !!key,
    staleTime: 15_000,
  });
}

/** A player's stats across apps. */
export function useUserStats(userId: string | undefined) {
  const backend = useBackend();
  return useQuery({
    queryKey: ["user-stats", userId],
    queryFn: () => backend.userStats(userId as string),
    enabled: !!userId,
  });
}

/** A player's unlocked achievements across apps (newest first). */
export function useUserAchievements(userId: string | undefined) {
  const backend = useBackend();
  return useQuery({
    queryKey: ["user-achievements", userId],
    queryFn: () => backend.userAchievements(userId as string),
    enabled: !!userId,
  });
}

/** After stats or achievements change: refresh boards, profiles and XP. */
export function invalidateProgress(queryClient: QueryClient, appSlug: string): void {
  void queryClient.invalidateQueries({ queryKey: ["stat-leaderboard", appSlug] });
  void queryClient.invalidateQueries({ queryKey: ["user-stats"] });
  void queryClient.invalidateQueries({ queryKey: ["user-achievements"] });
  void queryClient.invalidateQueries({ queryKey: ["profile"] });
}

/** A single match, kept live through the backend's realtime feed. */
export function useMatch(matchId: string) {
  const backend = useBackend();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["match", matchId], queryFn: () => backend.getMatch(matchId) });
  useEffect(
    () => backend.watchMatch(matchId, (match) => queryClient.setQueryData(["match", matchId], match)),
    [backend, matchId, queryClient],
  );
  return query;
}

export function useMyMatches() {
  const backend = useBackend();
  const queryClient = useQueryClient();
  const { viewer } = useViewer();
  const query = useQuery({
    queryKey: ["my-matches", viewer?.id],
    queryFn: () => backend.listMyMatches(),
    enabled: !!viewer,
  });
  useEffect(() => {
    if (!viewer) return;
    return backend.watchInbox(() => void queryClient.invalidateQueries({ queryKey: ["my-matches"] }));
  }, [backend, queryClient, viewer]);
  return query;
}

/**
 * The viewer's inbox, split for badges: `yourTurn` are turn-based async matches
 * waiting on the viewer's move, `attention` everything that needs them (invites,
 * their turn, async matches they haven't played yet).
 */
export function useInbox() {
  const query = useMyMatches();
  const { viewer } = useViewer();
  const viewerId = viewer?.id;
  const data = query.data;
  const split = useMemo(() => {
    const matches = data ?? [];
    return {
      yourTurn: matches.filter((m) => isYourTurn(m, viewerId)),
      attention: matches.filter((m) => needsAttention(m, viewerId)),
    };
  }, [data, viewerId]);
  return { ...query, ...split };
}

/** Turn-based async matches waiting on the viewer ("Your turn in …"). */
export function useYourTurnMatches(): Match[] {
  return useInbox().yourTurn;
}

export function useVotingMatches() {
  const backend = useBackend();
  const { viewer } = useViewer();
  return useQuery({ queryKey: ["voting", viewer?.id], queryFn: () => backend.listVotingMatches() });
}

export function useActivity() {
  const backend = useBackend();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["activity"], queryFn: () => backend.listRecentActivity(), staleTime: 20_000 });
  useEffect(() => {
    if (backend.kind !== "demo") return;
    // In demo mode the "server" is local, so we can stream every change.
    return backend.watchInbox(() => void queryClient.invalidateQueries({ queryKey: ["activity"] }));
  }, [backend, queryClient]);
  return query;
}

export function useUserMatches(userId: string | undefined) {
  const backend = useBackend();
  return useQuery({
    queryKey: ["user-matches", userId],
    queryFn: () => backend.listUserMatches(userId as string),
    enabled: !!userId,
  });
}

/* ---------------------------------------------------------------------- */
/* Mutations                                                              */
/* ---------------------------------------------------------------------- */

function refreshMatchLists(queryClient: QueryClient, match?: Match) {
  if (match) queryClient.setQueryData(["match", match.id], match);
  void queryClient.invalidateQueries({ queryKey: ["my-matches"] });
  void queryClient.invalidateQueries({ queryKey: ["activity"] });
}

export function useCreateChallenge() {
  const backend = useBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateChallengeInput) => backend.createChallenge(input),
    onSuccess: (match) => refreshMatchLists(queryClient, match),
  });
}

export type QuickMatchInput = string | { appSlug: string; versionId?: string | null };

/** `mutate(appSlug)`, or `mutate({ appSlug, versionId })` for a test-build lobby (owner/testers). */
export function useQuickMatch() {
  const backend = useBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: QuickMatchInput) =>
      typeof input === "string" ? backend.quickMatch(input) : backend.quickMatch(input.appSlug, input.versionId),
    onSuccess: (match) => refreshMatchLists(queryClient, match),
  });
}

export type PracticeInput = string | { appSlug: string; players?: number; versionId?: string | null };

/**
 * Practice against bots: `mutate(appSlug)`, `mutate({ appSlug, players })` for a
 * bigger table, or `mutate({ appSlug, versionId })` to try a test build.
 */
export function usePractice() {
  const backend = useBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PracticeInput) =>
      typeof input === "string" ? backend.startPractice(input) : backend.startPractice(input.appSlug, input.players, input.versionId),
    onSuccess: (match) => refreshMatchLists(queryClient, match),
  });
}

export type MatchAction = "join" | "decline" | "cancel" | "forfeit" | "claim" | "start" | "spectate";

export function useMatchAction() {
  const backend = useBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ action, matchId }: { action: MatchAction; matchId: string }) => {
      switch (action) {
        case "start":
          return backend.startMatch(matchId);
        case "spectate":
          return backend.spectate(matchId);
        case "join":
          return backend.joinMatch(matchId);
        case "decline":
          return backend.declineMatch(matchId);
        case "cancel":
          return backend.cancelMatch(matchId);
        case "forfeit":
          return backend.forfeit(matchId);
        case "claim":
          return backend.claimForfeit(matchId);
      }
    },
    onSuccess: (match) => refreshMatchLists(queryClient, match),
  });
}

/** The creator starts a lobby early once the minimum is seated. */
export function useStartMatch() {
  const backend = useBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (matchId: string) => backend.startMatch(matchId),
    onSuccess: (match) => refreshMatchLists(queryClient, match),
  });
}

/** Invite more people (by handle) into a match's free seats. */
export function useInviteToMatch() {
  const backend = useBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ matchId, handles }: { matchId: string; handles: string[] }) => backend.inviteToMatch(matchId, handles),
    onSuccess: (match) => refreshMatchLists(queryClient, match),
  });
}

/** Watch a match without a seat. */
export function useSpectate() {
  const backend = useBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (matchId: string) => backend.spectate(matchId),
    onSuccess: (match) => queryClient.setQueryData(["match", match.id], match),
  });
}

/**
 * Compare-and-set the shared match state. Rejects with BackendError code
 * "conflict" when someone else wrote first — re-read and retry.
 */
export function useUpdateState() {
  const backend = useBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ matchId, state, expectedVersion }: { matchId: string; state: Json; expectedVersion: number }) =>
      backend.updateState(matchId, state, expectedVersion),
    onSuccess: ({ match }) => queryClient.setQueryData(["match", match.id], match),
  });
}

/** Pass the turn (default: the next seated player still in the match). */
export function useEndTurn() {
  const backend = useBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ matchId, next }: { matchId: string; next?: string | null }) => backend.endTurn(matchId, next),
    onSuccess: (match) => refreshMatchLists(queryClient, match),
  });
}

export function useSetRound() {
  const backend = useBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ matchId, round }: { matchId: string; round: number }) => backend.setRound(matchId, round),
    onSuccess: (match) => queryClient.setQueryData(["match", match.id], match),
  });
}

export function useVote() {
  const backend = useBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ matchId, choiceUserId }: { matchId: string; choiceUserId: string }) =>
      backend.vote(matchId, choiceUserId),
    onSuccess: (match) => {
      queryClient.setQueryData(["match", match.id], match);
      void queryClient.invalidateQueries({ queryKey: ["viewer"] });
      void queryClient.invalidateQueries({ queryKey: ["activity"] });
    },
  });
}

export function useRegisterApp() {
  const backend = useBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterAppInput) => backend.registerApp(input),
    onSuccess: (app) => {
      void queryClient.invalidateQueries({ queryKey: ["apps"] });
      void queryClient.invalidateQueries({ queryKey: ["my-apps"] });
      // Registering creates version 1.0.0 (and demo mode publishes it).
      void queryClient.invalidateQueries({ queryKey: versionsKey(app.slug) });
      void queryClient.invalidateQueries({ queryKey: ["review-queue"] });
    },
  });
}

/* ---------------------------------------------------------------------- */
/* App server settings (owner only, Stage 2)                              */
/* ---------------------------------------------------------------------- */

const serverConfigKey = (slug: string) => ["app-server", slug] as const;
const deliveriesKey = (slug: string) => ["webhook-deliveries", slug] as const;

/** The owner's view of an app's secret, webhook and authority. Pass `enabled: false` for non-owners. */
export function useAppServerConfig(slug: string, enabled = true) {
  const backend = useBackend();
  const { viewer } = useViewer();
  return useQuery({
    queryKey: [...serverConfigKey(slug), viewer?.id],
    queryFn: () => backend.getAppServerConfig(slug),
    enabled: enabled && !!slug && !!viewer,
    retry: false,
  });
}

/** Recent webhook deliveries, polled every 10 s while the page is visible. */
export function useWebhookDeliveries(slug: string, enabled = true) {
  const backend = useBackend();
  const { viewer } = useViewer();
  return useQuery({
    queryKey: [...deliveriesKey(slug), viewer?.id],
    queryFn: () => backend.listWebhookDeliveries(slug),
    enabled: enabled && !!slug && !!viewer,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
}

function refreshServerSettings(queryClient: QueryClient, slug: string, appChanged = false) {
  void queryClient.invalidateQueries({ queryKey: serverConfigKey(slug) });
  if (appChanged) {
    void queryClient.invalidateQueries({ queryKey: ["app", slug] });
    void queryClient.invalidateQueries({ queryKey: ["apps"] });
    void queryClient.invalidateQueries({ queryKey: ["my-apps"] });
  }
}

/** Creates or rotates the app secret; resolves to the new secret (shown once). */
export function useRotateAppSecret(slug: string) {
  const backend = useBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => backend.rotateAppSecret(slug),
    onSuccess: () => refreshServerSettings(queryClient, slug),
  });
}

/** Sets (or clears, with null) the webhook URL; resolves to a new signing secret when the URL changed. */
export function useSetAppWebhook(slug: string) {
  const backend = useBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (url: string | null) => backend.setAppWebhook(slug, url),
    onSuccess: () => {
      refreshServerSettings(queryClient, slug);
      void queryClient.invalidateQueries({ queryKey: deliveriesKey(slug) });
    },
  });
}

export function useRotateWebhookSecret(slug: string) {
  const backend = useBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => backend.rotateWebhookSecret(slug),
    onSuccess: () => refreshServerSettings(queryClient, slug),
  });
}

export function useSetAppAuthority(slug: string) {
  const backend = useBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (authority: AppAuthority) => backend.setAppAuthority(slug, authority),
    // Flip the switch right away; roll back if the server says no.
    onMutate: async (authority) => {
      await queryClient.cancelQueries({ queryKey: serverConfigKey(slug) });
      const previous = queryClient.getQueriesData<AppServerConfig>({ queryKey: serverConfigKey(slug) });
      queryClient.setQueriesData<AppServerConfig>({ queryKey: serverConfigKey(slug) }, (old) => (old ? { ...old, authority } : old));
      return { previous };
    },
    onError: (_error, _authority, context) => {
      for (const [key, data] of context?.previous ?? []) queryClient.setQueryData(key, data);
    },
    onSettled: () => refreshServerSettings(queryClient, slug, true),
  });
}

/** Enqueues a `ping`, showing it in the log straight away. */
export function useSendTestWebhook(slug: string) {
  const backend = useBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => backend.sendTestWebhook(slug),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: deliveriesKey(slug) });
      const previous = queryClient.getQueriesData<WebhookDelivery[]>({ queryKey: deliveriesKey(slug) });
      const optimistic: WebhookDelivery = {
        id: `optimistic-${Date.now()}`,
        event: "ping",
        matchId: null,
        createdAt: new Date().toISOString(),
        attempts: 0,
        deliveredAt: null,
        lastStatus: null,
        lastError: null,
      };
      queryClient.setQueriesData<WebhookDelivery[]>({ queryKey: deliveriesKey(slug) }, (old) => [optimistic, ...(old ?? [])]);
      return { previous };
    },
    onError: (_error, _vars, context) => {
      for (const [key, data] of context?.previous ?? []) queryClient.setQueryData(key, data);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: deliveriesKey(slug) }),
  });
}

/* ---------------------------------------------------------------------- */
/* Shipping (Stage 4): versions, testers, review, analytics, logs          */
/* ---------------------------------------------------------------------- */

const versionsKey = (slug: string) => ["app-versions", slug] as const;
const testersKey = (slug: string) => ["app-testers", slug] as const;
const reviewQueueKey = ["review-queue"] as const;
const analyticsKey = (slug: string) => ["app-analytics", slug] as const;
const logsKey = (slug: string) => ["app-logs", slug] as const;
const noticesKey = ["developer-notices"] as const;

/** True when the signed-in viewer can review app versions. */
export function useIsAdmin(): boolean {
  const { viewer } = useViewer();
  return !!viewer?.isAdmin;
}

/** The app's versions, newest first (owner only; pass `enabled: false` for others). */
export function useAppVersions(slug: string, enabled = true) {
  const backend = useBackend();
  const { viewer } = useViewer();
  return useQuery({
    queryKey: [...versionsKey(slug), viewer?.id],
    queryFn: () => backend.listAppVersions(slug),
    enabled: enabled && !!slug && !!viewer,
    retry: false,
  });
}

/** After a version changes: its list, the queue, and (when it went live) the listing. */
function refreshVersions(queryClient: QueryClient, slug: string, version?: AppVersion, listingChanged = false) {
  if (version) {
    queryClient.setQueriesData<AppVersion[]>({ queryKey: versionsKey(slug) }, (old) =>
      old ? (old.some((v) => v.id === version.id) ? old.map((v) => (v.id === version.id ? version : v)) : [version, ...old]) : old,
    );
  }
  void queryClient.invalidateQueries({ queryKey: versionsKey(slug) });
  void queryClient.invalidateQueries({ queryKey: reviewQueueKey });
  if (listingChanged) {
    void queryClient.invalidateQueries({ queryKey: ["app", slug] });
    void queryClient.invalidateQueries({ queryKey: ["apps"] });
    void queryClient.invalidateQueries({ queryKey: ["my-apps"] });
  }
}

export interface CreateVersionInput {
  version: string;
  url: string;
  manifest: VersionManifest;
  notes?: string;
}

/** Creates a draft version. */
export function useCreateVersion(slug: string) {
  const backend = useBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateVersionInput) => backend.createAppVersion(slug, input),
    onSuccess: (version) => refreshVersions(queryClient, slug, version),
  });
}

export interface UpdateVersionInput {
  versionId: string;
  url?: string;
  manifest?: VersionManifest;
  notes?: string;
}

/** Edits a draft or rejected version. */
export function useUpdateVersion(slug: string) {
  const backend = useBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ versionId, ...input }: UpdateVersionInput) => backend.updateAppVersion(versionId, input),
    onSuccess: (version) => refreshVersions(queryClient, slug, version),
  });
}

/** Sends a draft (or rejected) version to review: `mutate(versionId)`. */
export function useSubmitVersion(slug: string) {
  const backend = useBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (versionId: string) => backend.submitAppVersion(versionId),
    onSuccess: (version) => refreshVersions(queryClient, slug, version),
  });
}

/** Pulls a version out of review (back to draft): `mutate(versionId)`. */
export function useWithdrawVersion(slug: string) {
  const backend = useBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (versionId: string) => backend.withdrawAppVersion(versionId),
    onSuccess: (version) => refreshVersions(queryClient, slug, version),
  });
}

/** Publishes an approved version (the previous one retires): `mutate(versionId)`. */
export function usePublishVersion(slug: string) {
  const backend = useBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (versionId: string) => backend.publishAppVersion(versionId),
    onSuccess: (version) => refreshVersions(queryClient, slug, version, true),
  });
}

/** People who may play the app's test builds (owner only). */
export function useAppTesters(slug: string, enabled = true) {
  const backend = useBackend();
  const { viewer } = useViewer();
  return useQuery({
    queryKey: [...testersKey(slug), viewer?.id],
    queryFn: () => backend.listAppTesters(slug),
    enabled: enabled && !!slug && !!viewer,
    retry: false,
  });
}

function setTesters(queryClient: QueryClient, slug: string, testers: Profile[]) {
  queryClient.setQueriesData<Profile[]>({ queryKey: testersKey(slug) }, () => testers);
  void queryClient.invalidateQueries({ queryKey: testersKey(slug) });
}

/** `mutate(handle)`; resolves to the new tester list. */
export function useAddTester(slug: string) {
  const backend = useBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (handle: string) => backend.addAppTester(slug, handle),
    onSuccess: (testers) => setTesters(queryClient, slug, testers),
  });
}

/** `mutate(userId)`; resolves to the new tester list. */
export function useRemoveTester(slug: string) {
  const backend = useBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => backend.removeAppTester(slug, userId),
    onSuccess: (testers) => setTesters(queryClient, slug, testers),
  });
}

/** Versions waiting for review, oldest first (admins only; disabled for everyone else). */
export function useReviewQueue() {
  const backend = useBackend();
  const { viewer } = useViewer();
  return useQuery({
    queryKey: [...reviewQueueKey, viewer?.id],
    queryFn: () => backend.listReviewQueue(),
    enabled: !!viewer?.isAdmin,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
}

export interface ReviewVersionInput {
  versionId: string;
  decision: "approve" | "reject";
  notes: string;
}

/** Approve or reject a version in review (admins). */
export function useReviewVersion() {
  const backend = useBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ versionId, decision, notes }: ReviewVersionInput) => backend.reviewAppVersion(versionId, decision, notes),
    onSuccess: (version) => {
      refreshVersions(queryClient, version.appSlug, version, true);
      void queryClient.invalidateQueries({ queryKey: noticesKey });
    },
  });
}

/** Owner/admin analytics for the last `days` days (default 30). */
export function useAppAnalytics(slug: string, days = 30, enabled = true) {
  const backend = useBackend();
  const { viewer } = useViewer();
  return useQuery({
    queryKey: [...analyticsKey(slug), days, viewer?.id],
    queryFn: () => backend.appAnalytics(slug, days),
    enabled: enabled && !!slug && !!viewer,
    staleTime: 60_000,
    retry: false,
  });
}

export interface AppLogsFilter {
  level?: LogLevel;
  matchId?: string;
  before?: string;
  limit?: number;
  /** Poll every 5 s while the page is visible (default true). */
  live?: boolean;
}

/** The app's logs, newest first (owner only). Live tail: polled every 5 s while the tab is visible. */
export function useAppLogs(slug: string, filter: AppLogsFilter = {}, enabled = true) {
  const backend = useBackend();
  const { viewer } = useViewer();
  const { live = true, level, matchId, before, limit } = filter;
  return useQuery<AppLogEntry[]>({
    queryKey: [...logsKey(slug), { level, matchId, before, limit }, viewer?.id],
    queryFn: () => backend.listAppLogs(slug, { level, matchId: matchId || undefined, before, limit }),
    enabled: enabled && !!slug && !!viewer,
    refetchInterval: live && !before ? 5_000 : false,
    refetchIntervalInBackground: false,
    retry: false,
  });
}

/**
 * Review decisions for the viewer's apps, newest first. Refreshed every 30 s
 * (demo mode: on every local change). `unread` counts the ones not read yet.
 */
export function useMyNotices() {
  const backend = useBackend();
  const queryClient = useQueryClient();
  const { viewer } = useViewer();
  const query = useQuery<DeveloperNotice[]>({
    queryKey: [...noticesKey, viewer?.id],
    queryFn: () => backend.listMyNotices(),
    enabled: !!viewer,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
  useEffect(() => {
    if (!viewer || backend.kind !== "demo") return;
    return backend.watchInbox(() => void queryClient.invalidateQueries({ queryKey: noticesKey }));
  }, [backend, queryClient, viewer]);
  const unread = useMemo(() => (query.data ?? []).filter((n) => !n.readAt).length, [query.data]);
  return { ...query, unread };
}

/** `mutate()` marks every unread notice read; `mutate(ids)` just those. */
export function useMarkNoticesRead() {
  const backend = useBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids?: string[]) => backend.markNoticesRead(ids),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: noticesKey });
      const previous = queryClient.getQueriesData<DeveloperNotice[]>({ queryKey: noticesKey });
      const at = new Date().toISOString();
      queryClient.setQueriesData<DeveloperNotice[]>({ queryKey: noticesKey }, (old) =>
        old?.map((n) => (!n.readAt && (!ids || ids.includes(n.id)) ? { ...n, readAt: at } : n)),
      );
      return { previous };
    },
    onError: (_error, _ids, context) => {
      for (const [key, data] of context?.previous ?? []) queryClient.setQueryData(key, data);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: noticesKey }),
  });
}

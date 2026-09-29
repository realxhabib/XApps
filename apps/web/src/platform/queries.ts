"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { getOfficialApp } from "./catalog";
import { useBackend, useViewer } from "./client";
import { isYourTurn, needsAttention } from "./match-utils";
import type { AppAuthority, AppServerConfig, CreateChallengeInput, Json, Match, RegisterAppInput, WebhookDelivery } from "./types";

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

export function useQuickMatch() {
  const backend = useBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (appSlug: string) => backend.quickMatch(appSlug),
    onSuccess: (match) => refreshMatchLists(queryClient, match),
  });
}

export type PracticeInput = string | { appSlug: string; players?: number };

/** Practice against bots: `mutate(appSlug)` or `mutate({ appSlug, players })` for a bigger table. */
export function usePractice() {
  const backend = useBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PracticeInput) =>
      typeof input === "string" ? backend.startPractice(input) : backend.startPractice(input.appSlug, input.players),
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["apps"] });
      void queryClient.invalidateQueries({ queryKey: ["my-apps"] });
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

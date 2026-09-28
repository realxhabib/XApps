"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getOfficialApp } from "./catalog";
import { useBackend, useViewer } from "./client";
import type { CreateChallengeInput, Match, RegisterAppInput } from "./types";

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

export function usePractice() {
  const backend = useBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (appSlug: string) => backend.startPractice(appSlug),
    onSuccess: (match) => refreshMatchLists(queryClient, match),
  });
}

export function useMatchAction() {
  const backend = useBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ action, matchId }: { action: "join" | "decline" | "cancel" | "forfeit" | "claim"; matchId: string }) => {
      switch (action) {
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

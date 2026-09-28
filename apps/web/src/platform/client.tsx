"use client";

import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { isSupabaseConfigured } from "@/lib/env";
import type { Backend } from "./backend";
import { DemoBackend } from "./demo/demo-backend";
import { SupabaseBackend } from "./supabase/supabase-backend";
import type { Profile } from "./types";

const BackendContext = createContext<Backend | null>(null);

const FORCE_DEMO_KEY = "xapps:force-demo";

/** Demo mode can be forced (e.g. while the Supabase schema isn't installed yet). */
export function isDemoForced(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(FORCE_DEMO_KEY) === "1";
  } catch {
    return false;
  }
}

export function setDemoForced(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(FORCE_DEMO_KEY, "1");
    else window.localStorage.removeItem(FORCE_DEMO_KEY);
  } catch {
    // ignore
  }
  window.location.reload();
}

let singleton: Backend | null = null;
function getBackend(): Backend {
  if (!singleton) {
    singleton = isSupabaseConfigured && !isDemoForced() ? new SupabaseBackend() : new DemoBackend();
  }
  return singleton;
}

export function PlatformProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 10_000, refetchOnWindowFocus: false, retry: 1 },
        },
      }),
  );
  const [backend] = useState(getBackend);
  return (
    <BackendContext.Provider value={backend}>
      <QueryClientProvider client={queryClient}>
        <ViewerSync />
        {children}
      </QueryClientProvider>
    </BackendContext.Provider>
  );
}

export function useBackend(): Backend {
  const backend = useContext(BackendContext);
  if (!backend) throw new Error("useBackend() needs <PlatformProvider>");
  return backend;
}

/** Keeps the cached viewer in sync with auth changes (sign in/out, XP updates). */
function ViewerSync() {
  const backend = useBackend();
  const queryClient = useQueryClient();
  useEffect(
    () =>
      backend.onViewerChange((viewer) => {
        const previous = queryClient.getQueryData<Profile | null>(["viewer"]);
        queryClient.setQueryData(["viewer"], viewer);
        if (previous?.id !== viewer?.id) {
          // Someone else is signed in now: drop everything personal.
          void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "viewer" });
        }
      }),
    [backend, queryClient],
  );
  return null;
}

export interface ViewerState {
  viewer: Profile | null;
  /** True until we know whether someone is signed in. */
  loading: boolean;
}

export function useViewer(): ViewerState {
  const backend = useBackend();
  const { data, isPending } = useQuery({
    queryKey: ["viewer"],
    queryFn: () => backend.getViewer(),
    staleTime: 30_000,
  });
  return { viewer: data ?? null, loading: isPending };
}

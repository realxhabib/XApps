/**
 * React bindings for @xapps/sdk.
 *
 * ```tsx
 * <XAppsProvider fallback={<Spinner />}>
 *   <Game />
 * </XAppsProvider>
 *
 * function Game() {
 *   const xapps = useXApps();
 *   const started = useMatchStarted();
 *   useRoomEvent("move", (move, from) => apply(move, from));
 * }
 * ```
 */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { connect, type ConnectOptions, type XAppsClient } from "./client";
import type { Json, LaunchContext, MatchResult, RoomMessage } from "./protocol";

const ClientContext = createContext<XAppsClient | null>(null);

export interface XAppsProviderProps {
  children: ReactNode;
  /** Rendered while connecting to the host. */
  fallback?: ReactNode;
  /** Rendered if the host never answers. */
  errorFallback?: (error: Error) => ReactNode;
  options?: ConnectOptions;
}

export function XAppsProvider({ children, fallback = null, errorFallback, options }: XAppsProviderProps) {
  const [client, setClient] = useState<XAppsClient | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const optionsRef = useRef(options);

  useEffect(() => {
    let alive = true;
    connect(optionsRef.current).then(
      (c) => alive && setClient(c),
      (e: unknown) => alive && setError(e instanceof Error ? e : new Error(String(e))),
    );
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <>{errorFallback ? errorFallback(error) : null}</>;
  if (!client) return <>{fallback}</>;
  return <ClientContext.Provider value={client}>{children}</ClientContext.Provider>;
}

/** The connected client. Must be used under `<XAppsProvider>`. */
export function useXApps(): XAppsClient {
  const client = useContext(ClientContext);
  if (!client) throw new Error("useXApps() must be used inside <XAppsProvider>");
  return client;
}

/** Keeps the latest handler without re-subscribing on every render. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

/** Subscribe to a room event for the lifetime of the component. */
export function useRoomEvent<P extends Json = Json>(
  type: string,
  handler: (payload: P, from: string, message: RoomMessage<P>) => void,
): void {
  const client = useXApps();
  const latest = useLatest(handler);
  useEffect(() => client.room.on<P>(type, (p, from, m) => latest.current(p, from, m)), [client, type, latest]);
}

/** Ids of the players currently connected to the room. */
export function usePresence(): string[] {
  const client = useXApps();
  const [online, setOnline] = useState<string[]>(() => client.room.online());
  useEffect(() => client.room.onPresence(setOnline), [client]);
  return online;
}

/** `true` once the host fires `match.start`. */
export function useMatchStarted(): boolean {
  const client = useXApps();
  return useSyncExternalStore(
    (notify) => client.on("match.start", notify),
    () => client.hasStarted,
    () => false,
  );
}

/** Final result, or `null` while the match is still being decided. */
export function useMatchResult(): MatchResult | null {
  const client = useXApps();
  return useSyncExternalStore(
    (notify) => client.on("match.end", notify),
    () => client.finalResult,
    () => null,
  );
}

/** The live match object (players, statuses, scores…). */
export function useMatch(): LaunchContext["match"] {
  const client = useXApps();
  const [, force] = useState(0);
  useEffect(() => client.onUpdate(() => force((n) => n + 1)), [client]);
  return client.match;
}

/** Emoji reactions fired from the host HUD. */
export function useReactions(handler: (reaction: { from: string; emoji: string }) => void): void {
  const client = useXApps();
  const latest = useLatest(handler);
  useEffect(() => client.onReaction((r) => latest.current(r)), [client, latest]);
}

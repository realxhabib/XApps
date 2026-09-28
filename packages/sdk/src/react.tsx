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
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  connect,
  type ConnectOptions,
  type StateSnapshot,
  type StateUpdateOptions,
  type StateUpdater,
  type XAppsClient,
} from "./client";
import type { Json, LaunchContext, LaunchPurpose, MatchResult, PlayerInfo, PlayerRole, RoomMessage } from "./protocol";

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

/* ---------------------------------------------------------------------- */
/* v2: shared state, turns, rounds, setup, players                        */
/* ---------------------------------------------------------------------- */

export interface MatchStateHook<T extends Json> {
  /** Latest shared state (null before the first write). Treat as read-only. */
  state: T | null;
  version: number;
  /** Compare-and-set (default expected version: the latest seen). */
  set: (value: T, expectedVersion?: number) => Promise<StateSnapshot<T>>;
  /** Read-modify-write with automatic retry on `conflict`. */
  update: (fn: StateUpdater<T>, options?: StateUpdateOptions) => Promise<StateSnapshot<T>>;
}

/** Shared, persistent match state; re-renders on every change. */
export function useMatchState<T extends Json = Json>(): MatchStateHook<T> {
  const client = useXApps();
  const subscribe = useCallback((notify: () => void) => client.state.onChange(notify), [client]);
  const state = useSyncExternalStore(subscribe, () => client.state.current, () => client.state.current);
  const version = useSyncExternalStore(subscribe, () => client.state.version, () => client.state.version);
  return useMemo(
    () => ({
      state: state as T | null,
      version,
      set: (value: T, expectedVersion?: number) => client.state.set<T>(value, expectedVersion),
      update: (fn: StateUpdater<T>, options?: StateUpdateOptions) => client.state.update<T>(fn, options),
    }),
    [client, state, version],
  );
}

export interface TurnHook {
  /** Player id whose turn it is, or null. */
  turn: string | null;
  isMine: boolean;
  /** ISO deadline in async matches, else null. */
  deadline: string | null;
  end: (next?: string | null) => Promise<null>;
}

/** Whose turn it is; re-renders when the turn passes. */
export function useTurn(): TurnHook {
  const client = useXApps();
  const subscribe = useCallback((notify: () => void) => client.onTurn(notify), [client]);
  const turn = useSyncExternalStore(subscribe, () => client.turn.current, () => client.turn.current);
  const deadline = useSyncExternalStore(subscribe, () => client.turn.deadline, () => client.turn.deadline);
  return useMemo(
    () => ({
      turn,
      isMine: turn !== null && turn === client.user.id,
      deadline,
      end: (next?: string | null) => client.turn.end(next),
    }),
    [client, turn, deadline],
  );
}

/** The round counter shown in the host HUD. */
export function useRound(): { round: number; set: (round: number) => Promise<null> } {
  const client = useXApps();
  const subscribe = useCallback((notify: () => void) => client.onRound(notify), [client]);
  const round = useSyncExternalStore(subscribe, () => client.round.current, () => client.round.current);
  return useMemo(() => ({ round, set: (n: number) => client.round.set(n) }), [client, round]);
}

export interface SetupHook {
  purpose: LaunchPurpose;
  /** True when the host opened the app to set up a challenge. */
  isSetup: boolean;
  /** Current/default settings the host passed in (prefill your form with these). */
  settings: { [key: string]: Json };
  submit: (settings: { [key: string]: Json }, summary?: string) => Promise<null>;
  cancel: () => Promise<null>;
}

/** Challenge setup (apps that declare `setup: true`). */
export function useSetup(): SetupHook {
  const client = useXApps();
  return useMemo(
    () => ({
      purpose: client.purpose,
      isSetup: client.purpose === "setup",
      settings: client.match.settings,
      submit: (settings: { [key: string]: Json }, summary?: string) => client.setup.submit(settings, summary),
      cancel: () => client.setup.cancel(),
    }),
    [client],
  );
}

export interface PlayersHook {
  /** Seated players by seat. */
  players: PlayerInfo[];
  /** Every other seated player. */
  opponents: PlayerInfo[];
  /** Other players on your team (team play). */
  teammates: PlayerInfo[];
  me: PlayerInfo;
  role: PlayerRole;
  isSpectator: boolean;
}

/** The table: players, opponents, teammates, you and your role. Re-renders on match updates. */
export function usePlayers(): PlayersHook {
  const client = useXApps();
  const subscribe = useCallback((notify: () => void) => client.onUpdate(notify), [client]);
  const players = useSyncExternalStore(subscribe, () => client.players, () => client.players);
  const me = useSyncExternalStore(subscribe, () => client.me, () => client.me);
  const role = useSyncExternalStore(subscribe, () => client.role, () => client.role);
  return useMemo(
    () => ({
      players,
      opponents: client.opponents,
      teammates: client.teammates,
      me,
      role,
      isSpectator: role === "spectator",
    }),
    // opponents/teammates are derived together with players/me in the client.
    [client, players, me, role],
  );
}

import {
  LIMITS,
  PROTOCOL_VERSION,
  SDK_VERSION,
  XAppsError,
  byteLength,
  type EventMessage,
  type HapticStyle,
  type HostEvent,
  type HostEventData,
  type HostToApp,
  type Json,
  type LaunchContext,
  type LaunchPurpose,
  type MatchResult,
  type PlayerInfo,
  type PlayerRole,
  type RequestMethod,
  type RequestParams,
  type RequestResult,
  type RoomMessage,
  type Submission,
  type SubmitResult,
  type ToastTone,
} from "./protocol";
import { createRandom, randomId, type Random } from "./random";
import { createWindowTransport, type AppTransport } from "./transport";
import { createMockHost, type MockHostOptions } from "./mock-host";
import { accessProblem, cloneJson, isPlainObject, jsonProblem } from "./rules";

export interface ConnectOptions {
  /** How long to wait for the host to answer. Default: 8 s. */
  timeoutMs?: number;
  /** Only trust these host origins (recommended in production), e.g. `["https://xapps.gg"]`. */
  hostOrigins?: string[];
  /**
   * What to do when the page is opened directly instead of inside XApps.
   * By default a local mock host starts so you can build without the marketplace.
   * Pass `false` to throw instead.
   */
  mock?: boolean | MockHostOptions;
  /** Override the window (tests, custom embeds). */
  window?: Window;
  /** Provide your own transport (tests, custom embeds). */
  transport?: AppTransport;
}

type Handler<T> = (value: T) => void;
type Unsubscribe = () => void;
type Match = LaunchContext["match"];

/** The shared match state at some version. */
export interface StateSnapshot<T extends Json = Json> {
  state: T | null;
  version: number;
}

/** A change to the shared match state. `by` is the writer's player id (null: the host/server). */
export interface StateChange<T extends Json = Json> extends StateSnapshot<T> {
  by: string | null;
}

export interface StateUpdateOptions {
  /** How many times to re-read and retry after a `conflict`. Default 5. */
  retries?: number;
}

/**
 * Read-modify-write callback for `state.update`. Receives a private copy of
 * the latest state (mutate it or build a new value) and returns the next
 * state, or `undefined` to leave the state unchanged. May run several times.
 */
export type StateUpdater<T extends Json = Json> = (draft: T | null) => T | undefined | Promise<T | undefined>;

export interface TurnInfo {
  /** Player id whose turn it is, or null when the app doesn't use turns. */
  turn: string | null;
  /** When the turn times out (ISO), for async turn-based matches. */
  deadline: string | null;
}

export interface StateApi {
  /** Latest known state (kept fresh from host events). Treat as read-only. */
  readonly current: Json | null;
  /** Version of `current`. 0 until the first write. */
  readonly version: number;
  /** Fetch the state from the host. */
  get<T extends Json = Json>(): Promise<StateSnapshot<T>>;
  /**
   * Compare-and-set. Fails with code `conflict` if someone else wrote since
   * `expectedVersion` (default: the last version this client has seen).
   */
  set<T extends Json = Json>(value: T, expectedVersion?: number): Promise<StateSnapshot<T>>;
  /** Read-modify-write that re-reads and retries on `conflict`. */
  update<T extends Json = Json>(fn: StateUpdater<T>, options?: StateUpdateOptions): Promise<StateSnapshot<T>>;
  /** Called for every change, including your own writes (once per version). */
  onChange<T extends Json = Json>(handler: (state: T | null, change: StateChange<T>) => void): Unsubscribe;
}

export interface TurnApi {
  /** Player id whose turn it is, or null. */
  readonly current: string | null;
  /** True when it's the local player's turn. */
  readonly isMine: boolean;
  /** Turn deadline (ISO) in async matches, else null. */
  readonly deadline: string | null;
  /** Pass the turn: to `next`, or by default to the next seated player. */
  end(next?: string | null): Promise<null>;
}

export interface RoundApi {
  /** The round counter shown in the host HUD (starts at 0). */
  readonly current: number;
  /** Set the round counter. Never goes backwards. */
  set(round: number): Promise<null>;
}

export interface SetupApi {
  /** True when the host opened the app to set up a challenge. */
  readonly active: boolean;
  /**
   * Hand the challenge settings (≤ 4 KB JSON object) to the host. They become
   * `match.settings` of the match. `summary` (≤ 140 chars) is shown in the invite.
   */
  submit(settings: { [key: string]: Json }, summary?: string): Promise<null>;
  /** Close the setup screen without creating a challenge. */
  cancel(): Promise<null>;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * A connected app. Everything you need is on this object:
 *
 * ```ts
 * const xapps = await connect();
 * xapps.room.on("move", (move, from) => apply(move));
 * xapps.onStart(() => startClock());
 * await xapps.ready();
 * ```
 */
export class XAppsClient {
  /** Everything the host told us at launch. `match` stays up to date. */
  readonly context: LaunchContext;
  /** Seeded with `match.seed` — identical on every client in this match. */
  readonly random: Random;

  private readonly transport: AppTransport;
  private readonly unlisten: Unsubscribe;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Map<string, Set<Handler<never>>>();
  private nextId = 1;
  private startedAt: number | null = null;
  private result: MatchResult | null = null;
  private online: string[] = [];
  private destroyed = false;
  private sendBudget: number = LIMITS.roomMessagesPerSecond;
  private budgetRefilledAt = Date.now();
  private roster: Roster;

  /** @internal use `connect()` */
  constructor(transport: AppTransport, context: LaunchContext) {
    this.transport = transport;
    this.context = normalizeContext(context);
    this.roster = buildRoster(this.context);
    this.random = createRandom(this.context.match.seed);
    this.unlisten = transport.listen((message) => this.receive(message));
  }

  /* ---------------------------------------------------------------- */
  /* Identity & match                                                 */
  /* ---------------------------------------------------------------- */

  /** `match` to play, or `setup` to render your challenge setup screen (`setup.submit`). */
  get purpose(): LaunchPurpose {
    return this.context.purpose;
  }

  get user(): LaunchContext["user"] {
    return this.context.user;
  }

  get match(): Match {
    return this.context.match;
  }

  /** Seated players, ordered by seat (spectators are never listed). */
  get players(): PlayerInfo[] {
    return this.roster.players;
  }

  /** The local player. For spectators, a stand-in with `seat: -1` and `role: "spectator"`. */
  get me(): PlayerInfo {
    return this.roster.me;
  }

  /** Every other seated player (teammates included in team play). */
  get opponents(): PlayerInfo[] {
    return this.roster.opponents;
  }

  /** Convenience for 1v1 apps: the first opponent. */
  get opponent(): PlayerInfo | undefined {
    return this.roster.opponents[0];
  }

  /** Other players on your team (empty in free for all or when spectating). */
  get teammates(): PlayerInfo[] {
    return this.roster.teammates;
  }

  /** `player` (seated) or `spectator` (watch only). */
  get role(): PlayerRole {
    return this.context.match.role;
  }

  get isSpectator(): boolean {
    return this.context.match.role === "spectator";
  }

  /** True for the lowest-seated player — a handy tie-breaker for "who runs the referee logic". */
  get isHost(): boolean {
    if (this.isSpectator || this.players.length === 0) return false;
    return this.me.seat === Math.min(...this.players.map((p) => p.seat));
  }

  player(id: string): PlayerInfo | undefined {
    return this.players.find((p) => p.id === id);
  }

  isBot(id: string): boolean {
    return this.player(id)?.isBot ?? false;
  }

  get hasStarted(): boolean {
    return this.startedAt !== null;
  }

  get finalResult(): MatchResult | null {
    return this.result;
  }

  /* ---------------------------------------------------------------- */
  /* Lifecycle                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Tell the host your app has rendered. The host plays its versus intro once
   * every player is ready and then fires `onStart`.
   */
  async ready(): Promise<void> {
    const { startedAt } = await this.request("ready", {});
    // Setup screens never start a match.
    if (this.purpose === "match" && startedAt !== null && this.startedAt === null) {
      this.handleStart(startedAt);
    }
  }

  /** Called once when the match starts (immediately if it already has). */
  onStart(handler: (at: number) => void): Unsubscribe {
    if (this.startedAt !== null) {
      const at = this.startedAt;
      queueMicrotask(() => handler(at));
      return () => {};
    }
    return this.on("match.start", ({ at }) => handler(at));
  }

  /** Called when the final result is in (immediately if it already is). */
  onEnd(handler: (result: MatchResult) => void): Unsubscribe {
    if (this.result) {
      const result = this.result;
      queueMicrotask(() => handler(result));
      return () => {};
    }
    return this.on("match.end", ({ result }) => handler(result));
  }

  /** Called whenever the match changes (someone submitted, votes arrived…). */
  onUpdate(handler: (match: LaunchContext["match"]) => void): Unsubscribe {
    return this.on("match.update", ({ match }) => handler(match));
  }

  /** Emoji reactions players fire from the host HUD. */
  onReaction(handler: (reaction: { from: string; emoji: string }) => void): Unsubscribe {
    return this.on("reaction", handler);
  }

  /** Called when the turn passes (see `turn`). */
  onTurn(handler: (turn: TurnInfo) => void): Unsubscribe {
    return this.on("turn.change", ({ turn, deadline }) => handler({ turn, deadline }));
  }

  /** Called when the round counter changes (see `round`). */
  onRound(handler: (round: number) => void): Unsubscribe {
    return this.on("round.change", ({ round }) => handler(round));
  }

  /** Submit your final result. Resolves with `final` once the winner is known. */
  submit(submission: Submission): Promise<SubmitResult> {
    const denied = this.deny("match.submit");
    if (denied) return denied;
    return this.request("match.submit", sanitizeSubmission(submission));
  }

  /** Submit on behalf of a bot you are driving (practice & sandbox only). */
  submitFor(playerId: string, submission: Submission): Promise<SubmitResult> {
    const denied = this.deny("match.submit");
    if (denied) return denied;
    return this.request("match.submit", { ...sanitizeSubmission(submission), playerId });
  }

  forfeit(): Promise<null> {
    return this.deny("match.forfeit") ?? this.request("match.forfeit", {});
  }

  /* ---------------------------------------------------------------- */
  /* Shared match state, turns & rounds                               */
  /* ---------------------------------------------------------------- */

  /**
   * One shared JSON document per match (≤ 64 KB), versioned. Every write is
   * compare-and-set, and every change reaches all players and spectators.
   *
   * ```ts
   * await xapps.state.update((s) => ({ ...s, board: play(s?.board, move) }));
   * xapps.state.onChange((s) => render(s));
   * ```
   */
  readonly state: StateApi = this.createStateApi();

  /** Whose move it is. `turn.end()` passes it on. */
  readonly turn: TurnApi = this.createTurnApi();

  /** App-controlled round counter shown in the host HUD. */
  readonly round: RoundApi = this.createRoundApi();

  /** Setup purpose: submit or cancel the challenge settings. */
  readonly setup: SetupApi = this.createSetupApi();

  /* ---------------------------------------------------------------- */
  /* Realtime room                                                    */
  /* ---------------------------------------------------------------- */

  readonly room = {
    /**
     * Broadcast to every other player. Keep payloads small (≤ 8 KB) and
     * frequent updates under ~30/s.
     */
    send: <P extends Json>(type: string, payload: P): Promise<null> => {
      const denied = this.deny("room.send");
      if (denied) return denied;
      if (!type || type.length > LIMITS.eventTypeLength) {
        return Promise.reject(new XAppsError("invalid_params", "room.send: invalid event type"));
      }
      if (byteLength(payload) > LIMITS.roomPayloadBytes) {
        return Promise.reject(new XAppsError("invalid_params", "room.send: payload too large"));
      }
      if (!this.takeSendBudget()) {
        return Promise.reject(new XAppsError("rate_limited", "room.send: slow down"));
      }
      return this.request("room.send", { type, payload });
    },
    /** Listen for one event type. `from` is the sender's player id. */
    on: <P extends Json = Json>(type: string, handler: (payload: P, from: string, message: RoomMessage<P>) => void): Unsubscribe =>
      this.on("room.message", (message) => {
        if (message.type === type) handler(message.payload as P, message.from, message as RoomMessage<P>);
      }),
    /** Listen for every room event. */
    onAny: (handler: (message: RoomMessage) => void): Unsubscribe => this.on("room.message", handler),
    /** Called with the ids of players currently connected. */
    onPresence: (handler: (online: string[]) => void): Unsubscribe => {
      if (this.online.length) {
        const online = this.online.slice();
        queueMicrotask(() => handler(online));
      }
      return this.on("room.presence", ({ online }) => handler(online));
    },
    /** Player ids currently connected (last known). */
    online: (): string[] => this.online.slice(),
  };

  /* ---------------------------------------------------------------- */
  /* Host UI                                                          */
  /* ---------------------------------------------------------------- */

  readonly ui = {
    toast: (message: string, tone: ToastTone = "info") =>
      this.request("ui.toast", { message: message.slice(0, LIMITS.toastLength), tone }),
    /** Confetti & fanfare, rendered by the host above your app. */
    celebrate: (intensity: "small" | "big" = "big") => this.request("ui.celebrate", { intensity }),
    haptic: (style: HapticStyle = "light") => this.request("ui.haptic", { style }),
    setStatus: (text: string | null) =>
      this.request("ui.status", { text: text === null ? null : text.slice(0, LIMITS.statusLength) }),
    setScores: (scores: { [playerId: string]: number | string }) => this.request("ui.scores", { scores }),
    setTurn: (playerId: string | null) => this.request("ui.turn", { playerId }),
  };

  readonly social = {
    /** Opens the X composer, pre-filled. The user always confirms the post. */
    share: (text: string, url?: string) =>
      this.request("social.share", { text: text.slice(0, LIMITS.shareTextLength), url }),
  };

  readonly storage = {
    get: <T extends Json = Json>(key: string): Promise<T | null> =>
      this.request("storage.get", { key }) as Promise<T | null>,
    set: (key: string, value: Json): Promise<null> => {
      if (byteLength(value) > LIMITS.storageValueBytes) {
        return Promise.reject(new XAppsError("invalid_params", "storage.set: value too large"));
      }
      return this.request("storage.set", { key, value });
    },
  };

  /* ---------------------------------------------------------------- */
  /* Plumbing                                                         */
  /* ---------------------------------------------------------------- */

  /** Low-level typed request. Prefer the helpers above. */
  request<M extends RequestMethod>(
    method: M,
    params: RequestParams<M>,
    options: { timeoutMs?: number } = {},
  ): Promise<RequestResult<M>> {
    if (this.destroyed) return Promise.reject(new XAppsError("not_connected", "client destroyed"));
    const id = this.nextId++;
    return new Promise<RequestResult<M>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new XAppsError("timeout", `${method} timed out`));
      }, options.timeoutMs ?? REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.transport.post({ xapps: PROTOCOL_VERSION, type: "request", id, method, params });
    });
  }

  /** Subscribe to a raw host event. */
  on<E extends HostEvent>(event: E, handler: Handler<HostEventData<E>>): Unsubscribe {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as Handler<never>);
    return () => set?.delete(handler as Handler<never>);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unlisten();
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new XAppsError("not_connected", "client destroyed"));
    }
    this.pending.clear();
    this.listeners.clear();
    if (singleton?.client === this) singleton = null;
  }

  /* ---------------------------------------------------------------- */
  /* Namespaces                                                       */
  /* ---------------------------------------------------------------- */

  private createStateApi(): StateApi {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const client = this;
    const snapshot = <T extends Json>(): StateSnapshot<T> => ({
      state: cloneJson(client.context.match.state) as T | null,
      version: client.context.match.stateVersion,
    });

    const api: StateApi = {
      get current() {
        return client.context.match.state;
      },
      get version() {
        return client.context.match.stateVersion;
      },
      async get<T extends Json = Json>(): Promise<StateSnapshot<T>> {
        const denied = client.deny("state.get");
        if (denied) return denied;
        const { state, version } = await client.request("state.get", {});
        client.applyState(state, version, null, true);
        return { state: state as T | null, version };
      },
      async set<T extends Json = Json>(value: T, expectedVersion?: number): Promise<StateSnapshot<T>> {
        const denied = client.deny("state.set");
        if (denied) return denied;
        const expected = expectedVersion ?? client.context.match.stateVersion;
        if (!Number.isInteger(expected) || expected < 0) {
          throw new XAppsError("invalid_params", "state.set: expectedVersion must be a non-negative integer");
        }
        const problem = jsonProblem(value, "state");
        if (problem) throw new XAppsError("invalid_params", `state.set: ${problem}`);
        if (byteLength(value) > LIMITS.matchStateBytes) {
          throw new XAppsError("invalid_params", `state.set: state is larger than ${LIMITS.matchStateBytes} bytes`);
        }
        const copy = cloneJson(value);
        const { version } = await client.request("state.set", { state: copy, expectedVersion: expected });
        client.applyState(copy, version, client.me.id);
        return { state: cloneJson(copy), version };
      },
      async update<T extends Json = Json>(
        fn: StateUpdater<T>,
        options: StateUpdateOptions = {},
      ): Promise<StateSnapshot<T>> {
        const retries = Math.max(0, options.retries ?? 5);
        for (let attempt = 0; ; attempt++) {
          const base = snapshot<T>();
          const next = await fn(base.state);
          if (next === undefined) return snapshot<T>();
          try {
            return await api.set<T>(next, base.version);
          } catch (error) {
            if (!(error instanceof XAppsError) || error.code !== "conflict" || attempt >= retries) throw error;
            await api.get();
            if (attempt > 0) await new Promise((r) => setTimeout(r, Math.random() * 25 * attempt));
          }
        }
      },
      onChange<T extends Json = Json>(handler: (state: T | null, change: StateChange<T>) => void): Unsubscribe {
        return client.on("state.change", (change) => handler(change.state as T | null, change as StateChange<T>));
      },
    };
    return api;
  }

  private createTurnApi(): TurnApi {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const client = this;
    return {
      get current() {
        return client.context.match.turn;
      },
      get isMine() {
        return client.context.match.turn !== null && client.context.match.turn === client.context.user.id;
      },
      get deadline() {
        return client.context.match.turnDeadline;
      },
      end(next?: string | null): Promise<null> {
        const denied = client.deny("turn.end");
        if (denied) return denied;
        if (next !== undefined && next !== null) {
          if (typeof next !== "string" || !client.players.some((p) => p.id === next)) {
            return Promise.reject(new XAppsError("invalid_params", "turn.end: next must be a seated player id"));
          }
        }
        return client.request("turn.end", next === undefined ? {} : { next });
      },
    };
  }

  private createRoundApi(): RoundApi {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const client = this;
    return {
      get current() {
        return client.context.match.round;
      },
      async set(round: number): Promise<null> {
        const denied = client.deny("round.set");
        if (denied) return denied;
        if (!Number.isSafeInteger(round) || round < 0) {
          throw new XAppsError("invalid_params", "round.set: round must be a non-negative integer");
        }
        if (round < client.context.match.round) {
          throw new XAppsError("invalid_params", "round.set: the round can't go backwards");
        }
        await client.request("round.set", { round });
        client.applyRound(round);
        return null;
      },
    };
  }

  private createSetupApi(): SetupApi {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const client = this;
    return {
      get active() {
        return client.context.purpose === "setup";
      },
      submit(settings: { [key: string]: Json }, summary?: string): Promise<null> {
        const denied = client.deny("setup.submit");
        if (denied) return denied;
        const problem = validateSetup(settings, summary);
        if (problem) return Promise.reject(new XAppsError("invalid_params", `setup.submit: ${problem}`));
        return client.request("setup.submit", summary === undefined ? { settings } : { settings, summary });
      },
      cancel(): Promise<null> {
        return client.deny("setup.cancel") ?? client.request("setup.cancel", {});
      },
    };
  }

  /** A rejected promise when the launch purpose / role doesn't allow `method` (mirrors the host). */
  private deny(method: RequestMethod): Promise<never> | null {
    const problem = accessProblem(method, this.context);
    return problem ? Promise.reject(new XAppsError("forbidden", problem)) : null;
  }

  /** Adopts a state if it's newer than ours; dispatches `state.change` once per version. */
  private applyState(state: Json | null, version: number, by: string | null, allowSame = false): void {
    const match = this.context.match;
    if (typeof version !== "number" || version < match.stateVersion) return;
    if (version === match.stateVersion) {
      // Same version, same document: only adopt (no event) when explicitly re-reading.
      if (allowSame) match.state = state;
      return;
    }
    match.state = state;
    match.stateVersion = version;
    this.dispatch("state.change", { state, version, by });
  }

  private applyTurn(turn: string | null, deadline: string | null): void {
    const match = this.context.match;
    if (match.turn === turn && match.turnDeadline === deadline) return;
    match.turn = turn;
    match.turnDeadline = deadline;
    this.dispatch("turn.change", { turn, deadline });
  }

  private applyRound(round: number): void {
    const match = this.context.match;
    if (typeof round !== "number" || round <= match.round) return; // monotonic
    match.round = round;
    this.dispatch("round.change", { round });
  }

  private receive(message: HostToApp): void {
    if (message.type === "response") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.ok) pending.resolve(message.result ?? null);
      else pending.reject(new XAppsError(message.error?.code ?? "internal", message.error?.message ?? "Host error"));
      return;
    }
    if (message.type === "event") {
      this.handleEvent(message);
    }
  }

  private handleEvent(message: EventMessage): void {
    switch (message.event) {
      case "match.start": {
        const { at } = message.data as HostEventData<"match.start">;
        if (this.startedAt !== null) return; // start fires once
        if (this.purpose === "setup") return; // setup screens never start a match
        this.handleStart(at);
        return;
      }
      case "match.end": {
        const { result } = message.data as HostEventData<"match.end">;
        if (this.result) return;
        this.result = result;
        break;
      }
      case "match.update": {
        const { match } = message.data as HostEventData<"match.update">;
        if (!match || typeof match !== "object") return;
        this.mergeMatch(match);
        return;
      }
      case "state.change": {
        const { state, version, by } = message.data as HostEventData<"state.change">;
        this.applyState(state ?? null, version, by ?? null);
        return;
      }
      case "turn.change": {
        const { turn, deadline } = message.data as HostEventData<"turn.change">;
        this.applyTurn(turn ?? null, deadline ?? null);
        return;
      }
      case "round.change": {
        this.applyRound((message.data as HostEventData<"round.change">).round);
        return;
      }
      case "room.presence": {
        this.online = (message.data as HostEventData<"room.presence">).online.slice();
        break;
      }
    }
    this.dispatch(message.event, message.data);
  }

  /**
   * Merges a `match.update` into the context. State, turn and round only move
   * forward through `applyState`/`applyTurn`/`applyRound`, so an update that
   * raced a newer `state.change` can't roll them back, and each change still
   * fires its own event.
   */
  private mergeMatch(incoming: Partial<Match>): void {
    const match = this.context.match;
    const kept = {
      state: match.state,
      stateVersion: match.stateVersion,
      turn: match.turn,
      turnDeadline: match.turnDeadline,
      round: match.round,
    };
    Object.assign(match, incoming, normalizeMatch({ ...match, ...incoming }, this.context.user.id, match), kept);
    this.roster = buildRoster(this.context);
    this.dispatch("match.update", { match });

    if (typeof incoming.stateVersion === "number") {
      this.applyState(incoming.state ?? null, incoming.stateVersion, null);
    }
    if (incoming.turn !== undefined || incoming.turnDeadline !== undefined) {
      this.applyTurn(
        incoming.turn !== undefined ? incoming.turn : match.turn,
        incoming.turnDeadline !== undefined ? incoming.turnDeadline : match.turnDeadline,
      );
    }
    if (typeof incoming.round === "number") this.applyRound(incoming.round);
  }

  private handleStart(at: number): void {
    this.startedAt = at;
    this.dispatch("match.start", { at });
  }

  private dispatch(event: string, data: unknown): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of Array.from(set)) {
      try {
        (handler as Handler<unknown>)(data);
      } catch (error) {
        console.error(`[xapps] ${event} handler threw`, error);
      }
    }
  }

  private takeSendBudget(): boolean {
    const now = Date.now();
    const elapsed = (now - this.budgetRefilledAt) / 1000;
    this.budgetRefilledAt = now;
    this.sendBudget = Math.min(
      LIMITS.roomMessagesPerSecond,
      this.sendBudget + elapsed * LIMITS.roomMessagesPerSecond,
    );
    if (this.sendBudget < 1) return false;
    this.sendBudget -= 1;
    return true;
  }
}

function sanitizeSubmission(submission: Submission): Submission {
  const out: Submission = {};
  if (submission.score !== undefined) {
    if (typeof submission.score !== "number" || !Number.isFinite(submission.score)) {
      throw new XAppsError("invalid_params", "submit: score must be a finite number");
    }
    out.score = submission.score;
  }
  if (submission.data !== undefined) out.data = submission.data;
  if (submission.display !== undefined) out.display = submission.display;
  if (byteLength(out) > LIMITS.submissionBytes) {
    throw new XAppsError("invalid_params", "submit: submission too large");
  }
  return out;
}

function validateSetup(settings: unknown, summary: unknown): string | null {
  if (!isPlainObject(settings)) return "settings must be an object";
  const problem = jsonProblem(settings, "settings");
  if (problem) return problem;
  if (byteLength(settings) > LIMITS.setupSettingsBytes) {
    return `settings are larger than ${LIMITS.setupSettingsBytes} bytes`;
  }
  if (summary !== undefined && (typeof summary !== "string" || summary.length > LIMITS.setupSummaryLength)) {
    return `summary must be a string of at most ${LIMITS.setupSummaryLength} characters`;
  }
  return null;
}

/* -------------------------------------------------------------------- */
/* Context normalization (v1 hosts omit the v2 fields)                  */
/* -------------------------------------------------------------------- */

interface Roster {
  players: PlayerInfo[];
  me: PlayerInfo;
  opponents: PlayerInfo[];
  teammates: PlayerInfo[];
}

function normalizePlayer(player: PlayerInfo, teams: number): PlayerInfo {
  const role: PlayerRole = player.role === "spectator" ? "spectator" : "player";
  const team =
    typeof player.team === "number"
      ? player.team
      : teams > 0 && role === "player" && typeof player.seat === "number" && player.seat >= 0
        ? player.seat % teams
        : null;
  return { ...player, team, role };
}

function normalizeMatch(raw: Partial<Match>, userId: string, base?: Match): Match {
  const teamsRaw = raw.teams ?? base?.teams;
  const teams = typeof teamsRaw === "number" && teamsRaw > 0 ? Math.floor(teamsRaw) : 0;
  const players = (Array.isArray(raw.players) ? raw.players : []).map((p) => normalizePlayer(p, teams));
  const seated = players.filter((p) => p.role === "player").length;
  const mine = players.find((p) => p.id === userId);
  const seat = typeof raw.seat === "number" ? raw.seat : (mine?.seat ?? -1);
  const role: PlayerRole =
    raw.role === "spectator" || raw.role === "player"
      ? raw.role
      : mine
        ? mine.role
        : seat < 0
          ? "spectator"
          : "player";
  const minPlayers = raw.minPlayers ?? base?.minPlayers ?? Math.max(2, seated);
  return {
    id: raw.id ?? base?.id ?? "unknown",
    mode: raw.mode ?? base?.mode ?? "sandbox",
    status: raw.status ?? base?.status ?? "active",
    scoring: raw.scoring ?? base?.scoring ?? "high",
    seed: raw.seed ?? base?.seed ?? "",
    players,
    seat: role === "spectator" ? -1 : seat,
    settings: raw.settings ?? base?.settings ?? {},
    minPlayers,
    maxPlayers: raw.maxPlayers ?? base?.maxPlayers ?? Math.max(minPlayers, seated),
    teams,
    role,
    state: raw.state ?? base?.state ?? null,
    stateVersion: raw.stateVersion ?? base?.stateVersion ?? 0,
    turn: raw.turn ?? base?.turn ?? null,
    turnDeadline: raw.turnDeadline ?? base?.turnDeadline ?? null,
    round: raw.round ?? base?.round ?? 0,
  };
}

/** Fills in v2 defaults so apps can rely on every field, whatever host version launched them. */
function normalizeContext(context: LaunchContext): LaunchContext {
  const purpose: LaunchPurpose = context.purpose === "setup" ? "setup" : "match";
  return {
    ...context,
    purpose,
    match: normalizeMatch((context.match ?? {}) as Partial<Match>, context.user.id),
  };
}

function buildRoster(context: LaunchContext): Roster {
  const { match, user } = context;
  const players = match.players.some((p) => p.role === "spectator")
    ? match.players.filter((p) => p.role !== "spectator")
    : match.players;
  const spectating = match.role === "spectator";
  const me: PlayerInfo = (!spectating &&
    (players.find((p) => p.id === user.id) ?? players.find((p) => p.seat === match.seat) ?? players[match.seat])) || {
    id: user.id,
    handle: user.handle,
    name: user.name,
    avatarUrl: user.avatarUrl,
    seat: -1,
    isBot: false,
    submitted: false,
    score: null,
    team: null,
    role: "spectator",
  };
  const opponents = players.filter((p) => p.id !== me.id);
  const teammates =
    !spectating && match.teams > 0 && me.team !== null ? opponents.filter((p) => p.team === me.team) : [];
  return { players, me, opponents, teammates };
}

/* -------------------------------------------------------------------- */
/* connect()                                                            */
/* -------------------------------------------------------------------- */

let singleton: { promise: Promise<XAppsClient>; client: XAppsClient | null } | null = null;

/**
 * Connect to the XApps host. Safe to call many times — every call returns the
 * same client.
 */
export function connect(options: ConnectOptions = {}): Promise<XAppsClient> {
  if (singleton) return singleton.promise;
  const entry: { promise: Promise<XAppsClient>; client: XAppsClient | null } = {
    promise: Promise.resolve(null as unknown as XAppsClient),
    client: null,
  };
  entry.promise = handshake(options).then(
    (client) => {
      entry.client = client;
      return client;
    },
    (error: unknown) => {
      if (singleton === entry) singleton = null;
      throw error;
    },
  );
  singleton = entry;
  return entry.promise;
}

/** For tests: forget the shared client. */
export function resetConnection(): void {
  singleton?.client?.destroy();
  singleton = null;
}

async function handshake(options: ConnectOptions): Promise<XAppsClient> {
  const win = options.window ?? (typeof window !== "undefined" ? window : undefined);
  let transport = options.transport;

  if (!transport) {
    if (!win) throw new XAppsError("not_connected", "connect() must run in a browser");
    const embedded = win.parent !== win;
    if (!embedded) {
      if (options.mock === false) {
        throw new XAppsError("not_connected", "Not running inside XApps (no parent window)");
      }
      const mock = createMockHost(typeof options.mock === "object" ? options.mock : {});
      transport = mock.transport;
    } else {
      transport = createWindowTransport(win, { hostOrigins: options.hostOrigins });
    }
  }

  const timeoutMs = options.timeoutMs ?? 8_000;
  const activeTransport = transport;

  return new Promise<XAppsClient>((resolve, reject) => {
    let settled = false;
    const session = randomId(10);
    const hello = () =>
      activeTransport.post({ xapps: PROTOCOL_VERSION, type: "hello", sdkVersion: SDK_VERSION, session });

    // The host might attach its listener after our first hello — keep knocking.
    const knock = setInterval(hello, 250);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearInterval(knock);
      stop();
      reject(new XAppsError("timeout", "The XApps host did not answer. Is the app running inside XApps?"));
    }, timeoutMs);

    const stop = activeTransport.listen((message, origin) => {
      if (settled || message.type !== "welcome") return;
      settled = true;
      clearInterval(knock);
      clearTimeout(timer);
      stop();
      activeTransport.pin?.(origin);
      resolve(new XAppsClient(activeTransport, message.context));
    });

    hello();
  });
}

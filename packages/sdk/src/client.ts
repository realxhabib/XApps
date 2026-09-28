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
  type MatchResult,
  type PlayerInfo,
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

  /** @internal use `connect()` */
  constructor(transport: AppTransport, context: LaunchContext) {
    this.transport = transport;
    this.context = context;
    this.random = createRandom(context.match.seed);
    this.unlisten = transport.listen((message) => this.receive(message));
  }

  /* ---------------------------------------------------------------- */
  /* Identity & match                                                 */
  /* ---------------------------------------------------------------- */

  get user(): LaunchContext["user"] {
    return this.context.user;
  }

  get match(): LaunchContext["match"] {
    return this.context.match;
  }

  get players(): PlayerInfo[] {
    return this.context.match.players;
  }

  /** The local player. */
  get me(): PlayerInfo {
    const me = this.players.find((p) => p.id === this.context.user.id);
    return me ?? (this.players[this.context.match.seat] as PlayerInfo);
  }

  /** Everyone except the local player. */
  get opponents(): PlayerInfo[] {
    return this.players.filter((p) => p.id !== this.me.id);
  }

  /** Convenience for 1v1 apps. */
  get opponent(): PlayerInfo | undefined {
    return this.opponents[0];
  }

  /** True for the seat-0 player — a handy tie-breaker for "who runs the referee logic". */
  get isHost(): boolean {
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
    if (startedAt !== null && this.startedAt === null) {
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

  /** Submit your final result. Resolves with `final` once the winner is known. */
  submit(submission: Submission): Promise<SubmitResult> {
    return this.request("match.submit", sanitizeSubmission(submission));
  }

  /** Submit on behalf of a bot you are driving (practice & sandbox only). */
  submitFor(playerId: string, submission: Submission): Promise<SubmitResult> {
    return this.request("match.submit", { ...sanitizeSubmission(submission), playerId });
  }

  forfeit(): Promise<null> {
    return this.request("match.forfeit", {});
  }

  /* ---------------------------------------------------------------- */
  /* Realtime room                                                    */
  /* ---------------------------------------------------------------- */

  readonly room = {
    /**
     * Broadcast to every other player. Keep payloads small (≤ 8 KB) and
     * frequent updates under ~30/s.
     */
    send: <P extends Json>(type: string, payload: P): Promise<null> => {
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
        Object.assign(this.context.match, match);
        break;
      }
      case "room.presence": {
        this.online = (message.data as HostEventData<"room.presence">).online.slice();
        break;
      }
    }
    this.dispatch(message.event, message.data);
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

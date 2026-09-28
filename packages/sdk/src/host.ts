/**
 * Host side of the protocol. The XApps marketplace uses this to run apps, and
 * you can use it too — e.g. to embed XApps apps in your own site or to write
 * integration tests for your app.
 */
import {
  LIMITS,
  PROTOCOL_VERSION,
  XAppsError,
  byteLength,
  isEnvelope,
  isRequestMethod,
  type AppToHost,
  type HostEvent,
  type HostEventData,
  type HostToApp,
  type LaunchContext,
  type RequestMessage,
  type RequestMethod,
  type RequestParams,
  type RequestResult,
} from "./protocol";

export type HostHandlers = {
  [M in RequestMethod]?: (params: RequestParams<M>) => RequestResult<M> | Promise<RequestResult<M>>;
};

export interface HostTransport {
  post(message: HostToApp): void;
  listen(handler: (message: AppToHost) => void): () => void;
}

export interface HostCoreOptions {
  /** Read lazily on every handshake so reloads get fresh data. */
  context: () => LaunchContext;
  handlers: HostHandlers;
  /** Fired when an app instance (re)connects. */
  onConnect?: (info: { sdkVersion: string; session: string }) => void;
  /** Fired for every rejected request — useful for dev tooling. */
  onRequestError?: (method: string, error: XAppsError) => void;
  /** Fired for every request — useful for dev tooling (sandbox inspector). */
  onRequest?: (method: RequestMethod, params: unknown) => void;
}

export interface HostBridge {
  /** Send an event to the app. Buffered until the app has connected. */
  emit<E extends HostEvent>(event: E, data: HostEventData<E>): void;
  readonly connected: boolean;
  destroy(): void;
}

const MAX_BUFFERED_EVENTS = 200;

export function createHostCore(transport: HostTransport, options: HostCoreOptions): HostBridge {
  let session: string | null = null;
  let destroyed = false;
  let buffer: HostToApp[] = [];
  let budget: number = LIMITS.roomMessagesPerSecond;
  let refilledAt = Date.now();

  const send = (message: HostToApp) => {
    if (destroyed) return;
    if (!session) {
      if (message.type === "event") {
        buffer.push(message);
        if (buffer.length > MAX_BUFFERED_EVENTS) buffer = buffer.slice(-MAX_BUFFERED_EVENTS);
      }
      return;
    }
    transport.post(message);
  };

  const respondError = (id: number, method: string, error: XAppsError) => {
    options.onRequestError?.(method, error);
    transport.post({
      xapps: PROTOCOL_VERSION,
      type: "response",
      id,
      ok: false,
      error: { code: String(error.code), message: error.message },
    });
  };

  const takeBudget = () => {
    const now = Date.now();
    budget = Math.min(
      LIMITS.roomMessagesPerSecond,
      budget + ((now - refilledAt) / 1000) * LIMITS.roomMessagesPerSecond,
    );
    refilledAt = now;
    if (budget < 1) return false;
    budget -= 1;
    return true;
  };

  const handleRequest = async (message: RequestMessage) => {
    const { id, method, params } = message;
    if (typeof id !== "number") return;
    if (!isRequestMethod(method)) {
      respondError(id, String(method), new XAppsError("unknown_method", `Unknown method ${String(method)}`));
      return;
    }
    const problem = validateRequest(method, params);
    if (problem) {
      respondError(id, method, new XAppsError("invalid_params", `${method}: ${problem}`));
      return;
    }
    if (method === "room.send" && !takeBudget()) {
      respondError(id, method, new XAppsError("rate_limited", "room.send: slow down"));
      return;
    }
    options.onRequest?.(method, params);
    const handler = options.handlers[method] as
      | ((p: unknown) => unknown | Promise<unknown>)
      | undefined;
    if (!handler) {
      respondError(id, method, new XAppsError("unknown_method", `${method} is not supported by this host`));
      return;
    }
    try {
      const result = await handler(params);
      if (destroyed) return;
      transport.post({ xapps: PROTOCOL_VERSION, type: "response", id, ok: true, result: result ?? null });
    } catch (error) {
      if (destroyed) return;
      const err =
        error instanceof XAppsError
          ? error
          : new XAppsError("internal", error instanceof Error ? error.message : "Host error");
      respondError(id, method, err);
    }
  };

  const unlisten = transport.listen((message) => {
    if (destroyed) return;
    if (message.type === "hello") {
      const isNew = message.session !== session;
      session = typeof message.session === "string" ? message.session : "anonymous";
      transport.post({ xapps: PROTOCOL_VERSION, type: "welcome", context: options.context() });
      if (isNew) {
        options.onConnect?.({ sdkVersion: String(message.sdkVersion), session });
        const queued = buffer;
        buffer = [];
        queued.forEach((m) => transport.post(m));
      }
      return;
    }
    if (message.type === "request") {
      if (!session) return; // must say hello first
      void handleRequest(message);
    }
  });

  return {
    emit(event, data) {
      send({ xapps: PROTOCOL_VERSION, type: "event", event, data });
    },
    get connected() {
      return session !== null && !destroyed;
    },
    destroy() {
      destroyed = true;
      buffer = [];
      unlisten();
    },
  };
}

export interface HostBridgeOptions extends HostCoreOptions {
  /** Returns the app's window — typically `() => iframe.contentWindow`. */
  target: () => Window | null;
  /**
   * Exact origin the app is served from, e.g. `https://my-app.dev`.
   * Messages from any other origin are dropped and nothing is ever posted
   * with a wildcard origin.
   */
  appOrigin: string;
  /** Host window. Defaults to the global `window`. */
  window?: Window;
}

/** Bridge between a host page and an app iframe over postMessage. */
export function createHostBridge(options: HostBridgeOptions): HostBridge {
  const win = options.window ?? window;
  const transport: HostTransport = {
    post(message) {
      const target = options.target();
      if (!target) return;
      target.postMessage(message, options.appOrigin);
    },
    listen(handler) {
      const onMessage = (event: MessageEvent) => {
        const target = options.target();
        if (!target || event.source !== target) return;
        if (event.origin !== options.appOrigin) return;
        if (!isEnvelope(event.data)) return;
        const data = event.data as AppToHost;
        if (data.type !== "hello" && data.type !== "request") return;
        handler(data);
      };
      win.addEventListener("message", onMessage);
      return () => win.removeEventListener("message", onMessage);
    },
  };
  return createHostCore(transport, options);
}

/* -------------------------------------------------------------------- */
/* Validation                                                           */
/* -------------------------------------------------------------------- */

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Returns a problem description, or `null` when the params are acceptable. */
export function validateRequest(method: RequestMethod, params: unknown): string | null {
  if (!isObject(params)) return "params must be an object";
  switch (method) {
    case "ready":
    case "match.forfeit":
      return null;
    case "room.send": {
      if (typeof params.type !== "string" || !params.type || params.type.length > LIMITS.eventTypeLength) {
        return "type must be a non-empty string";
      }
      if (byteLength(params.payload) > LIMITS.roomPayloadBytes) return "payload too large";
      return null;
    }
    case "match.submit": {
      if (params.score !== undefined && (typeof params.score !== "number" || !Number.isFinite(params.score))) {
        return "score must be a finite number";
      }
      if (params.playerId !== undefined && typeof params.playerId !== "string") return "playerId must be a string";
      if (params.display !== undefined) {
        const d = params.display;
        if (!isObject(d)) return "display must be an object";
        if (d.kind === "text") {
          if (typeof d.body !== "string" || d.body.length > 1000) return "display.body must be ≤ 1000 chars";
        } else if (d.kind === "svg") {
          if (typeof d.svg !== "string" || !d.svg.trim().startsWith("<svg")) return "display.svg must be SVG markup";
        } else if (d.kind === "image") {
          if (typeof d.url !== "string" || !/^https:\/\//.test(d.url)) return "display.url must be https";
        } else {
          return "unknown display kind";
        }
      }
      if (byteLength(params) > LIMITS.submissionBytes) return "submission too large";
      return null;
    }
    case "ui.toast":
      return typeof params.message === "string" && params.message.length <= LIMITS.toastLength
        ? null
        : "message must be a short string";
    case "ui.celebrate":
    case "ui.haptic":
      return null;
    case "ui.status":
      return params.text === null || (typeof params.text === "string" && params.text.length <= LIMITS.statusLength)
        ? null
        : "text must be a short string or null";
    case "ui.scores": {
      if (!isObject(params.scores)) return "scores must be an object";
      const ok = Object.values(params.scores).every(
        (v) => (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && v.length <= 24),
      );
      return ok ? null : "scores values must be numbers or short strings";
    }
    case "ui.turn":
      return params.playerId === null || typeof params.playerId === "string" ? null : "playerId must be a string";
    case "social.share":
      if (typeof params.text !== "string" || params.text.length > LIMITS.shareTextLength) return "text too long";
      if (params.url !== undefined && (typeof params.url !== "string" || !/^https?:\/\//.test(params.url))) {
        return "url must be http(s)";
      }
      return null;
    case "storage.get":
      return typeof params.key === "string" && params.key.length > 0 && params.key.length <= LIMITS.storageKeyLength
        ? null
        : "key must be a short string";
    case "storage.set":
      if (typeof params.key !== "string" || !params.key || params.key.length > LIMITS.storageKeyLength) {
        return "key must be a short string";
      }
      return byteLength(params.value) > LIMITS.storageValueBytes ? "value too large" : null;
  }
}

/* -------------------------------------------------------------------- */
/* Result helpers shared by hosts                                       */
/* -------------------------------------------------------------------- */

/** Decides the winner of a score-based match. `null` → draw. */
export function decideWinner(
  scores: Record<string, number | null | undefined>,
  scoring: "high" | "low",
): string | null {
  const entries = Object.entries(scores).filter((e): e is [string, number] => typeof e[1] === "number");
  if (entries.length === 0) return null;
  const best = scoring === "high" ? Math.max(...entries.map((e) => e[1])) : Math.min(...entries.map((e) => e[1]));
  const leaders = entries.filter((e) => e[1] === best);
  return leaders.length === 1 ? (leaders[0] as [string, number])[0] : null;
}

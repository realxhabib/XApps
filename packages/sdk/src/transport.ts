import { isEnvelope, type AppToHost, type HostToApp } from "./protocol";

/** Minimal duplex channel between an app and its host. */
export interface AppTransport {
  post(message: AppToHost): void;
  listen(handler: (message: HostToApp, origin: string) => void): () => void;
  /** Called once the host's origin is known so later messages can be pinned to it. */
  pin?(origin: string): void;
}

/**
 * Talks to `window.parent` with postMessage. Until the host answers, `hello`
 * goes out with target origin `*` (it carries nothing sensitive); after the
 * welcome arrives every message is pinned to the host's exact origin and
 * messages from any other window or origin are ignored.
 */
export function createWindowTransport(
  win: Window,
  options: { hostOrigins?: readonly string[] } = {},
): AppTransport {
  let pinned: string | null = null;
  const allowed = options.hostOrigins && options.hostOrigins.length > 0 ? options.hostOrigins : null;

  return {
    post(message) {
      win.parent.postMessage(message, pinned ?? "*");
    },
    listen(handler) {
      const onMessage = (event: MessageEvent) => {
        if (event.source !== win.parent) return;
        if (pinned && event.origin !== pinned) return;
        if (!pinned && allowed && !allowed.includes(event.origin)) return;
        if (!isEnvelope(event.data)) return;
        const data = event.data as HostToApp;
        if (data.type !== "welcome" && data.type !== "response" && data.type !== "event") return;
        handler(data, event.origin);
      };
      win.addEventListener("message", onMessage);
      return () => win.removeEventListener("message", onMessage);
    },
    pin(origin) {
      pinned = origin;
    },
  };
}

/** In-memory transport pair, used by the mock host and by tests. */
export function createMemoryTransportPair(): {
  app: AppTransport;
  host: {
    post(message: HostToApp): void;
    listen(handler: (message: AppToHost) => void): () => void;
  };
} {
  const toHost = new Set<(message: AppToHost) => void>();
  const toApp = new Set<(message: HostToApp, origin: string) => void>();
  // Deliver asynchronously, like postMessage does.
  const defer = (fn: () => void) => queueMicrotask(fn);
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

  return {
    app: {
      post(message) {
        const copy = clone(message);
        defer(() => toHost.forEach((h) => h(copy)));
      },
      listen(handler) {
        toApp.add(handler);
        return () => toApp.delete(handler);
      },
    },
    host: {
      post(message) {
        const copy = clone(message);
        defer(() => toApp.forEach((h) => h(copy, "memory://host")));
      },
      listen(handler) {
        toHost.add(handler);
        return () => toHost.delete(handler);
      },
    },
  };
}

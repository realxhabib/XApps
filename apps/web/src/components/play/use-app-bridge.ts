"use client";

import { createHostBridge, type HostBridge, type HostHandlers } from "@xapps/sdk/host";
import { REQUEST_METHODS, type HostEvent, type HostEventData, type LaunchContext } from "@xapps/sdk/protocol";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { Match } from "@/platform/types";

/** Sandbox for every app iframe the host renders (play room and challenge setup). */
export const APP_SANDBOX = "allow-scripts allow-same-origin allow-popups allow-forms allow-downloads";
export const APP_ALLOW = "autoplay; clipboard-write; fullscreen";

export type Emit = <E extends HostEvent>(event: E, data: HostEventData<E>) => void;

/**
 * Connects the host page to an app iframe through the SDK's host bridge.
 * Handlers and context are read through refs so they always see fresh state
 * without tearing down the bridge.
 */
export function useAppBridge({
  iframeRef,
  appOrigin,
  enabled,
  context,
  handlers,
}: {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  appOrigin: string | null;
  enabled: boolean;
  context: () => LaunchContext;
  handlers: HostHandlers;
}) {
  const handlersRef = useRef(handlers);
  const contextRef = useRef(context);
  useLayoutEffect(() => {
    handlersRef.current = handlers;
    contextRef.current = context;
  });

  const bridgeRef = useRef<HostBridge | null>(null);
  const [connections, setConnections] = useState(0);

  useEffect(() => {
    if (!enabled || !appOrigin) return;
    const proxied = Object.fromEntries(
      REQUEST_METHODS.map((method) => [
        method,
        (params: unknown) => {
          const handler = handlersRef.current[method] as ((p: unknown) => unknown) | undefined;
          if (!handler) throw new Error(`${method} is not supported here`);
          return handler(params);
        },
      ]),
    ) as HostHandlers;
    const bridge = createHostBridge({
      target: () => iframeRef.current?.contentWindow ?? null,
      appOrigin,
      context: () => contextRef.current(),
      handlers: proxied,
      onConnect: () => setConnections((n) => n + 1),
    });
    bridgeRef.current = bridge;
    return () => {
      bridge.destroy();
      bridgeRef.current = null;
      setConnections(0);
    };
  }, [appOrigin, enabled, iframeRef]);

  const emit = useCallback<Emit>((event, data) => {
    bridgeRef.current?.emit(event, data);
  }, []);

  return { connected: connections > 0, connections, emit };
}

/**
 * Tells the app what moved between two snapshots of the watched match:
 * shared state (by version), the turn holder/deadline and the round counter.
 * `by` names the writer when we know it (our own writes).
 */
export function emitMatchChanges(emit: Emit, previous: Match | null, next: Match, by: string | null): void {
  if (!previous || previous.id !== next.id) return;
  if (next.stateVersion !== previous.stateVersion) {
    emit("state.change", { state: next.state, version: next.stateVersion, by });
  }
  if (next.turnUserId !== previous.turnUserId || next.turnDeadline !== previous.turnDeadline) {
    emit("turn.change", { turn: next.turnUserId, deadline: next.turnDeadline });
  }
  if (next.round !== previous.round) {
    emit("round.change", { round: next.round });
  }
}

/** Serialized size in bytes (UTF-8), for host-side limit checks. */
export function jsonBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value) ?? "").length;
  } catch {
    return Infinity;
  }
}

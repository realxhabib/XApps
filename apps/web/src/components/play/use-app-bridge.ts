"use client";

import { createHostBridge, type HostBridge, type HostHandlers } from "@xapps/sdk/host";
import { REQUEST_METHODS, type HostEvent, type HostEventData, type LaunchContext } from "@xapps/sdk/protocol";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

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

  const emit = useCallback(<E extends HostEvent>(event: E, data: HostEventData<E>) => {
    bridgeRef.current?.emit(event, data);
  }, []);

  return { connected: connections > 0, connections, emit };
}

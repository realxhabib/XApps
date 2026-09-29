"use client";

import { useSyncExternalStore } from "react";

/** Shown while rendering on the server, where the page doesn't know which domain it will be served from. */
const PLACEHOLDER = "https://YOUR-XAPPS-HOST";

const noSubscribe = () => () => {};

/**
 * This XApps host's origin (e.g. `https://xapps.example.com`), for copy-paste snippets. Renders a
 * placeholder on the server and swaps in `window.location.origin` right after hydration.
 */
export function useOrigin(): string {
  return useSyncExternalStore(noSubscribe, () => window.location.origin, () => PLACEHOLDER);
}

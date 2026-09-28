import { useSyncExternalStore } from "react";

const noop = () => () => {};

/** `false` during SSR and hydration, `true` afterwards — for browser-only values. */
export function useMounted(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}

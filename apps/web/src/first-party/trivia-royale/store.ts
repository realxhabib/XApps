"use client";

import type { Json, XAppsClient } from "@xapps/sdk";
import { useState, useSyncExternalStore } from "react";
import { anchorFor, parseState, toJson, type TriviaState } from "./logic";

/**
 * What the UI and the driver loop read: the parsed shared state plus two
 * local timestamps. `anchor` is when this client first saw the current phase
 * (the clock every timer here runs on, so clock skew between players never
 * matters); `changedAt` is when it last saw any change.
 */
export interface Snapshot {
  state: TriviaState | null;
  version: number;
  anchor: number;
  changedAt: number;
  /** `round:phase`, or "none" before the first write. */
  key: string;
}

export type Reducer = (state: TriviaState | null) => TriviaState | undefined;

export interface TriviaStore {
  get(): Snapshot;
  subscribe(listener: () => void): () => void;
  /** Read-modify-write. Resolves `true` when a write landed, `false` when the reducer declined. */
  update(fn: Reducer): Promise<boolean>;
  /** False for the local simulation (spectating a table of bots in the mock host). */
  readonly shared: boolean;
}

const keyOf = (state: TriviaState | null) => (state ? `${state.round}:${state.phase}` : "none");

function snapshotFrom(prev: Snapshot | null, raw: Json | null, version: number, live: boolean): Snapshot {
  const now = Date.now();
  const state = parseState(raw);
  const key = keyOf(state);
  if (prev && prev.key === key) return { ...prev, state, version, changedAt: now };
  return {
    state,
    version,
    key,
    anchor: state ? anchorFor(state.startedAt, now, live) : now,
    changedAt: now,
  };
}

/** The real thing: `xapps.state`, compare-and-set with retries. */
export function createSharedStore(xapps: XAppsClient): TriviaStore {
  let snapshot = snapshotFrom(null, xapps.state.current, xapps.state.version, false);
  const listeners = new Set<() => void>();
  let unsubscribe: (() => void) | null = null;

  const accept = (raw: Json | null, version: number) => {
    if (version <= snapshot.version) return;
    snapshot = snapshotFrom(snapshot, raw, version, true);
    listeners.forEach((l) => l());
  };

  return {
    shared: true,
    get: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      if (!unsubscribe) {
        unsubscribe = xapps.state.onChange((raw, change) => accept(raw, change.version));
        // Catch anything that landed between creating the store and subscribing.
        accept(xapps.state.current, xapps.state.version);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
      };
    },
    async update(fn) {
      let wrote = false;
      await xapps.state.update<Json>(
        (draft) => {
          const next = fn(parseState(draft));
          wrote = next !== undefined;
          return next === undefined ? undefined : toJson(next);
        },
        { retries: 12 },
      );
      return wrote;
    },
  };
}

/** In-memory stand-in with the same semantics, for watching a table of bots locally. */
export function createLocalStore(): TriviaStore {
  let snapshot = snapshotFrom(null, null, 0, true);
  const listeners = new Set<() => void>();
  return {
    shared: false,
    get: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async update(fn) {
      const next = fn(snapshot.state ? (structuredClone(snapshot.state) as TriviaState) : null);
      if (next === undefined) return false;
      snapshot = snapshotFrom(snapshot, toJson(next), snapshot.version + 1, true);
      listeners.forEach((l) => l());
      return true;
    },
  };
}

/** One store per mounted game; re-renders on every change. */
export function useTriviaStore(xapps: XAppsClient, simulate: boolean): { store: TriviaStore; snapshot: Snapshot } {
  const [store] = useState(() => (simulate ? createLocalStore() : createSharedStore(xapps)));
  const snapshot = useSyncExternalStore(store.subscribe, store.get, store.get);
  return { store, snapshot };
}

import type { RoomEvent, RoomPeer, RoomTransport } from "../backend";

type Wire =
  | { t: "event"; event: RoomEvent; from: string; at: number }
  | { t: "presence"; userId: string; ready: boolean }
  | { t: "leave"; userId: string };

const HEARTBEAT_MS = 1_000;
const STALE_MS = 3_500;

/**
 * Cross-tab match room built on BroadcastChannel — the demo stand-in for
 * Supabase Realtime broadcast + presence. Open the same match in two tabs
 * (signed in as two different personas) and they play each other live.
 */
export function createDemoRoom(matchId: string, viewerId: string): RoomTransport {
  const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(`xapps-room:${matchId}`) : null;
  const eventHandlers = new Set<(event: RoomEvent, from: string, at: number) => void>();
  const presenceHandlers = new Set<(peers: RoomPeer[]) => void>();
  const peers = new Map<string, { ready: boolean; seenAt: number }>();
  let me: { ready: boolean } | null = null;
  let lastSignature = "";
  let closed = false;

  const post = (message: Wire) => {
    if (!closed) channel?.postMessage(message);
  };

  const snapshot = (): RoomPeer[] => {
    const list: RoomPeer[] = [];
    if (me) list.push({ userId: viewerId, ready: me.ready });
    for (const [userId, peer] of peers) {
      if (userId !== viewerId) list.push({ userId, ready: peer.ready });
    }
    return list.sort((a, b) => a.userId.localeCompare(b.userId));
  };

  const publishPresence = (force = false) => {
    const peersNow = snapshot();
    const signature = JSON.stringify(peersNow);
    if (!force && signature === lastSignature) return;
    lastSignature = signature;
    presenceHandlers.forEach((h) => h(peersNow));
  };

  const onMessage = (event: MessageEvent<Wire>) => {
    const message = event.data;
    if (!message || typeof message !== "object") return;
    if (message.t === "event") {
      eventHandlers.forEach((h) => h(message.event, message.from, message.at));
    } else if (message.t === "presence") {
      const known = peers.has(message.userId);
      peers.set(message.userId, { ready: message.ready, seenAt: Date.now() });
      // Answer newcomers right away so they don't wait a full heartbeat.
      if (!known && me) post({ t: "presence", userId: viewerId, ready: me.ready });
      publishPresence();
    } else if (message.t === "leave") {
      peers.delete(message.userId);
      publishPresence();
    }
  };
  channel?.addEventListener("message", onMessage);

  const heartbeat = setInterval(() => {
    if (me) post({ t: "presence", userId: viewerId, ready: me.ready });
    const now = Date.now();
    let changed = false;
    for (const [userId, peer] of peers) {
      if (now - peer.seenAt > STALE_MS) {
        peers.delete(userId);
        changed = true;
      }
    }
    if (changed) publishPresence();
  }, HEARTBEAT_MS);

  const onUnload = () => post({ t: "leave", userId: viewerId });
  if (typeof window !== "undefined") window.addEventListener("pagehide", onUnload);

  return {
    send(event) {
      post({ t: "event", event, from: viewerId, at: Date.now() });
    },
    onEvent(handler) {
      eventHandlers.add(handler);
      return () => eventHandlers.delete(handler);
    },
    track(state) {
      me = { ...state };
      post({ t: "presence", userId: viewerId, ready: state.ready });
      publishPresence();
    },
    onPresence(handler) {
      presenceHandlers.add(handler);
      handler(snapshot());
      return () => presenceHandlers.delete(handler);
    },
    close() {
      if (closed) return;
      post({ t: "leave", userId: viewerId });
      closed = true;
      clearInterval(heartbeat);
      if (typeof window !== "undefined") window.removeEventListener("pagehide", onUnload);
      channel?.removeEventListener("message", onMessage);
      channel?.close();
      eventHandlers.clear();
      presenceHandlers.clear();
    },
  };
}

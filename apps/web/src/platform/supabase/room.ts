import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { RoomEvent, RoomPeer, RoomTransport } from "../backend";

interface Wire {
  event: RoomEvent;
  from: string;
  at: number;
}

/**
 * Match room on Supabase Realtime: a private channel `match:<id>` using
 * broadcast for game traffic and presence for who's here / who's ready.
 * Only players of the match pass the realtime.messages RLS policies.
 */
export function createSupabaseRoom(supabase: SupabaseClient, matchId: string, viewerId: string): RoomTransport {
  const eventHandlers = new Set<(event: RoomEvent, from: string, at: number) => void>();
  const presenceHandlers = new Set<(peers: RoomPeer[]) => void>();
  let tracked: { ready: boolean } | null = null;
  let subscribed = false;
  let closed = false;
  let peers: RoomPeer[] = [];
  let channel: RealtimeChannel | null = null;
  let retries = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const emitPresence = () => presenceHandlers.forEach((h) => h(peers.slice()));

  const connect = async () => {
    // Private channels authorize with the user's JWT.
    await supabase.realtime.setAuth();
    if (closed) return;
    const ch = supabase.channel(`match:${matchId}`, {
      config: {
        private: true,
        broadcast: { self: false, ack: false },
        presence: { key: viewerId, enabled: true },
      },
    });
    channel = ch;
    ch
      .on("broadcast", { event: "room" }, ({ payload }) => {
        const wire = payload as Wire;
        if (!wire || typeof wire !== "object" || !wire.event) return;
        eventHandlers.forEach((h) => h(wire.event, wire.from, wire.at));
      })
      .on("presence", { event: "sync" }, () => {
        const state = channel?.presenceState<{ ready?: boolean }>() ?? {};
        peers = Object.entries(state).map(([userId, metas]) => ({
          userId,
          ready: metas.some((m) => m.ready === true),
        }));
        emitPresence();
      })
      .subscribe((status) => {
        if (channel !== ch) return; // an old channel we already replaced
        if (status === "SUBSCRIBED") {
          subscribed = true;
          retries = 0;
          if (tracked) void ch.track(tracked);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          subscribed = false;
          if (closed) return;
          console.warn(`[xapps] realtime room ${status.toLowerCase()} for match ${matchId}, reconnecting`);
          reconnect();
        }
      });
  };

  // A dropped or refused channel (network change, a rate limit, a timed-out
  // join) used to leave the room silent until a refresh: rejoin with backoff.
  const reconnect = () => {
    if (closed || retryTimer) return;
    const old = channel;
    channel = null;
    if (old) void supabase.removeChannel(old);
    const delay = Math.min(10_000, 500 * 2 ** retries++);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect();
    }, delay);
  };
  void connect();

  return {
    send(event) {
      if (!channel || closed) return;
      void channel.send({ type: "broadcast", event: "room", payload: { event, from: viewerId, at: Date.now() } satisfies Wire });
    },
    onEvent(handler) {
      eventHandlers.add(handler);
      return () => eventHandlers.delete(handler);
    },
    track(state) {
      tracked = { ...state };
      if (channel && subscribed) void channel.track(tracked);
    },
    onPresence(handler) {
      presenceHandlers.add(handler);
      handler(peers.slice());
      return () => presenceHandlers.delete(handler);
    },
    close() {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      eventHandlers.clear();
      presenceHandlers.clear();
      if (channel) void supabase.removeChannel(channel);
    },
  };
}

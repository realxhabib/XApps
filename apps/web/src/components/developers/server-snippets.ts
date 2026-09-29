/** Copy-paste snippets for app servers (Stage 2), shared by the Server panel and /developers. */

const HOST = "https://YOUR-XAPPS-HOST";

export function webhookSnippet(): string {
  return `// app/api/xapps/webhook/route.ts — a Next.js route handler
import { verifyWebhook } from "@xapps/sdk/server";

export async function POST(request: Request) {
  const body = await request.text();                  // the raw body, before any JSON.parse
  const signature = request.headers.get("x-xapps-signature") ?? "";

  let event;
  try {
    // Checks the HMAC and rejects anything older than 5 minutes.
    event = await verifyWebhook(body, signature, process.env.XAPPS_WEBHOOK_SECRET!);
  } catch {
    return new Response("invalid signature", { status: 401 });
  }

  switch (event.type) {
    case "match.submitted":                           // a player finished: referee it
      await referee(event.match.id);
      break;
    case "match.ended":
      await archive(event.match);
      break;
  }
  return Response.json({ ok: true });                 // any 2xx marks the delivery delivered
}`;
}

export function reportSnippet(host = HOST): string {
  return `// lib/xapps.ts — runs on your server only, never in the browser
import { createServerClient } from "@xapps/sdk/server";

const xapps = createServerClient({
  secret: process.env.XAPPS_SECRET!,                  // xas_…
  baseUrl: "${host}",
});

export async function referee(matchId: string) {
  const match = await xapps.getMatch(matchId);        // every player's submission, data included

  // Don't trust the claimed scores: replay each player's moves yourself.
  const scores = Object.fromEntries(
    match.players.map((p) => [p.userId, replay(p.submission?.data)]),
  );

  await xapps.reportResult(matchId, { scores });      // or { ranks: { [userId]: 1 } }
}`;
}

export const SERVER_ROUTES: { method: "GET" | "PUT" | "POST" | "DELETE"; path: string; body: string; note: string }[] = [
  { method: "GET", path: "/api/v1/matches/:id", body: "—", note: "The match, with every player's submission" },
  { method: "PUT", path: "/api/v1/matches/:id/state", body: "{ state, expectedVersion }", note: "→ { version } · 409 if the version moved" },
  { method: "POST", path: "/api/v1/matches/:id/turn", body: "{ next? }", note: "Pass the turn (default: next seated player)" },
  { method: "POST", path: "/api/v1/matches/:id/round", body: "{ round }", note: "Set the round counter (never backwards)" },
  { method: "POST", path: "/api/v1/matches/:id/result", body: "{ scores } or { ranks }, leavers?", note: "Settle the match. The only way with server authority" },
  { method: "GET", path: "/api/v1/storage/:key", body: "—", note: "→ { value } from your app-scope storage (GET /api/v1/storage?prefix= lists keys)" },
  { method: "PUT", path: "/api/v1/storage/:key", body: "{ value }", note: "Write app-scope storage (≤ 64 KB, public to players)" },
  { method: "DELETE", path: "/api/v1/storage/:key", body: "—", note: "Remove an app-scope key" },
  { method: "POST", path: "/api/v1/stats", body: "{ userId, values }", note: "→ { values } after each stat's aggregate" },
  { method: "POST", path: "/api/v1/achievements", body: "{ userId, id }", note: "→ { unlocked }; XP is awarded once" },
];

export const WEBHOOK_EVENTS: [string, string][] = [
  ["match.created", "A challenge, lobby or practice match was opened"],
  ["match.started", "The table filled (or the creator started it)"],
  ["match.state", "Shared state changed (debounced: one pending per match)"],
  ["match.turn", "The turn passed to someone else"],
  ["match.submitted", "A player submitted. With server authority, your cue to referee"],
  ["match.ended", "Settled. reason: \"server_timeout\" when the 24 h safety valve fired"],
  ["achievement.unlocked", "A player unlocked an achievement: { userId, achievementId }, match: null"],
  ["ping", "Sent by “Send test event” on your app's Server panel"],
];

export const API_ERRORS = "401 bad or missing secret · 403 another app's match · 404 no match or player · 409 conflict or already settled · 422 invalid body · 429 a limit reached (200 storage keys) · 501 demo mode";

export const SIGNATURE_FORMAT = "X-XApps-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, t + \".\" + body)>";

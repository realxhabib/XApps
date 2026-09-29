/**
 * Demo-mode app server settings (Stage 2). Mirrors the owner RPCs closely —
 * secrets in the spec's formats, shown once, stored only as a SHA-256 hash
 * plus a display prefix — but nothing ever leaves the browser: there's no
 * server API and webhooks are recorded, never sent.
 */
import type { WebhookDelivery } from "../types";
import type { CredentialRow, DemoDb, WebhookDeliveryRow } from "./store";

export const DEMO_WEBHOOK_ERROR = "Webhooks need Supabase — nothing was sent in demo mode";
/** Deliveries kept per app (the log shows the most recent 50). */
export const DELIVERY_LIMIT = 50;
export const SECRET_PREFIX_LENGTH = 8;

export type WebhookEvent =
  | "match.created"
  | "match.started"
  | "match.state"
  | "match.turn"
  | "match.submitted"
  | "match.ended"
  | "ping";

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** `xas_` + 48 hex chars. */
export function newAppSecret(): string {
  return `xas_${randomHex(24)}`;
}

/** `whsec_` + 48 hex chars. */
export function newWebhookSecret(): string {
  return `whsec_${randomHex(24)}`;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export { webhookUrlError } from "../webhook-url";

export function credentialsFor(db: DemoDb, appSlug: string): CredentialRow {
  db.credentials ??= {};
  return (db.credentials[appSlug] ??= {
    secretHash: null,
    secretPrefix: null,
    webhookUrl: null,
    webhookSecretHash: null,
    createdAt: new Date().toISOString(),
    rotatedAt: null,
  });
}

/**
 * Like the webhook triggers: enqueue an event, but only for apps with a
 * webhook URL. In demo mode it's recorded as never sent.
 */
export function recordWebhook(db: DemoDb, appSlug: string, event: WebhookEvent, matchId: string | null): WebhookDeliveryRow | null {
  if (!db.credentials?.[appSlug]?.webhookUrl) return null;
  const row: WebhookDeliveryRow = {
    id: crypto.randomUUID(),
    appSlug,
    event,
    matchId,
    createdAt: new Date().toISOString(),
    attempts: 0,
    deliveredAt: null,
    lastStatus: null,
    lastError: DEMO_WEBHOOK_ERROR,
  };
  const all = (db.webhookDeliveries ??= []);
  all.push(row);
  // Keep the newest DELIVERY_LIMIT per app.
  const mine = all.filter((d) => d.appSlug === appSlug);
  if (mine.length > DELIVERY_LIMIT) {
    const drop = new Set(mine.slice(0, mine.length - DELIVERY_LIMIT).map((d) => d.id));
    db.webhookDeliveries = all.filter((d) => !drop.has(d.id));
  }
  return row;
}

export function deliveriesFor(db: DemoDb, appSlug: string, limit = DELIVERY_LIMIT): WebhookDelivery[] {
  return (db.webhookDeliveries ?? [])
    .filter((d) => d.appSlug === appSlug)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
    .map((d) => ({
      id: d.id,
      event: d.event,
      matchId: d.matchId,
      createdAt: d.createdAt,
      attempts: d.attempts,
      deliveredAt: d.deliveredAt,
      lastStatus: d.lastStatus,
      lastError: d.lastError,
    }));
}

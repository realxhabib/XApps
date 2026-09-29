/**
 * Webhook URL rules, mirroring `set_app_webhook`: https only, a public host
 * (no localhost or private ranges), no credentials, at most 2000 characters.
 * Returns an error message, or null when the URL is acceptable.
 */
export function webhookUrlError(input: string): string | null {
  const url = input.trim();
  if (url.length > 2000) return "That URL is too long";
  if (!/^https:\/\//i.test(url)) {
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? "Webhook URLs must use https://" : "Enter a full URL, like https://api.example.com/xapps/webhook";
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "That isn't a valid webhook URL";
  }
  if (parsed.username || parsed.password) return "Leave credentials out of the URL";
  const host = parsed.hostname.toLowerCase();
  if (!host.includes(".")) return "Webhooks must point to a public host";
  if (
    host === "localhost" ||
    /\.(localhost|local|internal)$/.test(host) ||
    /^(0|10|127)\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) ||
    host.startsWith("[")
  ) {
    return "Webhooks must point to a public host";
  }
  return null;
}

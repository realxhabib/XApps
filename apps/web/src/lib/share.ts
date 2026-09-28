/** Opens the X post composer. The user always confirms the post themselves. */
export function xIntentUrl(text: string, url?: string): string {
  const intent = new URL("https://x.com/intent/post");
  intent.searchParams.set("text", text);
  if (url) intent.searchParams.set("url", url);
  return intent.toString();
}

export function openXIntent(text: string, url?: string): void {
  window.open(xIntentUrl(text, url), "_blank", "noopener,noreferrer,width=600,height=520");
}

export function absoluteUrl(path: string): string {
  if (typeof window === "undefined") return path;
  return new URL(path, window.location.origin).toString();
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Entering a full-screen app host (`/play/<id>`, `/apps/<slug>/open`).
 *
 * On phones (coarse pointer) we load the host as a fresh document instead of
 * a client-side navigation: mobile Safari could freeze when an app frame (often
 * WebGL) started on top of the marketplace page it came from, while the same
 * URL loaded directly always worked. A fresh load also frees the marketplace's
 * memory before a heavy game starts. Desktop keeps instant client navigation.
 */

type Router = { push: (href: string) => void };

const HOST_PATH = /^\/(?:play\/[^/?#]+|apps\/[^/?#]+\/open)(?:[?#]|$)/;

/** True for a same-site path (or URL on `origin`) that opens an app host. */
export function isHostHref(href: string, origin?: string): boolean {
  if (typeof href !== "string" || !href) return false;
  if (href.startsWith("/")) return HOST_PATH.test(href);
  try {
    const url = new URL(href);
    return url.origin === (origin ?? (typeof window !== "undefined" ? window.location.origin : "")) && HOST_PATH.test(url.pathname + url.search);
  } catch {
    return false;
  }
}

/** Phones and tablets: load app hosts as a new document. */
export function prefersHardHostNav(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
}

/** Navigates to an app host: a full load on touch devices, the router elsewhere. */
export function goToHost(router: Router, href: string): void {
  if (prefersHardHostNav()) window.location.assign(href);
  else router.push(href);
}

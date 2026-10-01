/**
 * Full-screen mode for app hosts (`/play/<id>`, `/apps/<slug>/open`).
 *
 * Two layers, so it works everywhere:
 * - "Immersive": the host hides its own chrome (top bar, frame padding) and the
 *   app fills the screen edge to edge. Works on every device, iPhone included,
 *   and is remembered as a preference for the next app.
 * - Real browser fullscreen (Fullscreen API) on top, where the browser allows
 *   it: desktop, Android and iPad. It needs a tap, so it's requested from the
 *   toggle button; leaving it (Esc, the system back gesture) leaves immersive.
 *   iPhone Safari only fullscreens videos; there, Add to Home Screen hides the
 *   browser bars (see `app/manifest.ts`).
 */

const KEY = "xapps:immersive";
const EVENT = "xapps:immersive";

type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FsElement = HTMLElement & { webkitRequestFullscreen?: (options?: FullscreenOptions) => Promise<void> | void };

function fsDoc(): FsDocument {
  return document as FsDocument;
}

/** The element in browser fullscreen, if any (standard or WebKit-prefixed). */
export function fullscreenElement(): Element | null {
  const doc = fsDoc();
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

/** True where the page itself can go fullscreen (not iPhone Safari). */
export function canFullscreen(): boolean {
  if (typeof document === "undefined") return false;
  const doc = fsDoc();
  return doc.fullscreenEnabled === true || doc.webkitFullscreenEnabled === true;
}

/** True when running from the home screen (no browser UI already). */
export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches);
}

/** iPhone and iPod: no page fullscreen, but Add to Home Screen works. */
export function isIPhone(): boolean {
  return typeof navigator !== "undefined" && /iPhone|iPod/.test(navigator.userAgent);
}

function readPref(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

let current: boolean | null = null;
/** Set while *we* hold browser fullscreen, so leaving it can leave immersive too. */
let ownsFullscreen = false;

function write(on: boolean): void {
  current = on;
  try {
    if (on) window.localStorage.setItem(KEY, "1");
    else window.localStorage.removeItem(KEY);
  } catch {
    // Private mode: the toggle still works for this page.
  }
  window.dispatchEvent(new Event(EVENT));
}

function onFullscreenChange(): void {
  if (fullscreenElement()) return;
  if (ownsFullscreen) {
    ownsFullscreen = false;
    if (current) write(false);
  }
}

/** `useSyncExternalStore` subscribe: preference changes, other tabs, and fullscreen exits. */
export function subscribeImmersive(notify: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    current = event.newValue === "1";
    notify();
  };
  const onFs = () => {
    onFullscreenChange();
    notify();
  };
  window.addEventListener(EVENT, notify);
  window.addEventListener("storage", onStorage);
  document.addEventListener("fullscreenchange", onFs);
  document.addEventListener("webkitfullscreenchange", onFs);
  return () => {
    window.removeEventListener(EVENT, notify);
    window.removeEventListener("storage", onStorage);
    document.removeEventListener("fullscreenchange", onFs);
    document.removeEventListener("webkitfullscreenchange", onFs);
  };
}

export function getImmersive(): boolean {
  if (current === null) current = readPref();
  return current;
}

export function getFullscreen(): boolean {
  return !!fullscreenElement();
}

/**
 * Turns full-screen mode on. Call from a tap or click: the browser only grants
 * fullscreen inside a user gesture. Resolves with whether the browser went
 * fullscreen too (false on iPhone, where only the host chrome hides).
 */
export async function enterImmersive(): Promise<boolean> {
  write(true);
  if (!canFullscreen() || fullscreenElement()) return !!fullscreenElement();
  const root = document.documentElement as FsElement;
  try {
    if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: "hide" });
    else await root.webkitRequestFullscreen?.();
    ownsFullscreen = !!fullscreenElement();
    return ownsFullscreen;
  } catch {
    return false;
  }
}

/** Turns full-screen mode off (and leaves browser fullscreen if we entered it). */
export function exitImmersive(): void {
  write(false);
  leaveFullscreen();
}

/** Leaves browser fullscreen we entered (when a host unmounts), keeping the preference. */
export function leaveFullscreen(): void {
  if (!fullscreenElement()) return;
  ownsFullscreen = false;
  const doc = fsDoc();
  try {
    const done = doc.exitFullscreen ? doc.exitFullscreen() : doc.webkitExitFullscreen?.();
    if (done && typeof (done as Promise<void>).catch === "function") (done as Promise<void>).catch(() => undefined);
  } catch {
    // Already out.
  }
}

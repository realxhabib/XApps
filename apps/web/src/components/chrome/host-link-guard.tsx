"use client";

import { useEffect } from "react";
import { isHostHref, prefersHardHostNav } from "@/lib/host-nav";

/**
 * On touch devices, links into an app host (`/play/<id>`, `/apps/<slug>/open`)
 * load it as a fresh document instead of a client-side navigation (see
 * `lib/host-nav.ts`). A capture listener on the document runs before React's
 * root listener, so Next's <Link> never starts its own navigation.
 */
export function HostLinkGuard() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (!prefersHardHostNav()) return;
      const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(a instanceof HTMLAnchorElement) || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      if (!isHostHref(a.href)) return;
      e.preventDefault();
      e.stopPropagation();
      window.location.assign(a.href);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return null;
}

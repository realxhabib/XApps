"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRight,
  Code2,
  FlaskConical,
  Gavel,
  Home,
  LayoutGrid,
  LogIn,
  LogOut,
  Search,
  Swords,
  Trophy,
  UserRound,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { Avatar } from "@/components/ui/avatar";
import { Kbd } from "@/components/ui/kbd";
import { AppGlyph } from "@/components/marketplace/app-glyph";
import { isSoundEnabled, play, setSoundEnabled } from "@/lib/sfx";
import { BLUR_TWEEN, spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useBackend, useViewer } from "@/platform/client";
import { useApps, useSearchProfiles } from "@/platform/queries";

export const usePalette = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

interface Item {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  keywords?: string;
  run: () => void;
}

export function CommandPalette() {
  const { open, setOpen } = usePalette();
  const router = useRouter();
  const backend = useBackend();
  const { viewer } = useViewer();
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query.trim());
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const { data: apps } = useApps();
  const people = useSearchProfiles(deferred, open && deferred.length > 0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if ((event.key === "k" && (event.metaKey || event.ctrlKey)) || (event.key === "/" && !typing)) {
        event.preventDefault();
        setOpen(!usePalette.getState().open);
        play("whoosh");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  const close = () => {
    setOpen(false);
    setQuery("");
    setActive(0);
  };
  const go = (href: string) => () => {
    close();
    router.push(href);
  };

  const items = useMemo<Item[]>(() => {
    const q = deferred.toLowerCase();
    const match = (text: string) => !q || text.toLowerCase().includes(q);
    const pages: Item[] = [
      { id: "p-home", group: "Go to", label: "Home", icon: <Home className="size-4" />, run: go("/") },
      { id: "p-apps", group: "Go to", label: "Marketplace", keywords: "apps browse", icon: <LayoutGrid className="size-4" />, run: go("/apps") },
      { id: "p-arena", group: "Go to", label: "Arena — judge contests", keywords: "vote judge", icon: <Gavel className="size-4" />, run: go("/arena") },
      { id: "p-challenges", group: "Go to", label: "Challenges", keywords: "inbox invites", icon: <Swords className="size-4" />, run: go("/challenges") },
      { id: "p-ranks", group: "Go to", label: "Leaderboard", keywords: "ranks top", icon: <Trophy className="size-4" />, run: go("/leaderboard") },
      { id: "p-dev", group: "Go to", label: "Developer docs", keywords: "sdk build api", icon: <Code2 className="size-4" />, run: go("/developers") },
      { id: "p-sandbox", group: "Go to", label: "Sandbox — test your app", keywords: "playground debug", icon: <FlaskConical className="size-4" />, run: go("/developers/sandbox") },
    ];
    const appItems: Item[] = (apps ?? []).map((app) => ({
      id: `a-${app.slug}`,
      group: "Apps",
      label: app.name,
      hint: app.tagline,
      keywords: `${app.category} ${app.tags.join(" ")}`,
      icon: <AppGlyph app={app} size={28} />,
      run: go(`/apps/${app.slug}`),
    }));
    const peopleItems: Item[] = (people.data ?? []).map((p) => ({
      id: `u-${p.id}`,
      group: "People",
      label: p.name,
      hint: `@${p.handle}`,
      icon: <Avatar person={p} size={28} />,
      run: go(`/u/${p.handle}`),
    }));
    const soundOn = isSoundEnabled();
    const actions: Item[] = [
      {
        id: "x-sound",
        group: "Actions",
        label: soundOn ? "Mute sounds" : "Turn sounds on",
        icon: soundOn ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />,
        run: () => {
          setSoundEnabled(!soundOn);
          close();
        },
      },
      viewer
        ? {
            id: "x-profile",
            group: "Actions",
            label: "My profile",
            icon: <UserRound className="size-4" />,
            run: go(`/u/${viewer.handle}`),
          }
        : { id: "x-login", group: "Actions", label: "Sign in with X", icon: <LogIn className="size-4" />, run: go("/login") },
      ...(viewer
        ? [
            {
              id: "x-logout",
              group: "Actions",
              label: "Sign out",
              icon: <LogOut className="size-4" />,
              run: () => {
                close();
                void backend.signOut();
              },
            },
          ]
        : []),
    ];
    return [
      ...appItems.filter((i) => match(`${i.label} ${i.hint} ${i.keywords}`)),
      ...peopleItems,
      ...pages.filter((i) => match(`${i.label} ${i.keywords ?? ""}`)),
      ...actions.filter((i) => match(i.label)),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- go/close are stable enough for a palette
  }, [apps, people.data, deferred, viewer, backend]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(items.length - 1, i + 1));
      play("tick");
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(0, i - 1));
      play("tick");
    } else if (event.key === "Enter") {
      event.preventDefault();
      items[active]?.run();
      play("pop");
    } else if (event.key === "Escape") {
      close();
    }
  };

  let lastGroup = "";
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[85] flex items-start justify-center px-4 pt-[12vh]">
          <motion.div
            className="absolute inset-0 bg-ink-950/60 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={close}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            className="glass-strong relative w-full max-w-xl overflow-hidden rounded-3xl shadow-[0_40px_120px_-20px_rgb(0_0_0/0.8)]"
            initial={{ opacity: 0, y: -16, scale: 0.96, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -10, scale: 0.97, filter: "blur(6px)", transition: { duration: 0.14 } }}
            transition={{ ...spring.snappy, filter: BLUR_TWEEN }}
          >
            <div className="flex items-center gap-3 border-b border-white/[0.07] px-5">
              <Search className="size-4 shrink-0 text-ink-300" />
              <input
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onKeyDown}
                placeholder="Search apps, people, pages…"
                className="h-14 w-full bg-transparent text-[15px] outline-none placeholder:text-ink-400"
                aria-label="Search"
              />
              <Kbd>esc</Kbd>
            </div>
            <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
              {items.length === 0 && (
                <p className="px-4 py-10 text-center text-sm text-ink-300">Nothing matches “{query}”.</p>
              )}
              {items.map((item, index) => {
                const header = item.group !== lastGroup ? item.group : null;
                lastGroup = item.group;
                return (
                  <div key={item.id}>
                    {header && (
                      <p className="px-3 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-widest text-ink-400">
                        {header}
                      </p>
                    )}
                    <button
                      data-index={index}
                      onMouseMove={() => setActive(index)}
                      onClick={() => {
                        play("pop");
                        item.run();
                      }}
                      className={cn(
                        "relative flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors",
                        index === active ? "text-ink-50" : "text-ink-200",
                      )}
                    >
                      {index === active && (
                        <motion.span
                          layoutId="palette-active"
                          className="absolute inset-0 rounded-2xl bg-white/[0.07]"
                          transition={spring.layout}
                        />
                      )}
                      <span className="relative flex size-8 shrink-0 items-center justify-center rounded-xl bg-white/[0.04] text-ink-200">
                        {item.icon}
                      </span>
                      <span className="relative min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{item.label}</span>
                        {item.hint && <span className="block truncate text-xs text-ink-400">{item.hint}</span>}
                      </span>
                      {index === active && <ArrowRight className="relative size-4 text-ink-300" />}
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 border-t border-white/[0.07] px-5 py-2.5 text-[11px] text-ink-400">
              <span className="flex items-center gap-1.5">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> navigate
              </span>
              <span className="flex items-center gap-1.5">
                <Kbd>↵</Kbd> open
              </span>
              <span className="ml-auto flex items-center gap-1.5">
                <Kbd>⌘</Kbd>
                <Kbd>K</Kbd> toggle
              </span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

"use client";

import { AnimatePresence, motion } from "motion/react";
import { Code2, Gavel, LogOut, Repeat2, Swords, UserRound, Volume2, VolumeX } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Avatar } from "@/components/ui/avatar";
import { isSoundEnabled, onSoundChange, play, setSoundEnabled } from "@/lib/sfx";
import { BLUR_TWEEN, spring } from "@/lib/motion";
import { cn, formatNumber } from "@/lib/utils";
import { useBackend } from "@/platform/client";
import { levelInfo, levelTitle } from "@/platform/scoring";
import type { Profile } from "@/platform/types";
import { toast } from "./toasts";

export function useSoundSetting(): boolean {
  return useSyncExternalStore(onSoundChange, isSoundEnabled, () => true);
}

export function UserMenu({ viewer }: { viewer: Profile }) {
  const [open, setOpen] = useState(false);
  const [personas, setPersonas] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const backend = useBackend();
  const sound = useSoundSetting();
  const level = levelInfo(viewer.xp);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item = "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-ink-100 transition hover:bg-white/[0.07]";

  return (
    <div ref={ref} className="relative">
      <motion.button
        whileTap={{ scale: 0.92 }}
        onClick={() => {
          setOpen((o) => !o);
          play("pop");
        }}
        className="flex items-center rounded-full"
        aria-label="Account menu"
        aria-expanded={open}
      >
        <Avatar person={viewer} size={40} ring={level.progress} />
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: -6, filter: "blur(6px)" }}
            animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.95, y: -4, transition: { duration: 0.12 } }}
            transition={{ ...spring.snappy, filter: BLUR_TWEEN }}
            style={{ transformOrigin: "top right" }}
            className="glass-strong absolute right-0 top-12 z-50 w-72 overflow-hidden rounded-3xl p-2 shadow-2xl"
          >
            <div className="flex items-center gap-3 p-3">
              <Avatar person={viewer} size={48} ring={level.progress} />
              <div className="min-w-0">
                <p className="truncate font-semibold">{viewer.name}</p>
                <p className="truncate text-sm text-ink-300">@{viewer.handle}</p>
              </div>
            </div>
            <div className="mx-3 mb-2 rounded-2xl bg-white/[0.04] p-3">
              <div className="flex items-baseline justify-between text-xs">
                <span className="font-semibold text-volt">
                  Lv {level.level} · {levelTitle(level.level)}
                </span>
                <span className="tabular text-ink-300">
                  {formatNumber(viewer.xp)} / {formatNumber(level.next)} XP
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                <motion.div
                  className="h-full rounded-full bg-[linear-gradient(90deg,var(--color-volt),#1fd1b2)]"
                  initial={{ width: 0 }}
                  animate={{ width: `${level.progress * 100}%` }}
                  transition={{ type: "spring", stiffness: 80, damping: 18, delay: 0.1 }}
                />
              </div>
            </div>
            <Link href={`/u/${viewer.handle}`} className={item} onClick={() => setOpen(false)}>
              <UserRound className="size-4 text-ink-300" /> Profile
            </Link>
            <Link href="/challenges" className={item} onClick={() => setOpen(false)}>
              <Swords className="size-4 text-ink-300" /> Challenges
            </Link>
            <Link href="/developers" className={item} onClick={() => setOpen(false)}>
              <Code2 className="size-4 text-ink-300" /> Build an app
            </Link>
            {viewer.isAdmin && (
              <Link href="/admin/review" className={item} onClick={() => setOpen(false)}>
                <Gavel className="size-4 text-ink-300" /> Review queue
              </Link>
            )}
            <button className={item} onClick={() => setSoundEnabled(!sound)}>
              {sound ? <Volume2 className="size-4 text-ink-300" /> : <VolumeX className="size-4 text-ink-300" />}
              Sounds {sound ? "on" : "off"}
            </button>
            {backend.demo && (
              <>
                <button className={item} onClick={() => setPersonas((p) => !p)}>
                  <Repeat2 className="size-4 text-ink-300" /> Play as someone else
                </button>
                <AnimatePresence initial={false}>
                  {personas && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="max-h-48 overflow-y-auto px-1 pb-1">
                        {backend.demo.personas().map((p) => (
                          <button
                            key={p.id}
                            onClick={async () => {
                              await backend.demo?.switchTo(p.id);
                              setOpen(false);
                              toast(`You're now @${p.handle}`, { tone: "success", description: "Open another tab as someone else to play yourself live." });
                            }}
                            className={cn(
                              "flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left text-sm transition hover:bg-white/[0.07]",
                              p.id === viewer.id && "bg-white/[0.06]",
                            )}
                          >
                            <Avatar person={p} size={24} />
                            <span className="truncate">@{p.handle}</span>
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}
            <div className="my-1 h-px bg-white/[0.07]" />
            <button
              className={cn(item, "text-ink-300")}
              onClick={async () => {
                setOpen(false);
                await backend.signOut();
                toast("Signed out");
              }}
            >
              <LogOut className="size-4" /> Sign out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

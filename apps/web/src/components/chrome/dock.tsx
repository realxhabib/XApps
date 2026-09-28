"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { play } from "@/lib/sfx";
import { haptic } from "@/lib/haptics";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, isActive } from "./nav-items";
import { InboxBadge } from "./top-bar";
import { useInbox } from "./use-inbox";

/** Floating bottom dock for phones. */
export function Dock() {
  const pathname = usePathname();
  const { count } = useInbox();
  const items = NAV_ITEMS.filter((i) => i.href !== "/developers");

  return (
    <nav
      aria-label="Main"
      style={{ viewTransitionName: "site-dock" }}
      className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[max(env(safe-area-inset-bottom),12px)] lg:hidden"
    >
      <div className="glass-strong flex h-16 w-full max-w-md items-center justify-around rounded-[1.6rem] px-2 shadow-[0_20px_60px_-10px_rgb(0_0_0/0.9)]">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => {
                play("tick");
                haptic("light");
              }}
              className={cn(
                "relative flex h-12 w-14 flex-col items-center justify-center gap-0.5 rounded-2xl text-[10px] font-semibold transition-colors",
                active ? "text-ink-950" : "text-ink-300",
              )}
              aria-current={active ? "page" : undefined}
            >
              {active && (
                <motion.span layoutId="dock-active" className="absolute inset-0 rounded-2xl bg-ink-50" transition={spring.layout} />
              )}
              <motion.span className="relative" animate={{ y: active ? -1 : 0, scale: active ? 1.08 : 1 }} transition={spring.bouncy}>
                <Icon className="size-5" strokeWidth={active ? 2.4 : 2} />
              </motion.span>
              <span className="relative">{item.label}</span>
              {item.inbox && <InboxBadge count={count} className="absolute right-1 top-0.5" />}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

"use client";

import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "motion/react";
import { Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { play } from "@/lib/sfx";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useViewer } from "@/platform/client";
import { usePalette } from "./command-palette";
import { Logo } from "./logo";
import { NAV_ITEMS, isActive } from "./nav-items";
import { useInbox } from "./use-inbox";
import { UserMenu } from "./user-menu";

export function InboxBadge({ count, className }: { count: number; className?: string }) {
  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.span
          key={count}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          exit={{ scale: 0 }}
          transition={spring.wobbly}
          className={cn(
            "flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-flare px-1 text-[10px] font-bold text-white shadow-[0_0_12px_rgb(255_92_168/0.8)]",
            className,
          )}
        >
          {count}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

export function TopBar() {
  const pathname = usePathname();
  const { viewer, loading } = useViewer();
  const { count } = useInbox();
  const openPalette = usePalette((s) => s.setOpen);
  const [hidden, setHidden] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const { scrollY } = useScroll();

  useMotionValueEvent(scrollY, "change", (current) => {
    const previous = scrollY.getPrevious() ?? 0;
    setScrolled(current > 12);
    if (current > 160 && current > previous + 4) setHidden(true);
    else if (current < previous - 4 || current < 160) setHidden(false);
  });

  return (
    <motion.header
      style={{ viewTransitionName: "site-header" }}
      className="fixed inset-x-0 top-0 z-50 flex justify-center px-3 pt-3"
      animate={{ y: hidden ? -96 : 0 }}
      transition={spring.soft}
    >
      <div
        className={cn(
          "flex h-16 w-full max-w-6xl items-center gap-3 rounded-full pl-5 pr-2.5 transition-[background-color,box-shadow,border-color] duration-500",
          scrolled ? "glass-strong shadow-[0_20px_60px_-20px_rgb(0_0_0/0.8)]" : "border border-transparent",
        )}
      >
        <Logo />
        <nav className="ml-4 hidden items-center lg:flex" onMouseLeave={() => setHovered(null)} aria-label="Main">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onMouseEnter={() => setHovered(item.href)}
                onClick={() => play("tick")}
                className={cn(
                  "relative flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-colors",
                  active ? "text-ink-50" : "text-ink-300 hover:text-ink-50",
                )}
              >
                {hovered === item.href && (
                  <motion.span layoutId="nav-hover" className="absolute inset-0 rounded-full bg-white/[0.06]" transition={spring.layout} />
                )}
                {active && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-x-3 -bottom-0.5 h-0.5 rounded-full bg-[linear-gradient(90deg,var(--color-nova-400),var(--color-flare))]"
                    transition={spring.layout}
                  />
                )}
                <span className="relative">{item.label}</span>
                {item.inbox && <InboxBadge count={count} className="relative" />}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => {
              openPalette(true);
              play("whoosh");
            }}
            className="group flex h-10 items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] pl-3.5 pr-2 text-sm text-ink-300 transition hover:border-white/20 hover:text-ink-100"
            aria-label="Search (Command K)"
          >
            <Search className="size-4" />
            <span className="hidden sm:inline">Search</span>
            <span className="hidden items-center gap-1 sm:flex">
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </span>
          </button>
          {loading ? (
            <Skeleton className="size-10 rounded-full" />
          ) : viewer ? (
            <UserMenu viewer={viewer} />
          ) : (
            <Button href={`/login?next=${encodeURIComponent(pathname)}`} size="md" magnetic>
              Sign in
            </Button>
          )}
        </div>
      </div>
    </motion.header>
  );
}

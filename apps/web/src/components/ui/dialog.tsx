"use client";

import { AnimatePresence, motion, useDragControls, type PanInfo } from "motion/react";
import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Modal that is a centered card on desktop and a draggable bottom sheet on
 * phones. Escape, backdrop click and a downward flick all dismiss it.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const drag = useDragControls();

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab" && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input,textarea,select,[tabindex]:not([tabindex="-1"])',
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>("[data-autofocus],input,button")?.focus();
    }, 50);
    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      restoreRef.current?.focus?.();
    };
  }, [open, onClose]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 120 || info.velocity.y > 600) onClose();
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-6">
          <motion.div
            className="absolute inset-0 bg-ink-950/70 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            className={cn(
              "glass-strong relative z-10 w-full max-w-lg overflow-hidden rounded-t-[2rem] p-6 pb-8 shadow-2xl sm:rounded-[2rem] sm:pb-6",
              className,
            )}
            initial={{ opacity: 0, y: 60, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.97 }}
            transition={spring.soft}
            drag="y"
            dragControls={drag}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={onDragEnd}
          >
            <div
              className="-mt-3 mb-3 flex cursor-grab justify-center pb-1 pt-1 active:cursor-grabbing sm:hidden"
              onPointerDown={(e) => drag.start(e)}
            >
              <span className="h-1.5 w-12 rounded-full bg-white/20" />
            </div>
            <button
              onClick={onClose}
              className="absolute right-4 top-4 hidden size-9 items-center justify-center rounded-full text-ink-300 transition hover:bg-white/10 hover:text-white sm:flex"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
            {title && (
              <h2 id={titleId} className="pr-10 font-display text-2xl font-bold tracking-tight">
                {title}
              </h2>
            )}
            {description && <p className="mt-1.5 text-sm text-ink-300">{description}</p>}
            <div className={cn(title || description ? "mt-5" : "")}>{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

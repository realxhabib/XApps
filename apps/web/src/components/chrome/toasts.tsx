"use client";

import { AnimatePresence, motion, type PanInfo } from "motion/react";
import { CheckCircle2, Info, TriangleAlert, XCircle } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { create } from "zustand";
import { play } from "@/lib/sfx";
import { BLUR_TWEEN, spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

export type ToastTone = "info" | "success" | "warning" | "danger";

export interface Toast {
  id: number;
  title: string;
  description?: string;
  tone: ToastTone;
  icon?: ReactNode;
  action?: { label: string; onClick: () => void };
  duration: number;
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id" | "tone" | "duration"> & { tone?: ToastTone; duration?: number }) => number;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (toast) => {
    const id = nextId++;
    set((state) => ({
      toasts: [...state.toasts.slice(-3), { tone: "info", duration: 4200, ...toast, id }],
    }));
    return id;
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

export function toast(title: string, options: Partial<Omit<Toast, "id" | "title">> = {}): number {
  if (options.tone === "danger") play("error");
  else if (options.tone === "success") play("notify");
  return useToasts.getState().push({ title, ...options });
}

const toneIcon: Record<ToastTone, ReactNode> = {
  info: <Info className="size-4 text-nova-300" />,
  success: <CheckCircle2 className="size-4 text-success" />,
  warning: <TriangleAlert className="size-4 text-gold" />,
  danger: <XCircle className="size-4 text-danger" />,
};

function ToastCard({ toast: t }: { toast: Toast }) {
  const dismiss = useToasts((s) => s.dismiss);
  useEffect(() => {
    const timer = setTimeout(() => dismiss(t.id), t.duration);
    return () => clearTimeout(timer);
  }, [dismiss, t.duration, t.id]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (Math.abs(info.offset.x) > 90 || Math.abs(info.velocity.x) > 500) dismiss(t.id);
  };

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 24, scale: 0.9, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
      exit={{ opacity: 0, scale: 0.9, x: 40, transition: { duration: 0.18 } }}
      transition={{ ...spring.bouncy, filter: BLUR_TWEEN }}
      drag="x"
      dragSnapToOrigin
      dragElastic={0.5}
      onDragEnd={onDragEnd}
      className="glass-strong pointer-events-auto relative w-full cursor-grab overflow-hidden rounded-2xl p-3.5 pr-4 shadow-2xl active:cursor-grabbing"
      role="status"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-white/[0.06]">
          {t.icon ?? toneIcon[t.tone]}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug">{t.title}</p>
          {t.description && <p className="mt-0.5 text-[13px] leading-snug text-ink-300">{t.description}</p>}
        </div>
        {t.action && (
          <button
            onClick={() => {
              t.action?.onClick();
              dismiss(t.id);
            }}
            className="shrink-0 self-center rounded-full bg-ink-50 px-3 py-1.5 text-xs font-bold text-ink-950 transition hover:bg-white"
          >
            {t.action.label}
          </button>
        )}
      </div>
      <motion.span
        aria-hidden
        className={cn(
          "absolute bottom-0 left-0 h-0.5 origin-left",
          t.tone === "danger" ? "bg-danger" : t.tone === "success" ? "bg-success" : "bg-nova-400",
        )}
        initial={{ scaleX: 1 }}
        animate={{ scaleX: 0 }}
        transition={{ duration: t.duration / 1000, ease: "linear" }}
        style={{ width: "100%" }}
      />
    </motion.li>
  );
}

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <ol className="pointer-events-none fixed inset-x-0 bottom-24 z-[95] mx-auto flex w-full max-w-sm flex-col gap-2 px-4 sm:bottom-6 sm:left-auto sm:right-6 sm:mx-0 sm:px-0">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} />
        ))}
      </AnimatePresence>
    </ol>
  );
}

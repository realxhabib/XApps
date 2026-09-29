"use client";

/**
 * Mobile controls: a floating virtual stick on the left half of the screen
 * (appears where your thumb lands), and weapon / boost / self-right buttons
 * on the right. Buttons buzz through the host's haptics.
 */

import { useXApps } from "@xapps/sdk/react";
import { RotateCcw, Zap } from "lucide-react";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/utils";
import { WeaponRing, useHud } from "./hud";
import type { WeaponKind } from "./logic";
import type { MatchRuntime } from "./runtime";

const RADIUS = 56;

export function TouchControls({ rt }: { rt: MatchRuntime }) {
  const xapps = useXApps();
  const hud = useHud(rt);
  const [stick, setStick] = useState<{ ox: number; oy: number; left: number; top: number; x: number; y: number } | null>(null);
  const pointer = useRef<number | null>(null);
  const me = hud.me;
  if (!me || !me.alive || hud.phase !== "fight") return null;

  const haptic = (style: "light" | "medium") => {
    xapps.ui.haptic(style).catch(() => {});
  };

  const move = (e: ReactPointerEvent, origin: { ox: number; oy: number; left: number; top: number }) => {
    let dx = e.clientX - origin.left - origin.ox;
    let dy = e.clientY - origin.top - origin.oy;
    const d = Math.hypot(dx, dy);
    if (d > RADIUS) {
      dx = (dx / d) * RADIUS;
      dy = (dy / d) * RADIUS;
    }
    setStick({ ...origin, x: dx, y: dy });
    rt.input.setStick(dx / RADIUS, -dy / RADIUS);
  };

  const button = (name: "fire" | "boost" | "selfRight") => ({
    onPointerDown: (e: ReactPointerEvent) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      rt.input.setButton(name, true);
      haptic(name === "fire" ? "medium" : "light");
    },
    onPointerUp: () => rt.input.setButton(name, false),
    onPointerCancel: () => rt.input.setButton(name, false),
    onLostPointerCapture: () => rt.input.setButton(name, false),
  });

  return (
    <div className="absolute inset-0 touch-none select-none">
      {/* Stick zone */}
      <div
        className="pointer-events-auto absolute bottom-0 left-0 top-[30%] w-1/2"
        onPointerDown={(e) => {
          if (pointer.current !== null) return;
          pointer.current = e.pointerId;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const origin = { ox: e.clientX - rect.left, oy: e.clientY - rect.top, left: rect.left, top: rect.top };
          setStick({ ...origin, x: 0, y: 0 });
          rt.input.setStick(0, 0);
        }}
        onPointerMove={(e) => {
          if (e.pointerId !== pointer.current || !stick) return;
          move(e, stick);
        }}
        onPointerUp={(e) => {
          if (e.pointerId !== pointer.current) return;
          pointer.current = null;
          setStick(null);
          rt.input.setStick(0, 0);
        }}
        onPointerCancel={() => {
          pointer.current = null;
          setStick(null);
          rt.input.setStick(0, 0);
        }}
      >
        {stick ? (
          <div className="absolute" style={{ left: stick.ox, top: stick.oy }}>
            <div className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/20 bg-white/5" style={{ width: RADIUS * 2 + 24, height: RADIUS * 2 + 24 }} />
            <div
              className="absolute size-16 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/30 bg-white/25 shadow-[0_0_24px_rgb(255_255_255/0.25)] backdrop-blur"
              style={{ transform: `translate(calc(-50% + ${stick.x}px), calc(-50% + ${stick.y}px))` }}
            />
          </div>
        ) : (
          <div className="absolute bottom-[max(2.5rem,env(safe-area-inset-bottom))] left-10 flex size-32 items-center justify-center rounded-full border-2 border-dashed border-white/15">
            <div className="size-14 rounded-full bg-white/10" />
          </div>
        )}
      </div>

      {/* Buttons */}
      <div className="absolute bottom-[max(1.5rem,env(safe-area-inset-bottom))] right-5 flex items-end gap-3">
        <div className="flex flex-col items-center gap-3">
          {me.flipped && (
            <button
              type="button"
              aria-label="Self-right"
              {...button("selfRight")}
              className={cn(
                "pointer-events-auto flex size-14 items-center justify-center rounded-full border border-white/20 bg-white/10 backdrop-blur active:scale-95",
                me.selfRightReady && "animate-pulse bg-[var(--accent-from)]/30",
              )}
            >
              <RotateCcw className="size-6" />
            </button>
          )}
          <button
            type="button"
            aria-label="Boost"
            {...button("boost")}
            className="pointer-events-auto relative flex size-16 items-center justify-center overflow-hidden rounded-full border border-white/20 bg-ink-900/70 backdrop-blur active:scale-95"
          >
            <span className="absolute inset-x-0 bottom-0 bg-[#35c8ff]/35" style={{ height: `${me.boost * 100}%` }} />
            <Zap className="relative size-7 text-[#35c8ff]" />
          </button>
        </div>
        <button type="button" aria-label="Fire weapon" {...button("fire")} className="pointer-events-auto rounded-full active:scale-95">
          <WeaponRing weapon={me.weapon as WeaponKind} cooldown={me.cooldown} ready={me.weaponReady} size={96} label={false} />
        </button>
      </div>
    </div>
  );
}

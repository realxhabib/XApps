"use client";

import { motion, useReducedMotion } from "motion/react";
import { useCallback, useId, useState, type ReactNode } from "react";
import { spring } from "@/lib/motion";
import { cn, formatNumber } from "@/lib/utils";

/**
 * Small SVG charts for the console. Dark surface only (the site is dark).
 * Palette: the dataviz reference categorical slots 1–3, dark steps, validated
 * against the panel surface #0d1018 (all checks pass).
 */
export const SERIES_COLORS = ["#3987e5", "#d95926", "#199e70"] as const;
const GRID = "rgb(255 255 255 / 0.07)";
const BASELINE = "rgb(255 255 255 / 0.16)";
const SURFACE = "#0d1018";

export interface Series<K extends string> {
  key: K;
  label: string;
  color: string;
}

/** Width of an element, kept current with a ResizeObserver. */
function useWidth() {
  const [width, setWidth] = useState(0);
  const ref = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth(Math.round(w));
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceMax(max: number): { top: number; step: number } {
  if (max <= 4) return { top: 4, step: 1 };
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s * 4 >= max) ?? 10 * pow;
  return { top: step * 4, step };
}

export function shortDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return d.toLocaleDateString("en", { month: "short", day: "numeric" });
}

/* ---------------------------------------------------------------------- */
/* Line chart                                                              */
/* ---------------------------------------------------------------------- */

/**
 * Daily series on one axis with a snapping crosshair and one tooltip for every
 * series. Arrow keys move the crosshair when focused.
 */
export function LineChart<K extends string, Row extends { date: string } & Record<K, number>>({
  data,
  series,
  height = 180,
  label,
  format = formatNumber,
}: {
  data: Row[];
  series: Series<K>[];
  height?: number;
  label: string;
  format?: (n: number) => string;
}) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const reduced = useReducedMotion();
  const clipId = useId();
  const pad = { top: 10, right: 12, bottom: 24, left: 34 };
  const w = Math.max(0, width - pad.left - pad.right);
  const h = height - pad.top - pad.bottom;
  const max = Math.max(0, ...data.flatMap((row) => series.map((s) => row[s.key] ?? 0)));
  const { top, step } = niceMax(max);
  const x = (i: number) => pad.left + (data.length <= 1 ? w / 2 : (i / (data.length - 1)) * w);
  const y = (v: number) => pad.top + h - (v / top) * h;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const xLabels = data.length ? [0, Math.floor((data.length - 1) / 2), data.length - 1].filter((v, i, a) => a.indexOf(v) === i) : [];

  const pick = (clientX: number, rect: DOMRect) => {
    if (!data.length) return;
    const rel = clientX - rect.left - pad.left;
    const i = data.length <= 1 ? 0 : Math.round((rel / Math.max(1, w)) * (data.length - 1));
    setActive(Math.max(0, Math.min(data.length - 1, i)));
  };

  const activeRow = active !== null ? data[active] : null;
  const tipLeft = active !== null ? Math.min(Math.max(x(active), 70), Math.max(70, width - 70)) : 0;

  return (
    <div ref={ref} className="relative select-none" style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={label}
          tabIndex={0}
          className="block touch-pan-y rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-nova-400/60"
          onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerDown={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            setActive((a) => Math.max(0, Math.min(data.length - 1, (a ?? data.length - 1) + (e.key === "ArrowRight" ? 1 : -1))));
          }}
        >
          <defs>
            <clipPath id={clipId}>
              <motion.rect
                x={pad.left - 4}
                y={0}
                height={height}
                initial={{ width: reduced ? w + 8 : 0 }}
                animate={{ width: w + 8 }}
                transition={reduced ? { duration: 0 } : { duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              />
            </clipPath>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={pad.left + w} y1={y(t)} y2={y(t)} stroke={t === 0 ? BASELINE : GRID} strokeWidth={1} shapeRendering="crispEdges" />
              <text x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-ink-400 font-mono text-[10px] tabular">
                {format(t)}
              </text>
            </g>
          ))}
          {xLabels.map((i) => (
            <text
              key={i}
              x={x(i)}
              y={height - 6}
              textAnchor={i === 0 && data.length > 1 ? "start" : i === data.length - 1 && data.length > 1 ? "end" : "middle"}
              className="fill-ink-400 text-[10px]"
            >
              {shortDate(data[i]!.date)}
            </text>
          ))}
          <g clipPath={`url(#${clipId})`}>
            {series.length === 1 && data.length > 1 && (
              <path
                d={`M${x(0)},${y(0)} ${data.map((row, i) => `L${x(i)},${y(row[series[0]!.key] ?? 0)}`).join(" ")} L${x(data.length - 1)},${y(0)} Z`}
                fill={series[0]!.color}
                opacity={0.1}
              />
            )}
            {series.map((s) => (
              <path
                key={s.key}
                d={data.map((row, i) => `${i ? "L" : "M"}${x(i)},${y(row[s.key] ?? 0)}`).join(" ")}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
            {data.length === 1 &&
              series.map((s) => <circle key={s.key} cx={x(0)} cy={y(data[0]![s.key] ?? 0)} r={4} fill={s.color} stroke={SURFACE} strokeWidth={2} />)}
          </g>
          {activeRow && active !== null && (
            <g pointerEvents="none">
              <line x1={x(active)} x2={x(active)} y1={pad.top} y2={pad.top + h} stroke="rgb(255 255 255 / 0.35)" strokeWidth={1} shapeRendering="crispEdges" />
              {series.map((s) => (
                <circle key={s.key} cx={x(active)} cy={y(activeRow[s.key] ?? 0)} r={4} fill={s.color} stroke={SURFACE} strokeWidth={2} />
              ))}
            </g>
          )}
        </svg>
      )}
      {activeRow && (
        <motion.div
          className="pointer-events-none absolute top-0 z-10 w-[140px] -translate-x-1/2 rounded-xl border border-white/10 bg-ink-900/95 px-3 py-2 shadow-xl backdrop-blur"
          style={{ left: tipLeft }}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring.snappy}
          role="status"
        >
          <p className="text-[11px] text-ink-400">{shortDate(activeRow.date)}</p>
          {series.map((s) => (
            <p key={s.key} className="mt-0.5 flex items-center gap-2 text-xs">
              <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden />
              <b className="font-mono text-ink-50 tabular">{format(activeRow[s.key] ?? 0)}</b>
              <span className="truncate text-ink-400">{s.label}</span>
            </p>
          ))}
        </motion.div>
      )}
    </div>
  );
}

/** Legend with line keys and a headline value per series (acts as the direct label). */
export function Legend({ items }: { items: { label: string; color: string; value?: ReactNode }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2 text-xs text-ink-300">
          <span className="h-0.5 w-3.5 rounded-full" style={{ background: item.color }} aria-hidden />
          {item.label}
          {item.value !== undefined && <b className="font-semibold text-ink-50">{item.value}</b>}
        </li>
      ))}
    </ul>
  );
}

/* ---------------------------------------------------------------------- */
/* Bars, meters, tiles                                                     */
/* ---------------------------------------------------------------------- */

/** Horizontal bars, one series (slot 1), value at the tip. */
export function BarList({
  rows,
  format = formatNumber,
  empty = "No data yet",
  label,
}: {
  rows: { key: string; label: ReactNode; value: number; hint?: string }[];
  format?: (n: number) => string;
  empty?: string;
  label: string;
}) {
  const reduced = useReducedMotion();
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-ink-400">{empty}</p>;
  return (
    <ul className="space-y-2.5" aria-label={label}>
      {rows.map((row, i) => (
        <li key={row.key} className="group" title={row.hint}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-ink-200">{row.label}</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="relative h-3 flex-1">
              <motion.div
                className="h-3 rounded-r-[4px] transition-[filter] group-hover:brightness-125"
                style={{ background: SERIES_COLORS[0], originX: 0 }}
                initial={reduced ? false : { width: 0 }}
                animate={{ width: `${Math.max(1.5, (row.value / max) * 100)}%` }}
                transition={{ ...spring.soft, delay: reduced ? 0 : i * 0.04 }}
              />
            </div>
            <span className="w-12 shrink-0 text-right font-mono text-xs text-ink-100 tabular">{format(row.value)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** A ratio against 100%: fill in slot 1, track a darker step of the same blue. */
export function Meter({ value, label }: { value: number | null; label: string }) {
  const reduced = useReducedMotion();
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value === null ? undefined : Math.round(value * 100)} className="h-2 overflow-hidden rounded-full" style={{ background: "#184f9566" }}>
      {value !== null && (
        <motion.div
          className="h-full rounded-full"
          style={{ background: SERIES_COLORS[0] }}
          initial={reduced ? false : { width: 0 }}
          animate={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
          transition={spring.soft}
        />
      )}
    </div>
  );
}

/** Tiny trend line in the de-emphasis gray with the last point in the accent. */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return null;
  const W = 100;
  const H = 28;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * W, H - 3 - (v / max) * (H - 6)] as const);
  const last = pts[pts.length - 1]!;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={cn("h-7 w-full overflow-visible", className)} aria-hidden>
      <path d={pts.map(([px, py], i) => `${i ? "L" : "M"}${px},${py}`).join(" ")} fill="none" stroke="rgb(141 150 173 / 0.6)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={2.5} fill={SERIES_COLORS[0]} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function StatTile({ label, value, sub, trend, className }: { label: string; value: ReactNode; sub?: ReactNode; trend?: number[]; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col rounded-3xl border border-white/[0.08] bg-white/[0.025] p-4", className)}>
      <p className="truncate text-xs text-ink-400">{label}</p>
      <p className="mt-1 truncate text-2xl font-semibold tracking-tight text-ink-50">{value}</p>
      {sub && <p className="mt-0.5 truncate text-xs text-ink-400">{sub}</p>}
      {trend && <Sparkline values={trend} className="mt-auto pt-2" />}
    </div>
  );
}

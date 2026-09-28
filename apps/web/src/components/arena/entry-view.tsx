import type { SubmissionDisplay } from "@/platform/types";
import { svgDataUrl } from "@/lib/svg";
import { cn } from "@/lib/utils";

const SIDE_STYLES: Record<string, { label: string; className: string }> = {
  for: { label: "For", className: "bg-volt/15 text-volt border-volt/30" },
  against: { label: "Against", className: "bg-flare/15 text-flare border-flare/30" },
};

/** Parses tones like "for:2" (side + spice) used by Hot Takes; other tones render as a plain badge. */
function parseTone(tone?: string): { side?: { label: string; className: string }; spice: number; raw?: string } {
  if (!tone) return { spice: 0 };
  const [side, spice] = tone.split(":");
  const style = side ? SIDE_STYLES[side] : undefined;
  if (style) return { side: style, spice: Number(spice) || 0 };
  return { spice: 0, raw: tone };
}

/**
 * Renders a contest entry exactly as the app described it. SVG and images go
 * through <img>, so entries from any app can never run script on the host.
 */
export function EntryView({ display, className, compact }: { display: SubmissionDisplay | undefined; className?: string; compact?: boolean }) {
  if (!display) {
    return (
      <div className={cn("flex aspect-square items-center justify-center rounded-3xl hairline bg-white/[0.03] text-sm text-ink-400", className)}>
        No entry
      </div>
    );
  }
  if (display.kind === "svg" || display.kind === "image") {
    const src = display.kind === "svg" ? svgDataUrl(display.svg) : display.url;
    return (
      // eslint-disable-next-line @next/next/no-img-element -- data: URLs and third-party entries
      <img
        src={src}
        alt={display.alt}
        referrerPolicy="no-referrer"
        draggable={false}
        className={cn("aspect-square w-full rounded-3xl bg-ink-800 object-cover shadow-2xl ring-1 ring-white/10", className)}
      />
    );
  }
  const tone = parseTone(display.tone);
  return (
    <div
      className={cn(
        "relative flex flex-col overflow-hidden rounded-3xl bg-[linear-gradient(160deg,#1d1320,#120d16)] p-5 shadow-2xl ring-1 ring-white/10",
        compact ? "min-h-40" : "min-h-56",
        className,
      )}
    >
      {tone.spice > 0 && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3"
          style={{
            background: `radial-gradient(ellipse at 50% 120%, rgb(255 110 60 / ${0.12 + tone.spice * 0.1}), transparent 70%)`,
          }}
        />
      )}
      <div className="relative flex items-center gap-2">
        {tone.side && (
          <span className={cn("rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider", tone.side.className)}>
            {tone.side.label}
          </span>
        )}
        {tone.spice > 0 && <span className="text-sm">{"🌶️".repeat(Math.min(3, tone.spice))}</span>}
        {tone.raw && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-ink-200">{tone.raw}</span>}
      </div>
      {display.title && <p className="relative mt-3 text-xs font-semibold text-ink-300">{display.title}</p>}
      <p className={cn("relative mt-2 font-display font-semibold leading-snug text-ink-50", compact ? "text-base" : "text-lg sm:text-xl")}>
        “{display.body}”
      </p>
    </div>
  );
}

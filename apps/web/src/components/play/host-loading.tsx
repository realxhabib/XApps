import { Spinner } from "@/components/ui/spinner";

/** Full-screen "opening…" shown the instant you tap into a match or an app, before its room is ready. */
export function HostLoading({ label = "Opening…" }: { label?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-ink-950 text-ink-200" role="status" aria-live="polite">
      <Spinner className="size-8" />
      <p className="text-sm font-semibold">{label}</p>
    </div>
  );
}

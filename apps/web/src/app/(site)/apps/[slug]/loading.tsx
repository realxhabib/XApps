import { Skeleton } from "@/components/ui/skeleton";

/** Shown the instant an app card is tapped, until the app page is ready. */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading app">
      <Skeleton className="mb-4 h-5 w-28 rounded-full" />
      <Skeleton className="h-96 rounded-[2.5rem]" />
      <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Skeleton className="h-64 rounded-[2rem]" />
        <Skeleton className="h-64 rounded-[2rem]" />
      </div>
    </div>
  );
}

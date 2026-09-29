import { FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { isTestBuild, testBuildLabel } from "@/platform/shipping";
import type { Match } from "@/platform/types";

/** "Test build v1.1.0" — shown wherever a match of an unpublished version appears. Renders nothing otherwise. */
export function TestBuildBadge({ match, className, compact }: { match: Match; className?: string; compact?: boolean }) {
  if (!isTestBuild(match)) return null;
  const label = testBuildLabel(match);
  return (
    <Badge tone="gold" className={cn("shrink-0", className)}>
      <span className="inline-flex items-center gap-1" title={`${label} — not ranked`}>
        <FlaskConical className="size-3" aria-hidden />
        {compact ? <span aria-hidden>{match.versionLabel ? `v${match.versionLabel}` : "Test"}</span> : <span>{label}</span>}
        {compact && <span className="sr-only">{label}</span>}
      </span>
    </Badge>
  );
}

import { parseStatsBody, respondStatValues, runAppServerApi } from "@/lib/server-api";

/**
 * Server API: `{ userId, values: { [statKey]: number } }` → `{ values }`, each
 * stat's new value after its aggregate. The only way to report stats for
 * server-authoritative apps.
 */
export async function POST(request: Request) {
  return runAppServerApi(request, {
    parse: parseStatsBody,
    rpc: "app_api_report_stats",
    args: (b) => ({ p_user: b.userId, p_values: b.values }),
    respond: respondStatValues,
  });
}

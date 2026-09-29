import { parseResultBody, respondOk, runServerApi } from "@/lib/server-api";

/**
 * Server API: settle the match with `{ scores }` or `{ ranks }` (+ optional `leavers`) → `{ ok: true }`.
 * The only way to settle matches of `authority: "server"` apps.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return runServerApi(request, params, {
    parse: parseResultBody,
    rpc: "app_api_report_result",
    args: (b) => ({ p_result: b }),
    respond: respondOk,
  });
}

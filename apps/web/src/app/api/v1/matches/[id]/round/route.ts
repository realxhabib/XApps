import { parseRoundBody, respondOk, runServerApi } from "@/lib/server-api";

/** Server API: `{ round }` → `{ ok: true }`. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return runServerApi(request, params, {
    parse: parseRoundBody,
    rpc: "app_api_set_round",
    args: (b) => ({ p_round: b.round }),
    respond: respondOk,
  });
}

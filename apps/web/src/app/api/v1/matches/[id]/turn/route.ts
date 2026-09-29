import { parseTurnBody, respondOk, runServerApi } from "@/lib/server-api";

/** Server API: `{ next? }` ends the current turn → `{ ok: true }`. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return runServerApi(request, params, {
    parse: parseTurnBody,
    rpc: "app_api_end_turn",
    args: (b) => ({ p_next: b.next }),
    respond: respondOk,
  });
}

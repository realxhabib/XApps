import { respondMatch, runServerApi } from "@/lib/server-api";

/** Server API: the match with every player's entry (auth: `Bearer xas_…`). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return runServerApi(request, params, { rpc: "app_api_get_match", respond: respondMatch });
}

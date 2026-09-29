import { parseStateBody, respondVersion, runServerApi } from "@/lib/server-api";

/** Server API: `{ state, expectedVersion }` → `{ version }`; 409 `conflict` when the version moved. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return runServerApi(request, params, {
    parse: parseStateBody,
    rpc: "app_api_set_state",
    args: (b) => ({ p_state: b.state, p_expected_version: b.expectedVersion }),
    respond: respondVersion,
  });
}

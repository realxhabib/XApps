import { parseStorageKey, parseStorageValueBody, respondOk, runAppServerApi } from "@/lib/server-api";

type Context = { params: Promise<{ key: string }> };

const keyArg = (params: Context["params"]) => async () => ({ p_key: parseStorageKey((await params).key) });

/** Server API: reads the app-scope key → `{ value }` (null when unset). */
export async function GET(request: Request, { params }: Context) {
  return runAppServerApi(request, {
    target: keyArg(params),
    rpc: "app_api_storage_get",
    respond: (data) => ({ value: data ?? null }),
  });
}

/**
 * Server API: writes the app-scope key (`{ value }`, ≤ 64 KB). App scope is
 * public: every player reads it with `storage.get(key, { scope: "app" })`,
 * only your server writes it.
 */
export async function PUT(request: Request, { params }: Context) {
  return runAppServerApi(request, {
    target: keyArg(params),
    parse: parseStorageValueBody,
    rpc: "app_api_storage_set",
    args: (b) => ({ p_value: b.value }),
    respond: respondOk,
  });
}

/** Server API: removes the app-scope key (no body). */
export async function DELETE(request: Request, { params }: Context) {
  return runAppServerApi(request, { target: keyArg(params), rpc: "app_api_storage_delete", respond: respondOk });
}

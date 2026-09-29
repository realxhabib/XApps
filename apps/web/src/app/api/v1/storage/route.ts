import { LIMITS } from "@xapps/sdk";
import { runAppServerApi, ServerApiError } from "@/lib/server-api";

/** Server API: the app-scope keys (sorted) → `{ keys }`, optionally `?prefix=`. */
export async function GET(request: Request) {
  return runAppServerApi(request, {
    target: () => {
      const prefix = new URL(request.url).searchParams.get("prefix");
      if (prefix !== null && prefix.length > LIMITS.storageKeyLength) {
        throw new ServerApiError(422, "invalid_params", `\`prefix\` is at most ${LIMITS.storageKeyLength} characters`);
      }
      return { p_prefix: prefix || null };
    },
    rpc: "app_api_storage_list",
    respond: (data) => ({ keys: Array.isArray(data) ? data.filter((k): k is string => typeof k === "string") : [] }),
  });
}

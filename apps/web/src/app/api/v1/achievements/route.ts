import { parseAchievementBody, respondUnlocked, runAppServerApi } from "@/lib/server-api";

/**
 * Server API: `{ userId, id }` → `{ unlocked }` (false if the player already
 * had it; XP is only awarded once). The only way to unlock achievements for
 * server-authoritative apps.
 */
export async function POST(request: Request) {
  return runAppServerApi(request, {
    parse: parseAchievementBody,
    rpc: "app_api_unlock_achievement",
    args: (b) => ({ p_user: b.userId, p_id: b.id }),
    respond: respondUnlocked,
  });
}

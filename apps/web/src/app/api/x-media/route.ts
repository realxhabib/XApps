import type { NextRequest } from "next/server";
import { XPostError, fetchXPostPhoto, xPostId } from "@/lib/x-post";

/** Turns an X post link into its first photo, so a challenger can drop a meme straight from their timeline. */
export async function GET(request: NextRequest) {
  const id = xPostId(request.nextUrl.searchParams.get("url") ?? "");
  if (!id) return Response.json({ error: "Paste a link to an X post, like x.com/someone/status/123…" }, { status: 400 });
  try {
    const photo = await fetchXPostPhoto(id);
    return Response.json(photo, { headers: { "Cache-Control": "public, max-age=300, s-maxage=3600" } });
  } catch (error) {
    const status = error instanceof XPostError ? error.status : 502;
    const message = error instanceof XPostError ? error.message : "X didn't answer. Try again in a moment.";
    return Response.json({ error: message }, { status });
  }
}

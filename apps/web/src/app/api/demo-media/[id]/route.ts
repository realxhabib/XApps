import { demoMediaStore } from "@/lib/demo-media-store";
import { isSupabaseConfigured } from "@/lib/env";
import { DEMO_MEDIA_ID, mediaExtension } from "@/lib/media";

const SAFETY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  // Never a document: even if a browser navigates here, nothing can run.
  "Content-Security-Policy": "default-src 'none'; sandbox",
  // Apps on other origins may draw uploads into canvases (meme editors).
  "Access-Control-Allow-Origin": "*",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: { ...SAFETY_HEADERS, "Cache-Control": "no-store" } });
}

/** `bytes=start-end` → an inclusive range within `size`, "invalid", or null for no/ignored Range. */
function parseRange(header: string | null, size: number): { start: number; end: number } | "invalid" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;
  let start: number;
  let end: number;
  if (!match[1]) {
    // Suffix: the last N bytes.
    const suffix = Number(match[2]);
    if (suffix === 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  if (start >= size || end < start) return "invalid";
  return { start, end };
}

async function serve(request: Request, params: Promise<{ id: string }>, head: boolean): Promise<Response> {
  if (isSupabaseConfigured) return notFound();
  const { id } = await params;
  if (!DEMO_MEDIA_ID.test(id)) return notFound();
  const entry = demoMediaStore().get(id);
  if (!entry) return notFound();

  const size = entry.bytes.byteLength;
  const headers: Record<string, string> = {
    ...SAFETY_HEADERS,
    "Content-Type": entry.mime,
    "Accept-Ranges": "bytes",
    // Ids are never reused, so a file never changes (it can only disappear).
    "Cache-Control": "public, max-age=86400, immutable",
  };
  if (new URL(request.url).searchParams.get("download") === "1") {
    headers["Content-Disposition"] = `attachment; filename="xapps-upload.${mediaExtension(entry.mime)}"`;
  }

  const range = parseRange(request.headers.get("range"), size);
  if (range === "invalid") {
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
  }
  if (range) {
    const slice = entry.bytes.slice(range.start, range.end + 1);
    return new Response(head ? null : slice, {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
        "Content-Length": String(slice.byteLength),
      },
    });
  }
  return new Response(head ? null : entry.bytes.slice(), { headers: { ...headers, "Content-Length": String(size) } });
}

/** Serves a demo-mode upload with its type, byte ranges (video seeking) and locked-down headers. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return serve(request, params, false);
}

export async function HEAD(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return serve(request, params, true);
}

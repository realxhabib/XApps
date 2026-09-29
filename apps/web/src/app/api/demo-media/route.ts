import { LIMITS } from "@xapps/sdk";
import { demoMediaStore } from "@/lib/demo-media-store";
import { isSupabaseConfigured } from "@/lib/env";
import { baseMime, bytesMatchMime, DEMO_MEDIA_PREFIX, mediaKindOf, mediaProblem } from "@/lib/media";

/** The biggest upload of any kind (video). Multipart requests get a little room for their envelope. */
const MAX_FILE_BYTES = Math.max(LIMITS.media.image.maxBytes, LIMITS.media.audio.maxBytes, LIMITS.media.video.maxBytes);
const MAX_REQUEST_BYTES = MAX_FILE_BYTES + 64 * 1024;

function fail(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

/** Reads a request body, giving up once it passes `max` bytes. Null when too large. */
async function readCapped(body: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Demo-mode uploads for `media.upload`: a raw body with its Content-Type, or
 * multipart form data with a `file` field. Validated per `LIMITS.media`
 * (type, size, and that the bytes look like the declared type), then kept in
 * the dev server's memory. Returns `{ id, url }`. 404 when Supabase is set up.
 */
export async function POST(request: Request) {
  if (isSupabaseConfigured) return fail(404, "not_found", "Demo media is only available in demo mode");

  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_REQUEST_BYTES) {
    return fail(413, "too_large", "Uploads can be up to 25 MB (videos), 10 MB (audio) or 8 MB (images)");
  }

  const contentType = request.headers.get("content-type") ?? "";
  let mime: string;
  let bytes: Uint8Array | null;
  if (baseMime(contentType) === "multipart/form-data") {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return fail(400, "invalid_body", "Couldn't read the form data");
    }
    const file = form.get("file");
    if (!(file instanceof Blob)) return fail(400, "invalid_body", "Send the file in a `file` field");
    mime = baseMime(file.type);
    if (file.size > MAX_FILE_BYTES) bytes = null;
    else bytes = new Uint8Array(await file.arrayBuffer());
  } else {
    mime = baseMime(contentType);
    bytes = await readCapped(request.body, MAX_FILE_BYTES);
  }

  if (!mediaKindOf(mime)) return fail(415, "unsupported_type", mediaProblem(mime, 1) ?? "Unsupported file type");
  const problem = mediaProblem(mime, bytes?.byteLength ?? Infinity);
  if (!bytes || problem) return fail(bytes && bytes.byteLength === 0 ? 400 : 413, "too_large", problem ?? "File too large");
  if (!bytesMatchMime(bytes, mime)) return fail(415, "unsupported_type", `That file doesn't look like ${mime}`);

  const id = demoMediaStore().put(bytes, mime);
  return Response.json(
    { id, url: `${DEMO_MEDIA_PREFIX}${id}`, mime, bytes: bytes.byteLength },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}

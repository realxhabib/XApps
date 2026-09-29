import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3, 4]);

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
  delete (globalThis as { __xappsDemoMedia?: unknown }).__xappsDemoMedia;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const post = (body: BodyInit, type: string) =>
  new Request("http://localhost:3000/api/demo-media", { method: "POST", headers: { "content-type": type }, body });
const get = (id: string, headers: Record<string, string> = {}) =>
  new Request(`http://localhost:3000/api/demo-media/${id}`, { headers });
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

describe("/api/demo-media", () => {
  it("stores a raw upload and serves it back with safe headers", async () => {
    const { POST } = await import("./route");
    const { GET } = await import("./[id]/route");
    const res = await POST(post(PNG, "image/png"));
    expect(res.status).toBe(201);
    const { id, url, bytes } = await res.json();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(url).toBe(`/api/demo-media/${id}`);
    expect(bytes).toBe(PNG.length);

    const file = await GET(get(id), idParams(id));
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("image/png");
    expect(file.headers.get("x-content-type-options")).toBe("nosniff");
    expect(file.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(file.headers.get("cache-control")).toMatch(/max-age/);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PNG);
  });

  it("accepts multipart uploads and serves byte ranges", async () => {
    const { POST } = await import("./route");
    const { GET } = await import("./[id]/route");
    const form = new FormData();
    form.set("file", new Blob([PNG], { type: "image/png" }), "a.png");
    const res = await POST(new Request("http://localhost:3000/api/demo-media", { method: "POST", body: form }));
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const part = await GET(get(id, { range: "bytes=2-5" }), idParams(id));
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 2-5/${PNG.length}`);
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(PNG.slice(2, 6));
    expect((await GET(get(id, { range: "bytes=999-" }), idParams(id))).status).toBe(416);
  });

  it("rejects unsupported types, disguised files and oversized uploads", async () => {
    const { POST } = await import("./route");
    expect((await POST(post("<svg onload=alert(1)>", "image/svg+xml"))).status).toBe(415);
    expect((await POST(post("<html><script>alert(1)</script></html>", "image/png"))).status).toBe(415);
    expect((await POST(post(new Uint8Array(0), "image/png"))).status).toBe(400);
    const big = new Uint8Array(8 * 1024 * 1024 + 1);
    big.set(PNG);
    const res = await POST(post(big, "image/png"));
    expect(res.status).toBe(413);
    expect((await res.json()).error.message).toMatch(/8 MB/);
  });

  it("404s for unknown ids, bad ids, and whenever Supabase is configured", async () => {
    const { GET } = await import("./[id]/route");
    expect((await GET(get("f".repeat(32)), idParams("f".repeat(32)))).status).toBe(404);
    expect((await GET(get("../etc"), idParams("../etc"))).status).toBe(404);

    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    const route = await import("./route");
    expect((await route.POST(post(PNG, "image/png"))).status).toBe(404);
  });
});

describe("DemoMediaStore", () => {
  it("evicts the least recently used files past its capacity", async () => {
    const { DemoMediaStore } = await import("@/lib/demo-media-store");
    const store = new DemoMediaStore(10);
    const a = store.put(new Uint8Array(4), "image/png");
    const b = store.put(new Uint8Array(4), "image/png");
    expect(store.get(a)).not.toBeNull(); // a is now the most recent
    const c = store.put(new Uint8Array(4), "image/png");
    expect(store.get(b)).toBeNull();
    expect(store.get(a)).not.toBeNull();
    expect(store.get(c)).not.toBeNull();
    expect(store.bytes).toBe(8);
    expect(() => store.put(new Uint8Array(11), "image/png")).toThrow();
  });
});

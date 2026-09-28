import { afterEach, describe, expect, it, vi } from "vitest";

const IMGFLIP = {
  success: true,
  data: {
    memes: [
      { id: "87743020", name: "Two Buttons", url: "https://i.imgflip.com/1g8my4.jpg", width: 600, height: 908, box_count: 3 },
      { id: "555", name: "Brand New Format", url: "https://i.imgflip.com/abc123.jpg", width: 800, height: 600, box_count: 2 },
      { id: "556", name: "Filler A", url: "https://i.imgflip.com/f1.jpg", width: 500, height: 500, box_count: 2 },
      { id: "557", name: "Filler B", url: "https://i.imgflip.com/f2.jpg", width: 500, height: 500, box_count: 2 },
    ],
  },
};

function grokText(text: string) {
  return { output: [{ type: "message", content: [{ type: "output_text", text }] }] };
}

function tweet(id: string, handle: string) {
  return {
    __typename: "Tweet",
    text: "blank template",
    user: { screen_name: handle },
    photos: [{ url: `https://pbs.twimg.com/media/${id}.jpg`, width: 1000, height: 800 }],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("GET /api/trending-memes", () => {
  it("falls back to imgflip without a key", async () => {
    vi.stubEnv("XAI_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(IMGFLIP)));
    const { GET } = await import("./route");
    const body = await (await GET()).json();
    expect(body.source).toBe("imgflip");
    expect(body.memes[0]).toMatchObject({ id: "imgflip-87743020", title: "Two Buttons" });
  });

  it("finds formats with Grok, uses the blank original, and asks Grok for a layout", async () => {
    vi.stubEnv("XAI_API_KEY", "test-key");
    const calls: { url: string; body?: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ url, body });
        if (url.startsWith("https://api.imgflip.com")) return Response.json(IMGFLIP);
        if (url.startsWith("https://api.x.ai")) {
          if (body.tools?.[0]?.type === "x_search") {
            return Response.json(
              grokText(
                JSON.stringify({
                  formats: [
                    { name: "Two Buttons", why: "election week", examples: ["https://x.com/a/status/1901000000000000001"], imgflip_name: "Two Buttons" },
                    { name: "Stare Cat", why: "new", blank_post: "https://x.com/cats/status/1901000000000000002" },
                    { name: "Brand New Format", why: "rising", imgflip_name: "Brand New Format" },
                    { name: "Filler A", imgflip_name: "Filler A" },
                    { name: "No Original", why: "only captioned copies exist" },
                  ],
                }),
              ),
            );
          }
          return Response.json(grokText('{"slots":[{"label":"Cat","x":0.2,"y":0.1,"w":0.5,"h":0.15,"style":"label"}]}'));
        }
        if (url.startsWith("https://cdn.syndication.twimg.com")) {
          const id = new URL(url).searchParams.get("id")!;
          return Response.json(tweet(id, "cats"));
        }
        return new Response("not found", { status: 404 });
      }),
    );
    const { GET } = await import("./route");
    const body = await (await GET()).json();
    expect(body.source).toBe("grok");
    const byTitle = Object.fromEntries(body.memes.map((m: { title: string }) => [m.title, m]));
    // Known template: imgflip's blank; our hand-made layout wins, so no Grok layout.
    expect(byTitle["Two Buttons"]).toMatchObject({ src: "https://i.imgflip.com/1g8my4.jpg", imgflipId: "87743020", why: "election week" });
    expect(byTitle["Two Buttons"].slots).toBeUndefined();
    // New format from X: the blank post's photo, credited, with Grok's layout.
    expect(byTitle["Stare Cat"]).toMatchObject({
      src: "https://pbs.twimg.com/media/1901000000000000002.jpg",
      credit: { handle: "cats", url: "https://x.com/cats/status/1901000000000000002" },
    });
    expect(byTitle["Stare Cat"].slots[0]).toMatchObject({ label: "Cat", style: "label" });
    // imgflip template without a hand-made layout gets Grok's.
    expect(byTitle["Brand New Format"].slots).toHaveLength(1);
    // No findable original: skipped.
    expect(byTitle["No Original"]).toBeUndefined();
    // Grok saw the actual blank when placing boxes.
    const layoutCall = calls.find((c) => (c.body as { input?: { content?: { type: string; image_url?: string }[] }[] })?.input?.[0]?.content?.[0]?.image_url === "https://pbs.twimg.com/media/1901000000000000002.jpg");
    expect(layoutCall).toBeTruthy();
    const search = calls.find((c) => (c.body as { tools?: { type: string }[] })?.tools?.[0]?.type === "x_search");
    expect((search?.body as { tools: { enable_image_understanding: boolean }[] }).tools[0].enable_image_understanding).toBe(true);
  });
});

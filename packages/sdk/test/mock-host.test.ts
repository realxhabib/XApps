import { afterEach, describe, expect, it } from "vitest";
import { connect, resetConnection } from "../src/client";

afterEach(() => resetConnection());

describe("mock host (standalone mode)", () => {
  it("connects automatically when the page is not embedded", async () => {
    const client = await connect({ mock: { quiet: true, startDelayMs: 0 } });
    expect(client.match.mode).toBe("sandbox");
    expect(client.opponent?.isBot).toBe(true);

    const started = new Promise<number>((resolve) => client.onStart(resolve));
    await client.ready();
    await expect(started).resolves.toBeTypeOf("number");

    const ended = new Promise((resolve) => client.onEnd(resolve));
    const first = await client.submit({ score: 5 });
    expect(first.state).toBe("waiting");
    const bot = client.opponent!;
    await client.submitFor(bot.id, { score: 2 });
    await expect(ended).resolves.toMatchObject({ winnerId: "you", scores: { you: 5, bot: 2 } });
  });

  it("refuses to submit for a human opponent", async () => {
    const client = await connect({ mock: { quiet: true } });
    await expect(client.submitFor("nobody", { score: 1 })).rejects.toMatchObject({ code: "internal" });
  });

  it("throws when mock mode is disabled", async () => {
    await expect(connect({ mock: false })).rejects.toMatchObject({ code: "not_connected" });
  });
});

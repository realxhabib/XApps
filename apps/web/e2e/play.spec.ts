import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("practice match runs from intro to results", async ({ page }) => {
  await signIn(page, "practice_e2e");
  await page.goto("/apps/rps-showdown");
  await page.getByRole("button", { name: "Practice" }).click();
  await expect(page).toHaveURL(/\/play\//);

  const app = page.frameLocator("iframe");
  const results = page.getByRole("dialog", { name: /RPS Showdown/ });
  // First to two wins; ties replay the round, so allow plenty of rounds.
  for (let i = 0; i < 40 && !(await results.isVisible()); i++) {
    const paper = app.getByRole("button", { name: "Paper" });
    if (await paper.isEnabled().catch(() => false)) await paper.click();
    await page.waitForTimeout(1800);
  }
  await expect(results).toBeVisible({ timeout: 15_000 });
  await expect(results.getByRole("button", { name: "Rematch" })).toBeVisible();
  await expect(results.getByText(/XP/).first()).toBeVisible();
});

test("sandbox plays both seats of the example app", async ({ page }) => {
  await page.goto("/developers/sandbox");
  await page.getByRole("button", { name: "Launch" }).click();
  const one = page.frameLocator('iframe[title="Seat 1"]');
  const two = page.frameLocator('iframe[title="Seat 2"]');
  const winner = page.getByText("@player_one wins");
  await expect(one.getByRole("button", { name: "Rock" })).toBeEnabled({ timeout: 30_000 });
  for (let round = 0; round < 6 && !(await winner.isVisible()); round++) {
    await one.getByRole("button", { name: "Rock" }).click({ timeout: 8_000 }).catch(() => undefined);
    await two.getByRole("button", { name: "Scissors" }).click({ timeout: 8_000 }).catch(() => undefined);
    await page.waitForTimeout(1_500);
  }
  await expect(winner).toBeVisible();
});

test("two players duel live across tabs", async ({ context }) => {
  await context.addInitScript(() => {
    localStorage.setItem("xapps:force-demo", "1");
    sessionStorage.setItem("xapps:demo-banner", "hidden");
    sessionStorage.setItem("xapps:demo-invited", "1");
  });
  const suffix = Date.now().toString(36).slice(-4);
  const [alice, bob] = [await context.newPage(), await context.newPage()];
  for (const [page, handle] of [
    [alice, `alice${suffix}`],
    [bob, `bob${suffix}`],
  ] as const) {
    // A new tab starts as the last demo user; clear that to sign in as someone else.
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("xapps:demo-last-viewer"));
    await page.goto("/login");
    await page.getByLabel("Demo handle").fill(handle);
    await page.getByRole("button", { name: "Go" }).click();
    await expect(page).toHaveURL("/");
  }

  await alice.goto("/apps/rps-showdown");
  await alice.getByRole("button", { name: "Challenge someone" }).click();
  await alice.getByLabel("Search players by handle").fill(`bob${suffix}`);
  await alice.getByRole("button", { name: new RegExp(`@bob${suffix}`) }).click();
  await alice.getByRole("button", { name: `Challenge @bob${suffix}` }).click();
  await expect(alice).toHaveURL(/\/play\//);

  // Bob gets a live notification and accepts.
  await bob.getByRole("button", { name: "View" }).click();
  await bob.getByRole("button", { name: "Accept challenge" }).click();

  const a = alice.frameLocator("iframe");
  const b = bob.frameLocator("iframe");
  await expect(a.getByRole("button", { name: "Paper" })).toBeEnabled({ timeout: 30_000 });
  const victory = alice.getByRole("dialog", { name: /Victory/ });
  // After the deciding round the results overlay takes a moment, so tolerate
  // clicks on the (now disabled) buttons in the meantime.
  for (let round = 0; round < 6 && !(await victory.isVisible()); round++) {
    await a.getByRole("button", { name: "Paper" }).click({ timeout: 6_000 }).catch(() => undefined);
    await b.getByRole("button", { name: "Rock" }).click({ timeout: 6_000 }).catch(() => undefined);
    await alice.waitForTimeout(1_500);
  }
  await expect(victory).toBeVisible({ timeout: 15_000 });
  await expect(bob.getByRole("dialog", { name: /Defeat/ })).toBeVisible({ timeout: 15_000 });
});

test("four-player practice runs to a podium", async ({ page }) => {
  // Wedge Wars seats 2–4: the viewer locks in and three practice bots brawl it out until the 2:30 bell
  // at the latest. Headless WebGL is slow, so render at the lowest quality tier.
  test.setTimeout(420_000);
  await page.addInitScript(() => window.localStorage.setItem("wedge-wars:quality", "low"));
  await signIn(page, "podium_e2e");
  await page.goto("/apps/wedge-wars");
  await page.getByRole("radiogroup", { name: "Practice table size" }).getByRole("radio", { name: "4" }).click();
  await page.getByRole("button", { name: /^Practice/ }).click();
  await expect(page).toHaveURL(/\/play\//);

  const app = page.frameLocator("iframe");
  // Lock in once the garage is interactive (the button turns into "Locked in — waiting…").
  const lockIn = app.getByRole("button", { name: /^Lock in/ });
  await expect(async () => {
    await lockIn.click({ timeout: 20_000 });
    await expect(lockIn).toBeHidden({ timeout: 15_000 });
  }).toPass({ timeout: 120_000 });
  const results = page.getByRole("dialog", { name: /Wedge Wars/ });
  await expect(results).toBeVisible({ timeout: 240_000 });
  // Four seated players are ranked: the viewer plus three practice bots.
  await expect(results.getByText(/podium_e2e/).first()).toBeVisible();
});

test("history of a retired app still renders", async ({ page }) => {
  await signIn(page, "history_e2e");
  // Older demo data: a finished match of Trivia Royale, since retired.
  const matchId = await page.evaluate(() => {
    const key = "xapps:demo-db:v4";
    const db = JSON.parse(localStorage.getItem(key)!);
    const match = Object.values(db.matches as Record<string, { id: string; status: string; scoring: string; appSlug: string }>).find(
      (m) => m.status === "completed" && m.scoring !== "votes",
    )!;
    match.appSlug = "trivia-royale";
    localStorage.setItem(key, JSON.stringify(db));
    return match.id;
  });
  await page.goto(`/play/${matchId}`);
  await expect(page.getByRole("dialog", { name: /Trivia Royale/ })).toBeVisible();
  await page.goto("/apps/trivia-royale");
  await expect(page.getByText("Trivia Royale was retired")).toBeVisible();
  await page.goto("/apps");
  await expect(page.getByRole("link", { name: /Trivia Royale/ })).toHaveCount(0);
});

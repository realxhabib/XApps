import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("practice match runs from intro to results", async ({ page }) => {
  await signIn(page, "practice_e2e");
  await page.goto("/apps/rps-showdown");
  await page.getByRole("button", { name: "Practice" }).click();
  await expect(page).toHaveURL(/\/play\//);

  const app = page.frameLocator("iframe");
  const results = page.getByRole("dialog", { name: /RPS Showdown/ });
  for (let i = 0; i < 12 && !(await results.isVisible()); i++) {
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
  for (let round = 0; round < 3; round++) {
    await one.getByRole("button", { name: "Rock" }).click({ timeout: 15_000 }).catch(() => undefined);
    await two.getByRole("button", { name: "Scissors" }).click({ timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(1800);
  }
  await expect(page.getByText("@player_one wins")).toBeVisible();
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
  for (let round = 0; round < 4; round++) {
    if (await alice.getByRole("dialog").count()) break;
    await a.getByRole("button", { name: "Paper" }).click({ timeout: 10_000 });
    await b.getByRole("button", { name: "Rock" }).click({ timeout: 10_000 });
    await alice.waitForTimeout(2000);
  }
  await expect(alice.getByRole("dialog", { name: /Victory/ })).toBeVisible({ timeout: 15_000 });
  await expect(bob.getByRole("dialog", { name: /Defeat/ })).toBeVisible({ timeout: 15_000 });
});

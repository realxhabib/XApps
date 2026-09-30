import { expect, test } from "@playwright/test";

// Darts against the SDK's mock host: nine keyboard throws (hold Space to charge, release to throw),
// then the result settles against the practice bot.
test("Darts: a full game of nine darts settles", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/embed/darts");
  const game = page.getByTestId("darts-game");
  await expect(game).toBeVisible({ timeout: 60_000 });

  for (let dart = 1; dart <= 9; dart++) {
    await expect(game).toHaveAttribute("data-phase", "aim", { timeout: 15_000 });
    await page.keyboard.down("Space");
    await page.waitForTimeout(300);
    await page.keyboard.up("Space");
    await expect(game).toHaveAttribute("data-darts", String(dart), { timeout: 5_000 });
  }

  await expect(game).toHaveAttribute("data-phase", "done", { timeout: 15_000 });
  const panel = page.getByTestId("final-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Result locked in")).toBeVisible({ timeout: 60_000 });
  expect(errors).toEqual([]);
});

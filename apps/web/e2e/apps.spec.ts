import { expect, test } from "@playwright/test";
import { OFFICIAL_APPS } from "../src/platform/catalog";

// Every first-party app must boot against the SDK's standalone mock host
// (what a developer sees when opening /embed/<slug> directly) without errors.
for (const app of OFFICIAL_APPS.filter((a) => a.official)) {
  test(`${app.name} boots standalone without errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(app.url);
    await expect(page.locator("body")).not.toContainText("Couldn't reach XApps");
    await page.waitForTimeout(3000);
    expect(errors).toEqual([]);
  });
}

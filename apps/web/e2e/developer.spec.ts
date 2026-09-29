import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("a developer ships a new version through review", async ({ page }) => {
  test.setTimeout(150_000);
  const suffix = String(Date.now()).slice(-6);
  const slug = `tap-race-${suffix}`;
  await signIn(page, `dev${suffix}`);

  // Register (demo mode publishes 1.0.0 right away).
  await page.goto("/developers/new");
  await page.getByPlaceholder("Tap Race").fill(`Tap Race ${suffix}`);
  await page.getByPlaceholder("Ten seconds. Fastest thumbs win.").fill("Ten seconds. Fastest thumbs win.");
  await page.getByPlaceholder("https://tap-race.dev").fill("http://localhost:3000/examples/rps/index.html");
  // Icon: an emoji or an uploaded image. The image is cropped, re-encoded and stored, then shown instead of the emoji.
  await page.getByRole("tab", { name: "Image" }).click();
  await expect(page.getByRole("button", { name: "Icon 🎯" })).toHaveCount(0);
  await page.getByLabel("Upload icon").setInputFiles(resolve("e2e/fixtures/app-icon.jpg"));
  await expect(page.getByRole("button", { name: "Replace icon" })).toBeVisible({ timeout: 15_000 });
  // Back to Emoji drops the image; Image again brings it back.
  await page.getByRole("tab", { name: "Emoji" }).click();
  await expect(page.getByRole("button", { name: "Icon 🎯" })).toBeVisible();
  await page.getByRole("tab", { name: "Image" }).click();
  await expect(page.getByRole("button", { name: "Replace icon" })).toBeVisible();
  await page.getByRole("button", { name: "Submit app" }).click();
  await expect(page.getByText(/1\.0\.0/).first()).toBeVisible({ timeout: 15_000 });
  await page.goto(`/apps/${slug}`);
  await expect(page.getByRole("img", { name: `Tap Race ${suffix}` }).first().locator("img")).toHaveAttribute("src", /^data:image\/(webp|jpeg);base64,/);

  // Console → new minor version → submit for review.
  await page.goto(`/developers/apps/${slug}?tab=versions`);
  await page.getByRole("button", { name: "New version" }).click();
  await page.getByRole("button", { name: /minor/i }).click();
  await page.getByLabel("Tagline").fill("Ten seconds. Fastest thumbs win. Now with streaks.");
  await page.getByPlaceholder("New power-ups, fixed the timer on slow phones.").fill("Adds a streak stat.");
  await page.getByRole("button", { name: /Save & submit for review/ }).click();
  await expect(page.getByText(/in review/i).first()).toBeVisible({ timeout: 10_000 });

  // Editing the submission sends 1.1.1 in its place.
  await page.getByRole("button", { name: "Edit submission" }).click();
  await expect(page.getByText("Your changes are submitted as v1.1.1, which replaces v1.1.0 in the review queue.")).toBeVisible();
  await page.getByLabel("Tagline").fill("Ten seconds. Fastest thumbs win. Now with streaks!");
  await page.getByRole("button", { name: "Submit v1.1.1" }).click();
  await expect(page.getByText("Replaced by v1.1.1 in the review queue.")).toBeVisible({ timeout: 10_000 });

  // Admin approves (demo lets you become an admin).
  await page.goto("/admin/review");
  const become = page.getByRole("button", { name: "Become admin (demo)" });
  await expect(become.or(page.getByRole("button", { name: new RegExp(`Tap Race ${suffix}`) }).first())).toBeVisible({ timeout: 15_000 });
  if (await become.isVisible()) await become.click();
  // Only the latest submission is queued.
  await expect(page.getByRole("button", { name: new RegExp(`Tap Race ${suffix}`) })).toHaveCount(1);
  await page.getByRole("button", { name: new RegExp(`Tap Race ${suffix}.*1\\.1\\.1`) }).first().click();
  await expect(page.getByText(/this replaces v1\.1\.0, which left the queue/)).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).first().click();
  // Reviewing your own live app approves and publishes in one step.
  await page.getByRole("dialog").getByRole("button", { name: "Approve & publish" }).click();
  await expect(page.getByText(/is live/).first()).toBeVisible({ timeout: 10_000 });
  await page.goto(`/developers/apps/${slug}?tab=versions`);
  await expect(page.getByText(/1\.1\.1/).first()).toBeVisible();
  await page.goto(`/apps/${slug}`);
  await expect(page.getByText("Ten seconds. Fastest thumbs win. Now with streaks!").first()).toBeVisible({ timeout: 15_000 });
});

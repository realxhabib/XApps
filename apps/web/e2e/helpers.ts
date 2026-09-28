import { expect, type Page } from "@playwright/test";

/** Every e2e test runs against the local demo backend, whatever .env.local says. */
export async function enableDemo(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("xapps:force-demo", "1");
    window.sessionStorage.setItem("xapps:demo-banner", "hidden");
  });
}

export async function signIn(page: Page, handle: string) {
  await enableDemo(page);
  await page.goto("/login");
  await page.getByLabel("Demo handle").fill(handle);
  await page.getByRole("button", { name: "Go" }).click();
  await expect(page).toHaveURL("/");
}

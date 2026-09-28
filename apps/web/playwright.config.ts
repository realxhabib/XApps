import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 860 },
  },
  webServer: {
    command: "npm run dev -- --port 3000",
    url: baseURL,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e/specs",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  // Extension tests cannot be parallelised — each test needs exclusive use of the browser context
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    // Individual test fixtures configure the browser context with the extension loaded
    launchOptions: {
      args: ["--no-focus-on-start", "--no-first-run"]
    }
  }
});

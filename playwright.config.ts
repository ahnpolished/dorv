import { defineConfig } from "@playwright/test";

export default defineConfig({
  // Extension tests cannot be parallelised — each test needs exclusive use of the browser context
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  projects: [
    {
      name: "mocked",
      testDir: "./tests/e2e/specs",
      timeout: 60_000,
      retries: process.env.CI ? 1 : 0
    },
    {
      name: "real",
      testDir: "./tests/e2e/real",
      timeout: 120_000,
      retries: 0
    }
  ]
});

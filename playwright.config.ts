import { defineConfig } from "@playwright/test";
import fs from "fs";

// Load .env.test.local into process.env — sourcing without `export` doesn't propagate to child processes.
// ??= keeps shell-exported values (DORV_GITHUB_PAT in .zshrc etc.) from being overwritten.
try {
  const lines = fs.readFileSync(".env.test.local", "utf8").split("\n");
  for (const line of lines) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m?.[1]) process.env[m[1]] ??= m[2] ?? "";
  }
} catch {
  /* file absent is fine */
}

export default defineConfig({
  globalSetup: "./tests/global-setup.ts",
  // Real tests share a single Google account + PR — must stay sequential.
  // Mocked tests are fully isolated per worker; pass --workers=N to parallelize.
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

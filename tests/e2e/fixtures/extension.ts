import { test as base, chromium } from "@playwright/test";
import type { BrowserContext, Worker } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const EXTENSION_PATH = path.resolve(__dirname, "../../../apps/extension/.output/chrome-mv3");

// Fake PR coordinates used across all E2E tests
export const TEST_PR = {
  owner: "ahnpolished",
  repo: "dorv",
  prNumber: 42,
  ref: "ahnpolished/dorv",
  url: "https://github.com/ahnpolished/dorv/pull/42"
} as const;

// Worker-scoped fixtures (shared across all tests in a worker)
interface WorkerFixtures {
  extensionContext: BrowserContext;
  extensionId: string;
  extensionWorker: Worker;
}

// Test-scoped fixtures (fresh per test)
interface TestFixtures {
  seedStorage: (data: Record<string, unknown>) => Promise<void>;
  /** Patch chrome.identity.getAuthToken in the service worker context. */
  patchWorkerIdentity: (googleToken?: string) => Promise<void>;
  /** Send SYNC_NOW from an extension page (the only context with chrome.runtime). */
  triggerSync: () => Promise<void>;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  // --- Worker-scoped ---

  extensionContext: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      // Extensions require headless:false; wrap with xvfb-run in CI
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dorv-e2e-"));
      const ctx = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          `--disable-extensions-except=${EXTENSION_PATH}`,
          `--load-extension=${EXTENSION_PATH}`,
          "--no-focus-on-start",
          "--no-first-run"
        ]
      });

      // Signal to the extension that we are running in an E2E test
      const [worker] = ctx.serviceWorkers();
      if (worker) {
        await worker.evaluate(() => {
          return new Promise<void>((resolve) => {
            chrome.storage.local.set({ is_playwright: true }, resolve);
          });
        });
      } else {
        ctx.on("serviceworker", (sw) => {
          void sw.evaluate(() => {
            return new Promise<void>((resolve) => {
              chrome.storage.local.set({ is_playwright: true }, resolve);
            });
          });
        });
      }

      await use(ctx);
      await ctx.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    },
    { scope: "worker" }
  ],

  extensionId: [
    async ({ extensionContext }, use) => {
      let worker = extensionContext.serviceWorkers()[0];
      worker ??= await extensionContext.waitForEvent("serviceworker");
      const extensionId = worker.url().split("/")[2] ?? "";
      await use(extensionId);
    },
    { scope: "worker" }
  ],

  extensionWorker: [
    async ({ extensionContext }, use) => {
      let worker = extensionContext.serviceWorkers()[0];
      worker ??= await extensionContext.waitForEvent("serviceworker");
      await use(worker);
    },
    { scope: "worker" }
  ],

  // --- Test-scoped ---

  seedStorage: async ({ extensionWorker }, use) => {
    const seededKeys: string[] = [];
    const seed = async (data: Record<string, unknown>) => {
      await extensionWorker.evaluate((d: Record<string, unknown>) => {
        return new Promise<void>((resolve) => {
          chrome.storage.local.set(d, resolve);
        });
      }, data);
      seededKeys.push(...Object.keys(data));
    };
    await use(seed);
    if (seededKeys.length > 0) {
      await extensionWorker.evaluate((keys: string[]) => {
        return new Promise<void>((resolve) => {
          chrome.storage.local.remove(keys, resolve);
        });
      }, seededKeys);
    }
  },

  // Patch chrome.identity.getAuthToken in the SERVICE WORKER only.
  // context.route() handles all network-level API mocking (pages + SW fetch calls).
  patchWorkerIdentity: async ({ extensionWorker }, use) => {
    const patch = async (googleToken = "fake-google-token-e2e") => {
      await extensionWorker.evaluate((token: string) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        (chrome.identity as any).getAuthToken = (_opts: unknown, callback: (t: string) => void) => {
          callback(token);
        };
      }, googleToken);
    };
    await use(patch);
  },

  // Sends SYNC_NOW from the options extension page (which has chrome.runtime access).
  triggerSync: async ({ extensionContext, extensionId }, use) => {
    const trigger = async () => {
      const page = await extensionContext.newPage();
      // Navigate to any extension page — options page is convenient
      await page.goto(`chrome-extension://${extensionId}/options.html`, {
        waitUntil: "domcontentloaded"
      });
      await page.evaluate(() => {
        return new Promise<void>((resolve) => {
          chrome.runtime.sendMessage({ type: "SYNC_NOW", payload: null }, () => {
            resolve();
          });
        });
      });
      await page.close();
    };
    await use(trigger);
  }
});

export { expect } from "@playwright/test";

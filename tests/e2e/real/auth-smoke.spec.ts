/**
 * Real-credential auth smoke tests — no persistent artifacts created.
 *
 * TC-013: Extension Loads — background service worker responds to a
 *         message round-trip (replaces the old sidepanel-viewport-overflow
 *         check now that there is no sidepanel; button-injection UI has
 *         its own coverage in tests/github-button-injection.test.ts).
 * TC-011: Token Expiry — graceful error state when Google token is empty
 *
 * Run:  DORV_GITHUB_PAT=... DORV_GOOGLE_TOKEN=... pnpm e2e:real --grep "TC-01[13]"
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { test, expect, fetchRealPrMeta, REAL_REPO, REAL_PR_NUMBER } from "./fixture.js";

function isGitHubRateLimitMessage(message: string): boolean {
  return (
    message.includes("rate limit") ||
    message.includes("API rate limit exceeded") ||
    message.includes("403")
  );
}

test.describe("auth smoke", () => {
  test("TC-013: background responds to a GET_SYNC_STATUS message round-trip", async ({
    extensionContext
  }) => {
    // Chrome v130+ redirects ALL extension-page navigations in Playwright,
    // so we send messages directly from the SW context.
    const worker =
      extensionContext.serviceWorkers()[0] ??
      (await extensionContext.waitForEvent("serviceworker"));
    const response = await worker.evaluate(
      ([repo, prNumber]) => {
        return new Promise<{ success: boolean }>((resolve) => {
          chrome.runtime.sendMessage(
            { type: "GET_SYNC_STATUS", payload: { repo, prNumber } },
            resolve
          );
        });
      },
      [REAL_REPO, REAL_PR_NUMBER] as const
    );
    expect(response.success, "background must respond successfully to GET_SYNC_STATUS").toBe(true);
  });

  test("TC-011: empty Google token results in error sync state", async ({
    extensionWorker,
    triggerSync
  }) => {
    const repo = REAL_REPO;
    const prNumber = REAL_PR_NUMBER;
    let meta;
    try {
      meta = await fetchRealPrMeta();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isGitHubRateLimitMessage(msg)) {
        test.skip(true, `GitHub rate limited: ${msg}`);
        return;
      }
      throw err;
    }
    const docStoreKey = `docStore:${repo}#${prNumber.toString()}`;

    // Seed active_prs plus a real-shaped doc mapping so syncAll attempts Drive/Docs access.
    await extensionWorker.evaluate(
      ([r, n, key, mapping]) => {
        return new Promise<void>((resolve) => {
          chrome.storage.local.set(
            { active_prs: [{ repo: r, prNumber: n }], [key]: mapping },
            resolve
          );
        });
      },
      [
        repo,
        prNumber,
        docStoreKey,
        {
          repo,
          prNumber,
          docs: [
            {
              filename: "expired-token-smoke.md",
              docId: "expired-token-smoke-doc-id",
              docUrl: "https://docs.google.com/document/d/expired-token-smoke-doc-id/edit"
            }
          ],
          createdAt: new Date().toISOString(),
          lastSyncedAt: new Date().toISOString(),
          headSha: meta.headSha,
          latestSha: meta.headSha,
          isStale: false
        }
      ] as const
    );

    // Override Google token to simulate expiry (realAuth already seeded the PAT)
    await extensionWorker.evaluate(() => {
      (chrome.identity as any).getAuthToken = (_opts: unknown, callback: (t: string) => void) => {
        callback("");
      };
    });

    await triggerSync();
    // Wait for sync error to propagate to storage
    await extensionWorker.evaluate(() => new Promise((r) => setTimeout(r, 6_000)));

    const storage = await extensionWorker.evaluate<Record<string, unknown>>(
      () =>
        new Promise((resolve) => {
          chrome.storage.local.get(null, resolve);
        })
    );

    const statusKey = `statusStore:${repo}#${prNumber.toString()}`;
    const status = storage[statusKey] as { state?: string } | undefined;
    expect(status, "status entry must exist after sync attempt").toBeDefined();
    expect(status?.state, "sync must end in error state when Google token is empty").toBe("error");
  });
});

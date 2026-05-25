/**
 * Real-credential auth smoke tests — no persistent artifacts created.
 *
 * TC-013: Sidepanel Responsiveness — no horizontal overflow at 320/480/720 px
 * TC-011: Token Expiry — graceful error state when Google token is empty
 *
 * Run:  DORV_GITHUB_PAT=... DORV_GOOGLE_TOKEN=... pnpm e2e:real --grep "TC-01[13]"
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  test,
  expect,
  openSidepanelOnRealPr,
  fetchRealPrMeta,
  REAL_REPO,
  REAL_PR_NUMBER
} from "./fixture.js";

test.describe("auth smoke", () => {
  test("TC-013: sidepanel has no horizontal overflow at narrow widths", async ({
    extensionContext,
    extensionId
  }) => {
    const panel = await openSidepanelOnRealPr(extensionContext, extensionId);

    // Wait for onboarding check to pass and initial render
    await panel.waitForSelector(".dorv-sidepanel", { timeout: 15_000 });

    for (const width of [320, 480, 720]) {
      await panel.setViewportSize({ width, height: 800 });
      // Give React one frame to reflow
      await panel.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
      const { scrollWidth, innerWidth } = await panel.evaluate(() => ({
        scrollWidth: document.body.scrollWidth,
        innerWidth: window.innerWidth
      }));
      expect(scrollWidth, `horizontal overflow at ${width.toString()}px`).toBeLessThanOrEqual(
        innerWidth + 2
      );
    }

    await panel.close();
  });

  test("TC-011: empty Google token results in error sync state", async ({
    extensionWorker,
    triggerSync
  }) => {
    const repo = REAL_REPO;
    const prNumber = REAL_PR_NUMBER;
    const meta = await fetchRealPrMeta();
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
          docId: "expired-token-smoke-doc-id",
          docUrl: "https://docs.google.com/document/d/expired-token-smoke-doc-id/edit",
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

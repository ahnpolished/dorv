/**
 * TC-019: Neutral view — sidepanel opened on a non-PR, non-GDoc page.
 *
 * AC:
 *   - When no past docs exist: shows neutral message "Open a GitHub PR or linked
 *     Google Doc to get started."
 *   - When past docs exist: shows "Recent reviews" heading with a list
 *   - Each past doc item has a GitHub PR link and an "Open Doc" link
 */
import { expect, test } from "../fixtures/extension.js";
import { setupPageRoutes } from "../fixtures/mock-apis.js";

const TIMEOUT = 15_000;

test("TC-019a: neutral view with no past docs shows neutral message", async ({
  extensionContext,
  extensionId,
  seedStorage,
  patchWorkerIdentity
}) => {
  // Seed auth but no doc mappings → pastDocs is empty
  await seedStorage({ github_pat: "ghp_test_pat_for_e2e" });
  await patchWorkerIdentity();
  await setupPageRoutes(extensionContext, { ghReviewComments: [] });

  const panel = await extensionContext.newPage();
  // Init script that returns a non-PR, non-GDoc URL
  await panel.addInitScript(() => {
    (chrome.tabs as Record<string, unknown>).query = (
      _filter: unknown,
      callback?: (tabs: { url: string; id: number }[]) => void
    ) => {
      const fakeTab = [{ url: "https://example.com/some-page", id: 2 }];
      if (typeof callback === "function") {
        callback(fakeTab);
        return;
      }
      return Promise.resolve(fakeTab);
    };
    (chrome.identity as Record<string, unknown>).getAuthToken = (
      _opts: unknown,
      callback: (token: string) => void
    ) => {
      callback("fake-google-token-e2e");
    };
  });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
    waitUntil: "domcontentloaded"
  });

  // Neutral view renders
  await expect(panel.locator("[data-testid='dorv-neutral']")).toBeVisible({ timeout: TIMEOUT });

  // Neutral message shown when no past docs
  await expect(panel.locator("[data-testid='dorv-neutral-msg']")).toBeVisible();
  await expect(panel.locator("[data-testid='dorv-neutral-msg']")).toContainText(
    "Open a GitHub PR or linked Google Doc to get started."
  );

  // Past docs heading and list should not appear
  await expect(panel.locator("[data-testid='dorv-past-docs-heading']")).not.toBeVisible();
  await expect(panel.locator("[data-testid='dorv-past-docs-list']")).not.toBeVisible();

  await panel.close();
});

test("TC-019b: neutral view with past docs shows recent reviews list", async ({
  extensionContext,
  extensionId,
  seedStorage,
  patchWorkerIdentity
}) => {
  const pastDocId1 = "past-doc-aaa";
  const pastDocId2 = "past-doc-bbb";
  const now = new Date().toISOString();

  // Seed doc mappings so buildPastDocsList returns them
  await seedStorage({
    github_pat: "ghp_test_pat_for_e2e",
    active_prs: [
      { repo: "owner1/repo1", prNumber: 1 },
      { repo: "owner2/repo2", prNumber: 42 }
    ],
    [`docStore:owner1/repo1#1`]: {
      repo: "owner1/repo1",
      prNumber: 1,
      docId: pastDocId1,
      docUrl: `https://docs.google.com/document/d/${pastDocId1}/edit`,
      createdAt: now,
      lastSyncedAt: now,
      headSha: "abc",
      latestSha: "abc",
      isStale: false
    },
    [`docStore:owner2/repo2#42`]: {
      repo: "owner2/repo2",
      prNumber: 42,
      docId: pastDocId2,
      docUrl: `https://docs.google.com/document/d/${pastDocId2}/edit`,
      createdAt: now,
      lastSyncedAt: now,
      headSha: "def",
      latestSha: "def",
      isStale: false
    }
  });
  await patchWorkerIdentity();
  await setupPageRoutes(extensionContext, { ghReviewComments: [] });

  const panel = await extensionContext.newPage();
  await panel.addInitScript(() => {
    (chrome.tabs as Record<string, unknown>).query = (
      _filter: unknown,
      callback?: (tabs: { url: string; id: number }[]) => void
    ) => {
      const fakeTab = [{ url: "https://example.com", id: 2 }];
      if (typeof callback === "function") {
        callback(fakeTab);
        return;
      }
      return Promise.resolve(fakeTab);
    };
    (chrome.identity as Record<string, unknown>).getAuthToken = (
      _opts: unknown,
      callback: (token: string) => void
    ) => {
      callback("fake-google-token-e2e");
    };
  });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
    waitUntil: "domcontentloaded"
  });

  // Neutral view renders
  await expect(panel.locator("[data-testid='dorv-neutral']")).toBeVisible({ timeout: TIMEOUT });

  // Past docs heading and list visible
  await expect(panel.locator("[data-testid='dorv-past-docs-heading']")).toBeVisible();
  await expect(panel.locator("[data-testid='dorv-past-docs-heading']")).toContainText(
    "Recent reviews"
  );
  await expect(panel.locator("[data-testid='dorv-past-docs-list']")).toBeVisible();

  // Each past doc item rendered
  await expect(panel.locator(`[data-testid='dorv-past-doc-${pastDocId1}']`)).toBeVisible();
  await expect(panel.locator(`[data-testid='dorv-past-doc-${pastDocId2}']`)).toBeVisible();

  // Each item has a GitHub link and an "Open Doc" link
  const firstItem = panel.locator(`[data-testid='dorv-past-doc-${pastDocId1}']`);
  await expect(firstItem.locator("a[href*='github.com']")).toContainText("owner1/repo1#1");
  await expect(firstItem.locator("a[href*='docs.google.com']")).toContainText("Open Doc");

  // Neutral message should not appear when past docs exist
  await expect(panel.locator("[data-testid='dorv-neutral-msg']")).not.toBeVisible();

  await panel.close();
});

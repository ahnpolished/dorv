/**
 * TC-012 Concurrent Edits      — two rapid SYNC_NOW triggers produce ≤ 1 Drive comment POST (idempotent)
 * TC-013 Responsiveness        — sidepanel has no horizontal overflow at 320/480/720 px
 * TC-014 Sync Indicator        — .dorv-spinning class present on refresh icon while sync is in-flight
 * TC-015 Deep Link             — GH comment anchor link href matches the expected GitHub URL
 */
import { expect, test, TEST_PR } from "../fixtures/extension.js";
import {
  setupPageRoutes,
  FAKE_GH_REVIEW_COMMENTS,
  FAKE_GDOC_COMMENTS
} from "../fixtures/mock-apis.js";

const TIMEOUT = 20_000;

const BASE_DOC_MAPPING = {
  repo: TEST_PR.ref,
  prNumber: TEST_PR.prNumber,
  docId: "fake-doc-id-123",
  docUrl: "https://docs.google.com/document/d/fake-doc-id-123/edit",
  createdAt: "2026-05-17T10:00:00Z",
  lastSyncedAt: "2026-05-17T10:00:00Z",
  headSha: "abc123def456",
  latestSha: "abc123def456",
  isStale: false
};

const BASE_STATUS = { repo: TEST_PR.ref, prNumber: TEST_PR.prNumber, state: "idle" };
const STATUS_KEY = `statusStore:${TEST_PR.ref}#${TEST_PR.prNumber.toString()}`;

/**
 * Open the sidepanel and patch chrome.tabs.query so it behaves as if the
 * active tab is the fake GH PR page. Must be called BEFORE goto() so the
 * init-script runs before the React tree mounts.
 */
async function openSidepanelOnPR(
  extensionContext: import("@playwright/test").BrowserContext,
  extensionId: string
): Promise<import("@playwright/test").Page> {
  const panel = await extensionContext.newPage();
  await panel.addInitScript(
    ({ prUrl, tabId, googleToken }) => {
      const fakeTab = [{ url: prUrl, id: tabId }];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (chrome.tabs as any).query = (
        _filter: unknown,
        callback?: (tabs: { url: string; id: number }[]) => void
      ) => {
        if (typeof callback === "function") {
          callback(fakeTab);
          return;
        }
        return Promise.resolve(fakeTab);
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (chrome.identity as any).getAuthToken = (
        _opts: unknown,
        callback: (token: string) => void
      ) => {
        callback(googleToken);
      };
    },
    { prUrl: TEST_PR.url, tabId: 1, googleToken: "fake-google-token-e2e" }
  );
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
    waitUntil: "domcontentloaded"
  });
  return panel;
}

test("TC-012: concurrent SYNC_NOW triggers are idempotent — no duplicate Drive comment POST", async ({
  extensionContext,
  extensionWorker,
  seedStorage,
  patchWorkerIdentity,
  triggerSync
}) => {
  const docMappingKey = `docStore:${TEST_PR.ref}#${TEST_PR.prNumber.toString()}`;
  await seedStorage({
    github_pat: "ghp_test_pat_for_e2e",
    active_prs: [{ repo: TEST_PR.ref, prNumber: TEST_PR.prNumber }],
    [docMappingKey]: BASE_DOC_MAPPING
  });
  await patchWorkerIdentity();

  // Register base routes first; the capturing route below wins via LIFO
  await setupPageRoutes(extensionContext, { ghReviewComments: FAKE_GH_REVIEW_COMMENTS });

  let drivePostCount = 0;
  await extensionContext.route("https://www.googleapis.com/drive/v3/files/*/comments*", (route) => {
    if (route.request().method() === "POST") {
      drivePostCount++;
    }
    void route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: `doc-comment-${drivePostCount.toString()}` })
    });
  });

  // Fire both syncs concurrently without awaiting the first
  await Promise.all([triggerSync(), triggerSync()]);
  // Allow both syncs to settle and any pending storage writes to complete
  await extensionWorker.evaluate(() => new Promise((r) => setTimeout(r, 5000)));

  // A second sync for an already-mapped GH comment must not create a duplicate Drive POST
  expect(drivePostCount, "Drive comment POST count must not exceed 1").toBeLessThanOrEqual(1);
});

test("TC-013: sidepanel has no horizontal overflow at narrow widths", async ({
  extensionContext,
  extensionId,
  seedStorage,
  patchWorkerIdentity
}) => {
  const docMappingKey = `docStore:${TEST_PR.ref}#${TEST_PR.prNumber.toString()}`;
  await seedStorage({
    github_pat: "ghp_test_pat_for_e2e",
    [docMappingKey]: BASE_DOC_MAPPING,
    [STATUS_KEY]: BASE_STATUS,
    sidepanel_query_cache_snapshot: null
  });
  await patchWorkerIdentity();
  await setupPageRoutes(extensionContext, { ghReviewComments: FAKE_GH_REVIEW_COMMENTS });

  const panel = await openSidepanelOnPR(extensionContext, extensionId);
  // Wait for the main panel to load before measuring layout
  await expect(panel.locator("button", { hasText: "GitHub" })).toBeVisible({ timeout: TIMEOUT });

  for (const width of [320, 480, 720]) {
    await panel.setViewportSize({ width, height: 600 });
    const isOverflowing = await panel.evaluate(
      () =>
        Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) >
        window.innerWidth
    );
    expect(isOverflowing, `Horizontal overflow detected at ${width.toString()}px`).toBe(false);
  }

  await panel.close();
});

test("TC-014: .dorv-spinning class appears on refresh icon while sync is in-flight", async ({
  extensionContext,
  extensionId,
  seedStorage,
  patchWorkerIdentity
}) => {
  const docMappingKey = `docStore:${TEST_PR.ref}#${TEST_PR.prNumber.toString()}`;
  await seedStorage({
    github_pat: "ghp_test_pat_for_e2e",
    [docMappingKey]: BASE_DOC_MAPPING,
    [STATUS_KEY]: BASE_STATUS,
    sidepanel_query_cache_snapshot: null
  });
  await patchWorkerIdentity();

  // Register base routes first; the slow-GET override below wins via LIFO
  await setupPageRoutes(extensionContext, { ghReviewComments: FAKE_GH_REVIEW_COMMENTS });

  let driveGetCount = 0;
  await extensionContext.route(
    "https://www.googleapis.com/drive/v3/files/*/comments*",
    async (route) => {
      if (route.request().method() === "GET") {
        driveGetCount++;
        if (driveGetCount > 1) {
          // Delay sync-triggered re-fetches so the spinner is observable
          await new Promise<void>((r) => setTimeout(r, 1500));
        }
      }
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FAKE_GDOC_COMMENTS)
      });
    }
  );

  const panel = await openSidepanelOnPR(extensionContext, extensionId);
  // Wait for initial load so driveGetCount === 1 before clicking Sync
  await expect(panel.locator("button", { hasText: "GitHub" })).toBeVisible({ timeout: TIMEOUT });
  await expect(panel.locator("button.sync-now-btn")).toBeVisible({ timeout: TIMEOUT });

  await panel.locator("button.sync-now-btn").click();

  // The refresh icon acquires .dorv-spinning while handleManualSync is in-flight
  await expect(panel.locator("i.ti-refresh")).toHaveClass(/dorv-spinning/, { timeout: 5000 });
  // And loses it once the sync completes
  await expect(panel.locator("i.ti-refresh")).not.toHaveClass(/dorv-spinning/, {
    timeout: TIMEOUT
  });

  await panel.close();
});

test("TC-015: GitHub comment anchor link has correct href", async ({
  extensionContext,
  extensionId,
  seedStorage,
  patchWorkerIdentity
}) => {
  const docMappingKey = `docStore:${TEST_PR.ref}#${TEST_PR.prNumber.toString()}`;
  await seedStorage({
    github_pat: "ghp_test_pat_for_e2e",
    [docMappingKey]: BASE_DOC_MAPPING,
    [STATUS_KEY]: BASE_STATUS,
    sidepanel_query_cache_snapshot: null
  });
  await patchWorkerIdentity();
  await setupPageRoutes(extensionContext, { ghReviewComments: FAKE_GH_REVIEW_COMMENTS });

  const panel = await openSidepanelOnPR(extensionContext, extensionId);
  // GitHub tab is active by default; wait for a comment card to render
  await expect(panel.locator("button", { hasText: "GitHub" })).toBeVisible({ timeout: TIMEOUT });
  await expect(panel.locator(".comment-card").first()).toBeVisible({ timeout: TIMEOUT });

  const link = panel.locator('a[aria-label="Open GitHub comment"]').first();
  await expect(link).toBeVisible({ timeout: TIMEOUT });

  const firstComment = FAKE_GH_REVIEW_COMMENTS[0];
  if (!firstComment) throw new Error("FAKE_GH_REVIEW_COMMENTS is empty");

  const href = await link.getAttribute("href");
  expect(href).toBe(firstComment.html_url);

  await panel.close();
});

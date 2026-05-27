/**
 * TC-017: Tab switching between GitHub, Google Doc, and Activities tabs.
 *
 * AC:
 *   - GitHub tab is active by default when sidepanel opens on linked PR
 *   - Clicking "Google Doc" tab activates it and shows GDoc comments
 *   - Clicking "Activities" tab activates it and shows empty or populated feed
 *   - Clicking back to "GitHub" tab shows GH comments again
 *   - Active tab has the "active" CSS class applied
 *   - Inactive tabs do not have the "active" class
 */
import { expect, test, TEST_PR } from "../fixtures/extension.js";
import {
  setupPageRoutes,
  FAKE_GH_REVIEW_COMMENTS,
  FAKE_GDOC_COMMENTS
} from "../fixtures/mock-apis.js";

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
const TIMEOUT = 15_000;

async function openSidepanelOnPR(
  extensionContext: import("@playwright/test").BrowserContext,
  extensionId: string
): Promise<import("@playwright/test").Page> {
  const panel = await extensionContext.newPage();
  await panel.addInitScript(
    ({ prUrl, tabId, googleToken }) => {
      const fakeTab = [{ url: prUrl, id: tabId }];
      (chrome.tabs as Record<string, unknown>).query = (
        _filter: unknown,
        callback?: (tabs: { url: string; id: number }[]) => void
      ) => {
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

test("TC-017: clicking each tab shows correct content and active class is applied", async ({
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
  await setupPageRoutes(extensionContext, {
    ghReviewComments: FAKE_GH_REVIEW_COMMENTS,
    gdocComments: FAKE_GDOC_COMMENTS
  });

  const panel = await openSidepanelOnPR(extensionContext, extensionId);

  // Wait for main panel to load
  await expect(panel.locator("[data-testid='dorv-main-panel']")).toBeVisible({ timeout: TIMEOUT });

  // --- GitHub tab (active by default) ---
  await expect(panel.locator("[data-testid='dorv-tab-github']")).toHaveClass(/active/);
  await expect(panel.locator("[data-testid='dorv-tab-gdoc']")).not.toHaveClass(/active/);
  await expect(panel.locator("[data-testid='dorv-tab-activities']")).not.toHaveClass(/active/);
  await expect(panel.locator("[data-testid='dorv-gh-comments']")).toBeVisible({ timeout: TIMEOUT });
  await expect(panel.locator("[data-testid='dorv-gdoc-comments']")).not.toBeVisible();
  await expect(panel.locator("[data-testid='dorv-activities']")).not.toBeVisible();

  // --- Google Doc tab ---
  await panel.locator("[data-testid='dorv-tab-gdoc']").click();
  await expect(panel.locator("[data-testid='dorv-tab-gdoc']")).toHaveClass(/active/);
  await expect(panel.locator("[data-testid='dorv-tab-github']")).not.toHaveClass(/active/);
  await expect(panel.locator("[data-testid='dorv-tab-activities']")).not.toHaveClass(/active/);
  await expect(panel.locator("[data-testid='dorv-gdoc-comments']")).toBeVisible({
    timeout: TIMEOUT
  });
  await expect(panel.locator("[data-testid='dorv-gh-comments']")).not.toBeVisible();
  await expect(panel.locator("[data-testid='dorv-activities']")).not.toBeVisible();

  // GDoc heading shows comment count
  await expect(panel.locator("[data-testid='dorv-gdoc-heading']")).toContainText(
    "New GDoc Comments"
  );

  // --- Activities tab ---
  await panel.locator("[data-testid='dorv-tab-activities']").click();
  await expect(panel.locator("[data-testid='dorv-tab-activities']")).toHaveClass(/active/);
  await expect(panel.locator("[data-testid='dorv-tab-github']")).not.toHaveClass(/active/);
  await expect(panel.locator("[data-testid='dorv-tab-gdoc']")).not.toHaveClass(/active/);
  await expect(panel.locator("[data-testid='dorv-activities']")).toBeVisible({ timeout: TIMEOUT });
  await expect(panel.locator("[data-testid='dorv-gh-comments']")).not.toBeVisible();
  await expect(panel.locator("[data-testid='dorv-gdoc-comments']")).not.toBeVisible();

  // Activities content is visible (either empty state or activity cards)

  // --- Back to GitHub ---
  await panel.locator("[data-testid='dorv-tab-github']").click();
  await expect(panel.locator("[data-testid='dorv-tab-github']")).toHaveClass(/active/);
  await expect(panel.locator("[data-testid='dorv-gh-comments']")).toBeVisible({ timeout: TIMEOUT });

  await panel.close();
});

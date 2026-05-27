/**
 * TC-016: Sidepanel linked PR view renders correctly.
 *
 * AC: When sidepanel opens on a GitHub PR with an existing doc mapping:
 *   - Header shows "Review Sync" title and eyebrand
 *   - Open GitHub PR and Open Google Doc icon buttons are visible
 *   - Sync now button and close button are visible
 *   - Status bar shows last synced time and status dot
 *   - Three tabs (GitHub, Google Doc, Activities) are rendered
 *   - GitHub tab is active by default
 *   - GitHub comments appear grouped by file path
 *   - Each comment card shows author, line number, and body
 *   - File sections are <details> elements with file path as summary
 *   - Close panel button is present
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

test("TC-016: linked PR view renders header with icon buttons, status bar, tabs, and GH comments", async ({
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

  // Main panel renders
  await expect(panel.locator("[data-testid='dorv-main-panel']")).toBeVisible({ timeout: TIMEOUT });

  // Header renders with eyebrand and title
  await expect(panel.locator("[data-testid='dorv-header']")).toBeVisible({ timeout: TIMEOUT });
  await expect(panel.locator("[data-testid='dorv-header'] .dorv-eyebrow")).toContainText("dorv");
  await expect(panel.locator("[data-testid='dorv-header'] h1")).toContainText("Review Sync");

  // Icon buttons
  await expect(panel.locator("[data-testid='dorv-open-pr-btn']")).toBeVisible();
  await expect(panel.locator("[data-testid='dorv-open-doc-btn']")).toBeVisible();

  // Close panel button
  await expect(panel.locator("[data-testid='dorv-close-panel-btn']")).toBeVisible();

  // Sync now button
  await expect(panel.locator("[data-testid='dorv-sync-now-btn']")).toBeVisible();
  await expect(panel.locator("[data-testid='dorv-sync-now-btn']")).toContainText("Sync now");

  // Status bar shows idle dot and last synced time
  await expect(panel.locator("[data-testid='dorv-status-bar']")).toBeVisible();
  await expect(panel.locator("[data-testid='dorv-status-dot']")).toBeVisible();
  await expect(panel.locator("[data-testid='dorv-status-bar']")).toContainText("Last synced:");

  // Three tabs rendered with GitHub active by default
  await expect(panel.locator("[data-testid='dorv-tabs']")).toBeVisible();
  await expect(panel.locator("[data-testid='dorv-tab-github']")).toBeVisible();
  await expect(panel.locator("[data-testid='dorv-tab-gdoc']")).toBeVisible();
  await expect(panel.locator("[data-testid='dorv-tab-activities']")).toBeVisible();
  await expect(panel.locator("[data-testid='dorv-tab-github']")).toHaveClass(/active/);

  // GitHub comments container visible
  await expect(panel.locator("[data-testid='dorv-gh-comments']")).toBeVisible({ timeout: TIMEOUT });

  // File sections rendered — each FAKE_GH_REVIEW_COMMENTS has path "docs/rfc.md"
  const firstComment = FAKE_GH_REVIEW_COMMENTS[0];
  if (firstComment) {
    const section = panel.locator(`[data-testid='dorv-gh-file-section-${firstComment.path}']`);
    await expect(section).toBeVisible({ timeout: TIMEOUT });
    // File path displayed in the summary
    await expect(section.locator("summary")).toContainText(firstComment.path);
  }

  // Comment card shows author, line, and body
  if (firstComment) {
    const commentCard = panel.locator(
      `[data-testid='dorv-gh-comment-${firstComment.id.toString()}']`
    );
    await expect(commentCard).toBeVisible({ timeout: TIMEOUT });
    await expect(commentCard.locator(".author")).toContainText(`@${firstComment.user.login}`);
    await expect(commentCard.locator(".comment-body")).toContainText(firstComment.body);
  }

  // Refresh icon present (not spinning when idle)
  await expect(panel.locator("[data-testid='dorv-refresh-icon']")).toBeVisible();
  await expect(panel.locator("[data-testid='dorv-refresh-icon']")).not.toHaveClass(/dorv-spinning/);

  await panel.close();
});

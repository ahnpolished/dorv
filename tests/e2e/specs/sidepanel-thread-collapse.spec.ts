/**
 * TC-020: Thread expand/collapse in GitHub tab.
 *
 * AC:
 *   - GitHub comment thread with replies shows a toggle button with reply count
 *   - Toggle button shows chevron-right icon when collapsed
 *   - Toggle button shows chevron-down icon when expanded
 *   - Replies are hidden when collapsed by default
 *   - Clicking toggle expands replies and shows reply cards
 *   - Clicking toggle again collapses replies
 */
import { expect, test, TEST_PR } from "../fixtures/extension.js";
import { setupPageRoutes } from "../fixtures/mock-apis.js";

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

// REST-style GH review comments — root comment (1001) with two replies (1002, 1003) via in_reply_to_id
const GH_COMMENTS_WITH_REPLIES = [
  {
    id: 1001,
    body: "Consider caching this result.",
    path: "docs/rfc.md",
    line: 10,
    side: "RIGHT",
    in_reply_to_id: null,
    created_at: "2026-05-17T12:00:00Z",
    updated_at: "2026-05-17T12:00:00Z",
    user: { login: "reviewer" },
    html_url: `${TEST_PR.url}#review-1001`
  },
  {
    id: 1002,
    body: "Good point, will add caching.",
    path: "docs/rfc.md",
    line: 10,
    side: "RIGHT",
    in_reply_to_id: 1001,
    created_at: "2026-05-17T12:30:00Z",
    updated_at: "2026-05-17T12:30:00Z",
    user: { login: "author" },
    html_url: `${TEST_PR.url}#review-1002`
  },
  {
    id: 1003,
    body: "Done in the latest commit.",
    path: "docs/rfc.md",
    line: 10,
    side: "RIGHT",
    in_reply_to_id: 1001,
    created_at: "2026-05-17T13:00:00Z",
    updated_at: "2026-05-17T13:00:00Z",
    user: { login: "author" },
    html_url: `${TEST_PR.url}#review-1003`
  }
];

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

test("TC-020: thread toggle expands and collapses replies", async ({
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

  // Return GH comments with replies via REST API (used by the sidepanel's getGHComments)
  await setupPageRoutes(extensionContext, {
    ghReviewComments: GH_COMMENTS_WITH_REPLIES
  });

  const panel = await openSidepanelOnPR(extensionContext, extensionId);

  // Wait for main panel and GitHub comments
  await expect(panel.locator("[data-testid='dorv-main-panel']")).toBeVisible({ timeout: TIMEOUT });
  await expect(panel.locator("[data-testid='dorv-gh-comments']")).toBeVisible({ timeout: TIMEOUT });

  // Root comment card visible
  const rootComment = panel.locator("[data-testid='dorv-gh-comment-1001']");
  await expect(rootComment).toBeVisible({ timeout: TIMEOUT });

  // Toggle button present with reply count
  const toggle = panel.locator("[data-testid='dorv-thread-toggle-1001']");
  await expect(toggle).toBeVisible();
  await expect(toggle).toContainText("2 replies");

  // Initially collapsed — chevron-right icon present, replies not visible
  await expect(toggle.locator("i.ti-chevron-right")).toBeVisible();
  const replyContainer = rootComment.locator(".thread-replies");
  await expect(replyContainer).not.toBeVisible();

  // Click toggle — expand replies
  await toggle.click();
  await expect(toggle.locator("i.ti-chevron-down")).toBeVisible();
  await expect(replyContainer).toBeVisible();

  // Reply cards visible
  await expect(panel.locator("[data-testid='dorv-gh-reply-1002']")).toBeVisible();
  await expect(panel.locator("[data-testid='dorv-gh-reply-1003']")).toBeVisible();

  // Verify reply content
  const reply1002 = panel.locator("[data-testid='dorv-gh-reply-1002']");
  await expect(reply1002.locator(".author")).toContainText("@author");
  await expect(reply1002.locator(".comment-body")).toContainText("Good point, will add caching.");

  // Click toggle again — collapse replies
  await toggle.click();
  await expect(toggle.locator("i.ti-chevron-right")).toBeVisible();
  await expect(replyContainer).not.toBeVisible();

  await panel.close();
});

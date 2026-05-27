/**
 * TC-018: Unlinked PR view — sidepanel opened on a GH PR without an existing doc.
 *
 * AC:
 *   - File list displays markdown files from the PR
 *   - "Create Google Doc (N files)" button shows correct file count
 *   - No markdown files: shows "No markdown files found in this PR." message
 *   - Create button is disabled while creating
 *   - Error message appears if creation fails
 */
import { expect, test, TEST_PR } from "../fixtures/extension.js";
import { setupPageRoutes, FAKE_MD_FILES, FAKE_NON_MD_FILES } from "../fixtures/mock-apis.js";

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

test("TC-018a: unlinked PR shows file list and Create button with correct file count", async ({
  extensionContext,
  extensionId,
  seedStorage,
  patchWorkerIdentity
}) => {
  await seedStorage({ github_pat: "ghp_test_pat_for_e2e" });
  await patchWorkerIdentity();
  await setupPageRoutes(extensionContext, { files: FAKE_MD_FILES, ghReviewComments: [] });

  const panel = await openSidepanelOnPR(extensionContext, extensionId);

  // Unlinked PR container renders
  await expect(panel.locator("[data-testid='dorv-unlinked-pr']")).toBeVisible({ timeout: TIMEOUT });

  // Title rendered
  await expect(panel.locator("[data-testid='dorv-create-doc-title']")).toContainText(
    "Create Review Doc"
  );

  // File list rendered with markdown files
  await expect(panel.locator("[data-testid='dorv-file-list']")).toBeVisible();

  // Each markdown file appears as a list item
  for (const f of FAKE_MD_FILES) {
    await expect(panel.locator(`[data-testid='dorv-file-item-${f.filename}']`)).toBeVisible();
  }

  // Create button shows correct file count
  const createBtn = panel.locator("[data-testid='dorv-create-doc-btn']");
  await expect(createBtn).toBeVisible();
  await expect(createBtn).toContainText(
    `Create Google Doc (${FAKE_MD_FILES.length.toString()} ${FAKE_MD_FILES.length === 1 ? "file" : "files"})`
  );
  await expect(createBtn).not.toBeDisabled();

  await panel.close();
});

test("TC-018b: unlinked PR with no markdown files shows 'No markdown files found'", async ({
  extensionContext,
  extensionId,
  seedStorage,
  patchWorkerIdentity
}) => {
  await seedStorage({ github_pat: "ghp_test_pat_for_e2e" });
  await patchWorkerIdentity();
  await setupPageRoutes(extensionContext, { files: FAKE_NON_MD_FILES, ghReviewComments: [] });

  const panel = await openSidepanelOnPR(extensionContext, extensionId);

  // Unlinked PR container renders
  await expect(panel.locator("[data-testid='dorv-unlinked-pr']")).toBeVisible({ timeout: TIMEOUT });

  // No-markdown-files message shown
  await expect(panel.locator("[data-testid='dorv-no-md-files']")).toBeVisible();
  await expect(panel.locator("[data-testid='dorv-no-md-files']")).toContainText(
    "No markdown files found in this PR."
  );

  // Create button should not appear
  await expect(panel.locator("[data-testid='dorv-create-doc-btn']")).not.toBeVisible();
  await expect(panel.locator("[data-testid='dorv-file-list']")).not.toBeVisible();

  await panel.close();
});

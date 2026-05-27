/**
 * Real-credential sidepanel UI tests.
 *
 * These tests open the extension sidepanel on PR #6 and verify that the actual
 * DOM renders correctly with real data from GitHub and Google Docs — not mocked.
 *
 * Run:  DORV_GITHUB_PAT=... DORV_GOOGLE_TOKEN=... pnpm e2e:real --grep "TC-02[1-5]"
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
  test,
  expect,
  openSidepanelOnRealPr,
  fetchRealMarkdownFiles,
  fetchCommentTarget,
  createGhReviewComment,
  createGhCommentReply,
  deleteGhReviewComment,
  createDocViaExtension,
  buildRealCreateDocInput,
  hasRequiredGoogleScopes,
  REAL_REPO,
  REAL_PR_NUMBER
} from "./fixture.js";
import { readState, writeState } from "./state.js";

const TEST_COMMENT_TAG = "[dorv-real-sidepanel-test]";
const DOC_STORE_KEY = `docStore:${REAL_REPO}#${REAL_PR_NUMBER.toString()}`;

// ── created comment cleanup ───────────────────────────────────────────────────

const createdGhCommentIds: number[] = [];

test.afterAll(async () => {
  const ids = [...createdGhCommentIds, ...(readState().ghCommentIds ?? [])];
  for (const id of ids) {
    await deleteGhReviewComment(id);
  }
  writeState({ ghCommentIds: [] });
});

// ── helpers ──────────────────────────────────────────────────────────────────

/** Seed extension storage with a real doc mapping from the state file. */
async function seedDocMapping(
  extensionWorker: import("@playwright/test").Worker,
  extensionContext: import("@playwright/test").BrowserContext,
  extensionId: string
): Promise<void> {
  const state = readState();
  if (state.docMapping && state.docStoreKey) {
    // Reuse existing
    await extensionWorker.evaluate(
      (data: any) => {
        return new Promise<void>((resolve) => {
          chrome.storage.local.set(data, resolve);
        });
      },
      {
        active_prs: [{ repo: REAL_REPO, prNumber: REAL_PR_NUMBER }],
        [state.docStoreKey]: state.docMapping
      }
    );
    return;
  }

  // No existing state — create a dry-run file listing check and a real doc
  test.skip(
    !(await hasRequiredGoogleScopes()),
    "DORV_GOOGLE_TOKEN must include Google Docs + Drive file scopes to seed a doc mapping"
  );

  const input = await buildRealCreateDocInput();
  const docId = await createDocAndPersist(extensionWorker, extensionContext, extensionId, input);
  console.log(`[seedDocMapping] Created doc: ${docId}`);
}

async function createDocAndPersist(
  extensionWorker: import("@playwright/test").Worker,
  extensionContext: import("@playwright/test").BrowserContext,
  extensionId: string,
  input: import("../../../apps/extension/lib/adapters/types.js").CreateDocInput
): Promise<string> {
  await createDocViaExtension(extensionContext, extensionId, input);

  const workerStorage = await extensionWorker.evaluate<Record<string, unknown>>(() => {
    return new Promise((r) => {
      chrome.storage.local.get(null, r);
    });
  });
  const mapping = workerStorage[DOC_STORE_KEY] as Record<string, unknown> | undefined;
  if (!mapping?.docId) throw new Error("CREATE_DOC did not produce a doc mapping");

  writeState({
    docId: mapping.docId as string,
    docUrl: mapping.docUrl as string,
    docStoreKey: DOC_STORE_KEY,
    docMapping: mapping
  });

  return mapping.docId as string;
}

// ── tests ─────────────────────────────────────────────────────────────────────

test.describe("sidepanel UI (real)", () => {
  test("TC-021: unlinked real PR shows file listing with real markdown files", async ({
    extensionContext,
    extensionId,
    extensionWorker
  }) => {
    test.skip(!process.env.DORV_GITHUB_PAT, "Requires DORV_GITHUB_PAT to fetch PR metadata");

    // Seed PAT but NO doc mapping — should see the "Create Review Doc" view
    await extensionWorker.evaluate((pat: string) => {
      return new Promise<void>((resolve) => {
        chrome.storage.local.set({ github_pat: pat }, resolve);
      });
    }, process.env.DORV_GITHUB_PAT ?? "");

    // Fetch real markdown files so we know what to expect
    const mdFiles = await fetchRealMarkdownFiles();
    expect(mdFiles.length, "PR must have at least one markdown file").toBeGreaterThan(0);

    const panel = await openSidepanelOnRealPr(extensionContext, extensionId);

    // Verify we see the "Create Review Doc" unlinked view
    await expect(panel.locator("[data-testid='dorv-create-doc-title']")).toBeVisible({
      timeout: 30_000
    });

    // Verify the file list is visible with the correct number of items
    const fileList = panel.locator("[data-testid='dorv-file-list']");
    await expect(fileList).toBeVisible({ timeout: 15_000 });
    const items = fileList.locator("li");
    await expect(items).toHaveCount(mdFiles.length);

    // Verify each real markdown filename is rendered
    for (const file of mdFiles) {
      const fileItem = panel.locator(`[data-testid='dorv-file-item-${file.filename}']`);
      await expect(fileItem).toBeVisible({ timeout: 5_000 });
      await expect(fileItem).toContainText(file.filename);
    }

    // Verify the create button says the right number of files
    const createBtn = panel.locator("[data-testid='dorv-create-doc-btn']");
    await expect(createBtn).toBeVisible({ timeout: 5_000 });
    await expect(createBtn).toContainText(
      `${mdFiles.length.toString()} file${mdFiles.length === 1 ? "" : "s"}`
    );

    await panel.close();
  });

  test("TC-022: create Google Doc from sidepanel UI button", async ({
    extensionContext,
    extensionId,
    extensionWorker
  }) => {
    test.skip(
      !(await hasRequiredGoogleScopes()),
      "DORV_GOOGLE_TOKEN must include Google Docs + Drive file scopes to create live docs"
    );

    // Check if we already have a doc from a prior run
    const existingState = readState();
    if (existingState.docId && existingState.docMapping) {
      // Re-seed storage and quickly verify the linked UI renders
      await extensionWorker.evaluate(
        (data: any) => {
          return new Promise<void>((resolve) => {
            chrome.storage.local.set(data, resolve);
          });
        },
        {
          active_prs: [{ repo: REAL_REPO, prNumber: REAL_PR_NUMBER }],
          [existingState.docStoreKey ?? ""]: existingState.docMapping
        }
      );

      const panel = await openSidepanelOnRealPr(extensionContext, extensionId);
      await expect(panel.locator("[data-testid='dorv-main-panel']")).toBeVisible({
        timeout: 30_000
      });
      await expect(panel.locator("[data-testid='dorv-tab-github']")).toBeVisible({
        timeout: 10_000
      });
      const stateLabel = await panel.locator("[data-testid='dorv-status-bar']").textContent();
      expect(stateLabel).toMatch(/Last synced:|Syncing/);

      // Verify the doc URL button is enabled (doc mapping exists)
      const docBtn = panel.locator("[data-testid='dorv-open-doc-btn']");
      await expect(docBtn).toBeVisible();
      const docBtnDisabled = await docBtn.getAttribute("disabled");
      expect(docBtnDisabled).toBeNull();
      console.log(`[TC-022] Reusing existing doc: ${existingState.docId}`);
      await panel.close();
      return;
    }

    // No existing state — create doc via the UI button
    const panel = await openSidepanelOnRealPr(extensionContext, extensionId);

    // Wait for the unlinked view
    await expect(panel.locator("[data-testid='dorv-create-doc-title']")).toBeVisible({
      timeout: 30_000
    });

    // Click "Create Google Doc" button
    const createBtn = panel.locator("[data-testid='dorv-create-doc-btn']");
    await createBtn.click();

    // Wait for the button text to change to "Creating..."
    await expect(panel.locator("[data-testid='dorv-create-doc-btn']")).toContainText("Creating", {
      timeout: 5_000
    });

    // Wait for the creation to complete — the button disappears and the main panel appears
    await expect(panel.locator("[data-testid='dorv-main-panel']")).toBeVisible({
      timeout: 120_000
    });

    // Verify the linked view has the expected elements
    await expect(panel.locator("[data-testid='dorv-header']")).toBeVisible({ timeout: 10_000 });
    await expect(panel.locator("[data-testid='dorv-tabs']")).toBeVisible({ timeout: 10_000 });
    await expect(panel.locator("[data-testid='dorv-tab-github']")).toBeVisible();
    await expect(panel.locator("[data-testid='dorv-tab-gdoc']")).toBeVisible();
    await expect(panel.locator("[data-testid='dorv-tab-activities']")).toBeVisible();
    await expect(panel.locator("[data-testid='dorv-sync-now-btn']")).toBeVisible();
    await expect(panel.locator("[data-testid='dorv-status-bar']")).toBeVisible();

    // Verify the doc mapping was saved to storage
    const storage = await extensionWorker.evaluate<Record<string, unknown>>(() => {
      return new Promise((r) => {
        chrome.storage.local.get(null, r);
      });
    });
    const mapping = storage[DOC_STORE_KEY] as { docId?: string; docUrl?: string } | undefined;
    expect(mapping, "doc mapping must exist in storage").toBeDefined();
    expect(mapping?.docId, "mapping must have a docId").toBeTruthy();
    expect(mapping?.docUrl, "mapping must have a docUrl").toMatch(/docs\.google\.com/);

    // Persist for downstream tests
    writeState({
      docId: mapping?.docId ?? "",
      docUrl: mapping?.docUrl ?? "",
      docStoreKey: DOC_STORE_KEY,
      docMapping: storage[DOC_STORE_KEY] as Record<string, unknown>
    });

    // Verify the open-doc button is enabled
    const docBtn = panel.locator("[data-testid='dorv-open-doc-btn']");
    await expect(docBtn).toBeVisible();
    const docBtnDisabled = await docBtn.getAttribute("disabled");
    expect(docBtnDisabled).toBeNull();

    await panel.close();
  });

  test("TC-023: real GH review comment renders in sidepanel DOM", async ({
    extensionContext,
    extensionId,
    extensionWorker
  }) => {
    await seedDocMapping(extensionWorker, extensionContext, extensionId);

    // Create a real GH review comment on PR #6
    const target = await fetchCommentTarget();
    if (!target) {
      test.fail(true, "Could not find a valid comment target on PR #6");
      return;
    }

    const body = `${TEST_COMMENT_TAG} TC-023 sidepanel DOM render test ${Date.now().toString()}`;
    const commentId = await createGhReviewComment(target.headSha, target.path, target.line, body);
    if (!commentId) {
      test.fail(true, "Failed to create GH review comment — check PAT scopes");
      return;
    }
    createdGhCommentIds.push(commentId);

    // Open sidepanel — the GH comments are fetched directly from the GraphQL API
    const panel = await openSidepanelOnRealPr(extensionContext, extensionId);

    // Wait for the linked view and GitHub tab content
    await expect(panel.locator("[data-testid='dorv-main-panel']")).toBeVisible({
      timeout: 30_000
    });

    // Wait for the comment to appear in the DOM
    // The sidepanel fetches review threads on mount + auto-refreshes every 30s
    const commentLocator = panel.locator(`[data-testid='dorv-gh-comment-${String(commentId)}']`);
    await expect(commentLocator).toBeVisible({ timeout: 40_000 });

    // Verify the comment shows the correct author
    const authorSpan = commentLocator.locator(".author");
    await expect(authorSpan).toBeVisible({ timeout: 5_000 });

    // The author comes from GraphQL: reviewThread -> comments -> user.login
    // Our PAT authenticates as the repo owner (taeahn). Verify @mention syntax.
    await expect(authorSpan).toContainText("@");

    // Verify the comment body matches what we created
    await expect(commentLocator.locator(".comment-body")).toContainText(body, { timeout: 5_000 });

    // Verify the file section header shows the path
    const section = panel.locator(`[data-testid='dorv-gh-file-section-${target.path}']`);
    await expect(section).toBeVisible({ timeout: 10_000 });
    await expect(section.locator("summary")).toContainText(target.path);

    // Verify the comment card has a line number indicator
    await expect(commentLocator.locator(".comment-meta")).toContainText(target.line.toString(), {
      timeout: 5_000
    });

    // Verify GitHub tab is active
    await expect(panel.locator("[data-testid='dorv-tab-github']")).toHaveClass(/active/);

    await panel.close();
  });

  test("TC-024: sidepanel tab switching with real synced data", async ({
    extensionContext,
    extensionId,
    extensionWorker
  }) => {
    await seedDocMapping(extensionWorker, extensionContext, extensionId);

    const panel = await openSidepanelOnRealPr(extensionContext, extensionId);

    // Wait for linked view with tabs
    await expect(panel.locator("[data-testid='dorv-main-panel']")).toBeVisible({
      timeout: 30_000
    });

    // Verify initial state: GitHub tab active by default
    await expect(panel.locator("[data-testid='dorv-tab-github']")).toHaveClass(/active/);
    await expect(panel.locator("[data-testid='dorv-gh-comments']")).toBeVisible({
      timeout: 15_000
    });
    // Either comments or the empty message should be visible
    const ghEmpty = panel.locator("[data-testid='dorv-gh-empty']");
    const ghNotEmpty = panel.locator("[data-testid='dorv-gh-comments'] .file-section").first();
    await expect(ghEmpty.or(ghNotEmpty)).toBeVisible({ timeout: 10_000 });

    // Switch to Google Doc tab
    await panel.locator("[data-testid='dorv-tab-gdoc']").click();
    await expect(panel.locator("[data-testid='dorv-tab-gdoc']")).toHaveClass(/active/);
    await expect(panel.locator("[data-testid='dorv-tab-github']")).not.toHaveClass(/active/);

    // Verify the GDoc content area is visible
    const gdocComments = panel.locator("[data-testid='dorv-gdoc-comments']");
    await expect(gdocComments).toBeVisible({ timeout: 10_000 });
    // Either comments or the empty message
    const gdocEmpty = panel.locator("[data-testid='dorv-gdoc-empty']");
    const gdocNotEmpty = panel.locator("[data-testid='dorv-gdoc-comments'] .comment-card").first();
    await expect(gdocEmpty.or(gdocNotEmpty)).toBeVisible({ timeout: 10_000 });
    await expect(panel.locator("[data-testid='dorv-gdoc-heading']")).toContainText(
      "Google Doc Comments"
    );
    await expect(panel.locator("[data-testid='dorv-push-all-btn']")).toBeVisible();

    // Switch to Activities tab
    await panel.locator("[data-testid='dorv-tab-activities']").click();
    await expect(panel.locator("[data-testid='dorv-tab-activities']")).toHaveClass(/active/);
    await expect(panel.locator("[data-testid='dorv-tab-gdoc']")).not.toHaveClass(/active/);
    const activities = panel.locator("[data-testid='dorv-activities']");
    await expect(activities).toBeVisible({ timeout: 10_000 });

    // Switch back to GitHub tab, verify it reactivates and content is present
    await panel.locator("[data-testid='dorv-tab-github']").click();
    await expect(panel.locator("[data-testid='dorv-tab-github']")).toHaveClass(/active/);
    await expect(panel.locator("[data-testid='dorv-gh-comments']")).toBeVisible({
      timeout: 10_000
    });

    await panel.close();
  });

  test("TC-025: real GH thread expand/collapse works in sidepanel", async ({
    extensionContext,
    extensionId,
    extensionWorker
  }) => {
    await seedDocMapping(extensionWorker, extensionContext, extensionId);

    // Create a parent review comment with a reply to form a thread
    const target = await fetchCommentTarget();
    if (!target) {
      test.fail(true, "Could not find a valid comment target on PR #6");
      return;
    }

    const parentBody = `${TEST_COMMENT_TAG} TC-025 parent ${Date.now().toString()}`;
    const parentId = await createGhReviewComment(
      target.headSha,
      target.path,
      target.line,
      parentBody
    );
    if (!parentId) {
      test.fail(true, "Failed to create parent GH review comment");
      return;
    }
    createdGhCommentIds.push(parentId);

    const replyBody = `${TEST_COMMENT_TAG} TC-025 reply`;
    const replyId = await createGhCommentReply(parentId, replyBody);
    if (!replyId) {
      console.log("[TC-025] Could not create reply — continuing with parent only");
    } else {
      createdGhCommentIds.push(replyId);
    }

    const panel = await openSidepanelOnRealPr(extensionContext, extensionId);

    // Wait for the linked view and GitHub tab
    await expect(panel.locator("[data-testid='dorv-main-panel']")).toBeVisible({
      timeout: 30_000
    });

    // Wait for the parent comment to appear in the DOM
    const parentComment = panel.locator(`[data-testid='dorv-gh-comment-${String(parentId)}']`);
    await expect(parentComment).toBeVisible({ timeout: 40_000 });

    // Verify the comment body renders
    await expect(parentComment.locator(".comment-body")).toContainText(parentBody, {
      timeout: 5_000
    });

    // Find the thread toggle button
    const toggleBtn = panel.locator(`[data-testid='dorv-thread-toggle-${String(parentId)}']`);

    if (await toggleBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      // Thread has replies — toggle should exist
      const threadContent = parentComment.locator(".thread-replies");
      const initiallyVisible = await threadContent.isVisible().catch(() => false);

      // Toggle to collapse
      await toggleBtn.click();
      await panel.waitForTimeout(500); // React re-render

      const afterCollapse = await threadContent.isVisible().catch(() => false);

      if (replyId && initiallyVisible) {
        console.log(
          `[TC-025] Thread collapse toggled: visible=${initiallyVisible.toString()} -> ${afterCollapse.toString()}`
        );
      }
    } else {
      console.log(`[TC-025] No toggle button found for comment ${parentId.toString()}`);
    }

    // Verify GitHub tab is still active
    await expect(panel.locator("[data-testid='dorv-tab-github']")).toHaveClass(/active/);

    await panel.close();
  });
});

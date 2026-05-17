/**
 * AC #6: GDoc comments pushed to GH (triggered via SYNC_NOW).
 */
import { expect, test, TEST_PR } from "../fixtures/extension.js";
import { setupPageRoutes } from "../fixtures/mock-apis.js";

const DOC_MAPPING = {
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

const GH_COMMENT_MAPPING = {
  repo: TEST_PR.ref,
  prNumber: TEST_PR.prNumber,
  ghCommentId: 1001,
  docCommentId: "doc-comment-101",
  source: "github"
};

const GDOC_WITH_REPLY = {
  comments: [
    {
      id: "doc-comment-101",
      content: "Looks good.",
      author: { displayName: "GHReviewer" },
      createdTime: "2026-05-17T12:00:00Z",
      replies: [
        {
          id: "doc-reply-201",
          content: "Will add caching.",
          author: { displayName: "DocReviewer" },
          createdTime: "2026-05-17T13:00:00Z"
        }
      ]
    }
  ]
};

test("SYNC_NOW pushes GDoc reply to GH review", async ({
  extensionContext,
  extensionWorker,
  seedStorage,
  patchWorkerIdentity,
  triggerSync
}) => {
  const { owner, repo, prNumber } = TEST_PR;
  const docMappingKey = `docStore:${TEST_PR.ref}#${prNumber.toString()}`;
  const ghMappingKey = "mappingStore:gh:1001";
  const docMappingStoreKey = "mappingStore:doc:doc-comment-101";
  const prListKey = `mappingStore:pr:${TEST_PR.ref}#${prNumber.toString()}`;

  await seedStorage({
    github_pat: "ghp_test_pat_for_e2e",
    active_prs: [{ repo: TEST_PR.ref, prNumber }],
    [docMappingKey]: DOC_MAPPING,
    [ghMappingKey]: GH_COMMENT_MAPPING,
    [docMappingStoreKey]: GH_COMMENT_MAPPING,
    [prListKey]: [GH_COMMENT_MAPPING]
  });

  await patchWorkerIdentity();

  // Set up base routes FIRST so the capturing route below takes precedence (Playwright LIFO)
  await setupPageRoutes(extensionContext, {
    ghReviewComments: [],
    gdocComments: GDOC_WITH_REPLY
  });

  // Capture route registered AFTER setupPageRoutes so it takes precedence (LIFO order).
  // createReviewCommentReply POSTs to pulls/{prNumber}/comments (same endpoint as GET comments).
  // Use route.fallback() for GET so fetchReviewComments still gets the base mock response.
  let ghReplyCalled = false;
  await extensionContext.route(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber.toString()}/comments*`,
    (route) => {
      if (route.request().method() === "POST") {
        ghReplyCalled = true;
        void route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ id: 3001 })
        });
      } else {
        // Pass GET requests to the next handler (setupPageRoutes → returns [])
        void route.fallback();
      }
    }
  );

  await triggerSync();

  // Wait longer for the sync to complete (GDoc fetch + GH reply POST)
  await extensionWorker.evaluate(() => new Promise((r) => setTimeout(r, 4000)));

  const storage = await extensionWorker.evaluate<Record<string, unknown>>(
    () =>
      new Promise((resolve) => {
        chrome.storage.local.get(null, (items) => {
          resolve(items);
        });
      })
  );

  // Log sync status for diagnostics
  const syncStatusKey = `statusStore:${TEST_PR.ref}#${TEST_PR.prNumber.toString()}`;
  const syncStatus = storage[syncStatusKey] as Record<string, unknown> | undefined;
  if (syncStatus?.state === "error") {
    console.log("[comment-sync-gdoc-gh] sync error:", syncStatus.message);
  }

  const hasMappingInStorage = "replyMappingStore:doc:doc-reply-201" in storage;
  expect(hasMappingInStorage || ghReplyCalled).toBe(true);
});

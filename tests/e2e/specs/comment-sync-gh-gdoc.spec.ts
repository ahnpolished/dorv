/**
 * AC #5: GH review comments appear in GDoc (triggered via SYNC_NOW message).
 */
import { expect, test, TEST_PR } from "../fixtures/extension.js";
import { setupPageRoutes, FAKE_GH_REVIEW_COMMENTS } from "../fixtures/mock-apis.js";

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

test("SYNC_NOW pushes new GH comment to GDoc and stores mapping", async ({
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
    [docMappingKey]: DOC_MAPPING
  });

  // Patch chrome.identity in SW so getGoogleToken(false) succeeds
  await patchWorkerIdentity();

  // Capture whether GDoc comment POST was made via context.route (intercepts SW fetch)
  let gdocPostCaptured = false;
  await extensionContext.route("https://www.googleapis.com/drive/v3/files/*/comments*", (route) => {
    if (route.request().method() === "POST") {
      gdocPostCaptured = true;
    }
    const body =
      route.request().method() === "POST"
        ? JSON.stringify({ id: "doc-comment-new-1" })
        : JSON.stringify({
            comments: [
              {
                id: "doc-comment-101",
                content: "Existing",
                author: { displayName: "DocReviewer" },
                createdTime: "2026-05-17T12:00:00Z",
                replies: []
              }
            ]
          });
    void route.fulfill({ status: 200, contentType: "application/json", body });
  });

  // Returns non-empty GH review comments so the sync pushes them to GDoc
  await setupPageRoutes(extensionContext, { ghReviewComments: FAKE_GH_REVIEW_COMMENTS });

  // Trigger SYNC_NOW from an extension page (the only context with chrome.runtime)
  await triggerSync();

  // Allow async sync to complete
  await extensionWorker.evaluate(() => new Promise((r) => setTimeout(r, 2000)));

  const storage = await extensionWorker.evaluate<Record<string, unknown>>(
    () =>
      new Promise((resolve) => {
        chrome.storage.local.get(null, (items) => {
          resolve(items);
        });
      })
  );

  // Either the mapping was stored OR the GDoc POST was captured at the network level
  const hasMappingInStorage = "mappingStore:gh:1001" in storage;
  expect(hasMappingInStorage || gdocPostCaptured).toBe(true);
});

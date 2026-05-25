/**
 * TC-010 Stale PR — after a new commit lands on the PR, syncAll() marks the doc mapping
 * as stale (isStale: true, latestSha updated to the new head SHA).
 */
import { expect, test, TEST_PR } from "../fixtures/extension.js";
import { setupPageRoutes, FAKE_PR_META } from "../fixtures/mock-apis.js";

const NEW_HEAD_SHA = "newcommit999111abc";

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

test("TC-010: syncAll marks mapping as stale when PR head SHA has advanced", async ({
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

  // Register base routes first; the stale-SHA override below wins via LIFO
  await setupPageRoutes(extensionContext, { ghReviewComments: [] });

  // Return a NEW head SHA — different from BASE_DOC_MAPPING.headSha
  const { owner, repo, prNumber } = TEST_PR;
  await extensionContext.route(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber.toString()}`,
    (route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...FAKE_PR_META,
          head: { ...FAKE_PR_META.head, sha: NEW_HEAD_SHA }
        })
      });
    }
  );

  await triggerSync();
  // Allow sync to complete and the updated mapping to be written to storage
  await extensionWorker.evaluate(() => new Promise((r) => setTimeout(r, 4000)));

  const storage = await extensionWorker.evaluate<Record<string, unknown>>(
    () =>
      new Promise((resolve) => {
        chrome.storage.local.get(null, resolve);
      })
  );

  const stored = storage[docMappingKey] as { isStale?: boolean; latestSha?: string } | undefined;

  expect(stored, "doc mapping must be present in storage after sync").toBeDefined();
  expect(stored?.isStale, "mapping must be marked stale after head SHA mismatch").toBe(true);
  expect(stored?.latestSha, "latestSha must be updated to the new commit SHA").toBe(NEW_HEAD_SHA);
});

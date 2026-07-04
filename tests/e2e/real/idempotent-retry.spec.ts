/**
 * Regression test for the v0.2.0 P0: a PR received 1000+ duplicate GitHub
 * review comments mirrored into its linked Google Doc. Root cause: the old
 * sync path called the Drive comment API (the "act") and only afterwards
 * wrote the local mapping (the "record"). When the local write threw
 * (`chrome.storage.local` quota — confirmed to happen in production), the
 * mapping never landed, so the next sync found no mapping and re-pushed —
 * unboundedly, on every poll.
 *
 * The v0.3.0 fix anchors correctness on remote content: before pushing a GH
 * comment to a doc, the adapter lists the doc's existing Drive comments and
 * checks whether any already embed the GH comment's id (recoverable via the
 * `#discussion_r(\d+)` fragment in the `[View on GitHub](htmlUrl)` link).
 * This spec forces exactly that failure — inject a `chrome.storage.local.set`
 * that rejects once for the specific mapping key — then retries the same
 * sync and asserts the doc ends up with exactly one Drive comment for that
 * GH comment id, not two.
 *
 * Run: DORV_GITHUB_PAT=... DORV_GOOGLE_TOKEN=... pnpm e2e:real --grep "idempotent-retry"
 */
import {
  test,
  expect,
  buildRealCreateDocInput,
  createDocViaExtension,
  hasRequiredGoogleScopes,
  fetchRealPrMeta,
  fetchCommentTarget,
  createGhReviewComment,
  deleteGhReviewComment,
  deleteDriveComment,
  listDriveComments,
  REAL_REPO,
  REAL_PR_NUMBER
} from "./fixture.js";
import { readStateForPr, writeStateForPr } from "./state.js";

const DOC_STORE_KEY = `docStore:${REAL_REPO}#${REAL_PR_NUMBER.toString()}`;

test.describe("idempotent retry — the 1000-duplicate-comment regression", () => {
  test("does not create a second Drive comment when the local mapping write fails and the sync is retried", async ({
    extensionContext,
    extensionId,
    extensionWorker,
    triggerSync
  }) => {
    test.skip(
      !(await hasRequiredGoogleScopes()),
      "DORV_GOOGLE_TOKEN must include Google Docs + Drive file scopes"
    );

    // Reuse (or create) the linked doc for the test PR, same as TC-001.
    let state = readStateForPr(REAL_REPO, REAL_PR_NUMBER);
    if (!state.docId) {
      const input = await buildRealCreateDocInput();
      const result = await createDocViaExtension(extensionContext, extensionId, input);
      const firstDoc = result.mapping.docs[0];
      if (!firstDoc) {
        throw new Error("doc creation did not return any docs");
      }
      writeStateForPr(REAL_REPO, REAL_PR_NUMBER, {
        docId: firstDoc.docId,
        docUrl: firstDoc.docUrl,
        docStoreKey: DOC_STORE_KEY,
        docMapping: result.mapping as unknown as Record<string, unknown>
      });
      state = readStateForPr(REAL_REPO, REAL_PR_NUMBER);
    }
    if (!state.docId) {
      throw new Error(
        "no docId available after create/reuse — run doc-lifecycle.spec.ts TC-001 first"
      );
    }
    const docId = state.docId;

    // Push a brand-new GH review comment so this test's mapping key is unique
    // (never previously synced by another run).
    const target = await fetchCommentTarget();
    if (!target) {
      test.skip(true, "Could not find a valid (path, line) target on the test PR to comment on");
      return;
    }
    const meta = await fetchRealPrMeta();
    const marker = `[dorv-real-test] idempotent-retry ${Date.now().toString()}`;
    const ghCommentId = await createGhReviewComment(meta.headSha, target.path, target.line, marker);
    if (!ghCommentId) {
      test.skip(true, "Could not create a real GH review comment on the target line");
      return;
    }

    try {
      // Inject a chrome.storage.local.set that rejects exactly once for this
      // GH comment's mappingStore key — simulates the quota-exceeded write
      // failure that caused the original storm, right after the Drive push
      // (the "act") has already succeeded.
      await extensionWorker.evaluate((targetGhId: number) => {
        const storageLocal = chrome.storage.local as unknown as {
          set: (items: Record<string, unknown>) => Promise<void>;
        };
        const original = storageLocal.set.bind(storageLocal);
        let failedOnce = false;
        storageLocal.set = (items: Record<string, unknown>) => {
          const hasTargetKey = Object.keys(items).some(
            (k) => k.includes("mappingStore") && k.includes(`gh:${targetGhId.toString()}`)
          );
          if (hasTargetKey && !failedOnce) {
            failedOnce = true;
            return Promise.reject(new Error("QUOTA_BYTES quota exceeded"));
          }
          return original(items);
        };
      }, ghCommentId);

      // First sync: pushes the Drive comment (act succeeds), then the local
      // mapping write throws (record fails) — reproducing the storm's root cause.
      await triggerSync();

      // Retry: with the injected failure only firing once, this sync must
      // hit the remote-dedup check (no local mapping found) and discover the
      // Drive comment already created by the first attempt instead of
      // pushing a second one.
      await triggerSync();

      const driveComments = await listDriveComments(docId);
      const matching = driveComments.filter((c) =>
        c.content.includes(`#discussion_r${ghCommentId.toString()}`)
      );

      expect(
        matching.length,
        `expected exactly one Drive comment referencing GH comment ${ghCommentId.toString()}, found ${matching.length.toString()}`
      ).toBe(1);

      // Teardown: remove whatever Drive comment(s) this test created.
      for (const c of matching) {
        await deleteDriveComment(docId, c.id);
      }
    } finally {
      await deleteGhReviewComment(ghCommentId);
    }
  });
});

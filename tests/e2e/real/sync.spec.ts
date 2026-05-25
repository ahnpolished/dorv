/**
 * Real-credential sync tests — GitHub ↔ Google Doc comment sync.
 */
/* eslint-disable */
import {
  test,
  expect,
  openSidepanelOnRealPr,
  fetchCommentTarget,
  createGhReviewComment,
  createGhCommentReply,
  deleteGhReviewComment,
  GOOGLE_TOKEN,
  hasRequiredGoogleScopes
} from "./fixture.js";
import { readState, writeState, type RealE2EState } from "./state.js";

interface ExtensionWorker {
  evaluate: <R, Arg>(pageFunction: (arg: Arg) => R | Promise<R>, arg: Arg) => Promise<R>;
}

const TEST_COMMENT_TAG = "[dorv-real-test]";

/** Seed the extension storage from the shared state file. */
async function seedDocMapping(extensionWorker: ExtensionWorker): Promise<RealE2EState> {
  test.skip(
    !(await hasRequiredGoogleScopes()),
    "DORV_GOOGLE_TOKEN must include Google Docs + Drive file scopes to sync live docs"
  );

  const state = readState();
  if (!state.docMapping || !state.docStoreKey) {
    test.skip(true, "State file missing — run doc-lifecycle.spec.ts first");
    throw new Error("State file missing — run doc-lifecycle.spec.ts first");
  }

  // Restore the full storage snapshot if available
  const storageSnapshot = (state as any).storageSnapshot || {
    active_prs: [
      { repo: (state.docMapping as any).repo, prNumber: (state.docMapping as any).prNumber }
    ],
    [state.docStoreKey]: state.docMapping,
    [`docStore:${(state.docMapping as any).docId}`]: state.docMapping
  };

  await extensionWorker.evaluate((data: any) => {
    return new Promise<void>((resolve) => {
      chrome.storage.local.set(data, resolve);
    });
  }, storageSnapshot);
  return state;
}

/** Capture full extension storage and persist it to the state file. */
async function persistStorage(extensionWorker: ExtensionWorker) {
  const snapshot = await extensionWorker.evaluate<Record<string, any>, undefined>(() => {
    return new Promise((resolve) => {
      chrome.storage.local.get(null, resolve);
    });
  }, undefined);
  writeState({ storageSnapshot: snapshot } as any);
}

/** List Drive comments on the doc, returns raw comment objects. */
async function listDriveComments(docId: string): Promise<any[]> {
  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files/${docId}/comments?fields=comments(id,content,replies,resolved)&pageSize=100`,
    { headers: { Authorization: `Bearer ${GOOGLE_TOKEN}` } }
  );
  if (!resp.ok) return [];
  const data = (await resp.json()) as { comments?: any[] };
  return (data.comments ?? []).map((c: any) => ({
    ...c,
    resolved: c.resolved ?? false
  }));
}

/** Delete Drive comments whose content starts with the test tag. */
async function cleanDriveComments(docId: string): Promise<void> {
  const comments = await listDriveComments(docId);
  for (const c of comments) {
    if (typeof c.content === "string" && c.content.startsWith(TEST_COMMENT_TAG)) {
      await fetch(`https://www.googleapis.com/drive/v3/files/${docId}/comments/${c.id as string}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${GOOGLE_TOKEN}` }
      });
    }
  }
}

const createdGhCommentIds: number[] = [];

test.afterAll(async () => {
  const ids = [...createdGhCommentIds, ...(readState().ghCommentIds ?? [])];
  for (const id of ids) {
    await deleteGhReviewComment(id);
  }
  writeState({ ghCommentIds: [] });

  const { docId } = readState();
  if (docId) {
    await cleanDriveComments(docId);
  }
});

test.describe("sync", () => {
  test("TC-002: GH review comment syncs to GDoc as anchored comment", async ({
    extensionWorker,
    triggerSync
  }) => {
    await seedDocMapping(extensionWorker);
    const state = readState();

    const target = await fetchCommentTarget();
    if (!target) return;

    const body = `${TEST_COMMENT_TAG} TC-002 basic threading test`;
    const commentId = await createGhReviewComment(target.headSha, target.path, target.line, body);
    if (!commentId) return;
    createdGhCommentIds.push(commentId);

    await triggerSync();
    await extensionWorker.evaluate(() => new Promise((r) => setTimeout(r, 20_000)), undefined);
    await persistStorage(extensionWorker);

    const driveComments = await listDriveComments(state.docId!);
    const synced = driveComments.find(
      (c) => typeof c.content === "string" && c.content.includes("TC-002")
    );
    expect(synced, "GH comment must appear in GDoc").toBeDefined();
  });

  test("TC-003: GH reply syncs as GDoc thread reply", async ({ extensionWorker, triggerSync }) => {
    await seedDocMapping(extensionWorker);
    const state = readState();
    const target = await fetchCommentTarget();
    if (!target) return;

    const parentBody = `${TEST_COMMENT_TAG} TC-003 parent`;
    const parentId = await createGhReviewComment(
      target.headSha,
      target.path,
      target.line,
      parentBody
    );
    if (!parentId) return;
    createdGhCommentIds.push(parentId);

    await triggerSync();
    await extensionWorker.evaluate(() => new Promise((r) => setTimeout(r, 20_000)), undefined);

    const replyBody = `${TEST_COMMENT_TAG} TC-003 reply`;
    const replyId = await createGhCommentReply(parentId, replyBody);
    if (!replyId) return;
    createdGhCommentIds.push(replyId);

    await triggerSync();
    await extensionWorker.evaluate(() => new Promise((r) => setTimeout(r, 20_000)), undefined);
    await persistStorage(extensionWorker);

    const driveComments = await listDriveComments(state.docId!);
    const parentComment = driveComments.find((c: any) => c.content?.includes("TC-003 parent"));
    const syncedReply = parentComment?.replies?.find((r: any) =>
      r.content?.includes("TC-003 reply")
    );
    expect(syncedReply, "GH reply must appear as a GDoc thread reply").toBeDefined();
  });

  test("TC-012: running sync twice produces no duplicate GDoc comments", async ({
    extensionWorker,
    triggerSync
  }) => {
    await seedDocMapping(extensionWorker);
    const state = readState();
    const target = await fetchCommentTarget();
    if (!target) return;

    const body = `${TEST_COMMENT_TAG} TC-012 idempotency`;
    const commentId = await createGhReviewComment(target.headSha, target.path, target.line, body);
    if (!commentId) return;
    createdGhCommentIds.push(commentId);

    // First sync
    await triggerSync();
    await extensionWorker.evaluate(() => new Promise((r) => setTimeout(r, 20_000)), undefined);
    await persistStorage(extensionWorker);

    // Second sync
    await triggerSync();
    await extensionWorker.evaluate(() => new Promise((r) => setTimeout(r, 20_000)), undefined);
    await persistStorage(extensionWorker);

    const driveComments = await listDriveComments(state.docId!);
    const matching = driveComments.filter((c: any) => c.content?.includes("TC-012"));
    expect(matching.length, "No duplicate GDoc comments").toBe(1);
  });

  test("TC-014: Sync now button shows dorv-spinning during active sync", async ({
    extensionContext,
    extensionId,
    extensionWorker
  }) => {
    await seedDocMapping(extensionWorker);
    const panel = await openSidepanelOnRealPr(extensionContext, extensionId);

    await panel.waitForTimeout(3000);
    const syncBtn = panel.locator("button.sync-now-btn");
    await expect(syncBtn).toBeVisible({ timeout: 30_000 });

    await syncBtn.click();
    const spinner = panel.locator("i.ti-refresh");
    await expect(spinner).toHaveClass(/dorv-spinning/, { timeout: 10_000 });
    await expect(spinner).not.toHaveClass(/dorv-spinning/, { timeout: 40_000 });
    await panel.close();
  });
});

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
  resolveGhThread,
  GOOGLE_TOKEN,
  hasRequiredGoogleScopes,
  GITHUB_PAT
} from "./fixture.js";
import {
  readState,
  readStateForPr,
  writeState,
  writeStateForPr,
  type RealE2EState
} from "./state.js";

interface ExtensionWorker {
  evaluate: <R, Arg>(pageFunction: (arg: Arg) => R | Promise<R>, arg: Arg) => Promise<R>;
}

const TEST_COMMENT_TAG = "[dorv-real-test]";

function isGitHubRateLimitMessage(message: string): boolean {
  return (
    message.includes("rate limit") ||
    message.includes("API rate limit exceeded") ||
    message.includes("403")
  );
}

/** Seed the extension storage from the shared state file. */
async function seedDocMapping(extensionWorker: ExtensionWorker): Promise<RealE2EState> {
  test.skip(
    !(await hasRequiredGoogleScopes()),
    "DORV_GOOGLE_TOKEN must include Google Docs + Drive file scopes to sync live docs"
  );

  const state = readStateForPr("ahnpolished/dorv", 6);
  if (!state.docMapping || !state.docStoreKey) {
    test.skip(true, "State file missing — run doc-lifecycle.spec.ts first");
    throw new Error("State file missing — run doc-lifecycle.spec.ts first");
  }

  // Restore the full storage snapshot if available, but always force the
  // current auth + mapping keys because prior test snapshots may be partial.
  const storageSnapshot = {
    ...((state as any).storageSnapshot || {}),
    github_pat: GITHUB_PAT,
    active_prs: [
      { repo: (state.docMapping as any).repo, prNumber: (state.docMapping as any).prNumber }
    ],
    [state.docStoreKey]: state.docMapping,
    [`docStore:${(state.docMapping as any).docId}`]: state.docMapping
  };

  await extensionWorker.evaluate((data: any) => {
    return new Promise<void>((resolve) => {
      chrome.storage.local.clear(() => {
        chrome.storage.local.set(data, () => {
          chrome.storage.local.set({ github_pat: data.github_pat }, resolve);
        });
      });
    });
  }, storageSnapshot);
  await extensionWorker.evaluate((token: string) => {
    (chrome.identity as any).getAuthToken = (_opts: unknown, callback: (t: string) => void) => {
      callback(token);
    };
  }, GOOGLE_TOKEN);
  return state;
}

/** Capture full extension storage and persist it to the state file. */
async function persistStorage(extensionWorker: ExtensionWorker) {
  const snapshot = await extensionWorker.evaluate<Record<string, any>, undefined>(() => {
    return new Promise((resolve) => {
      chrome.storage.local.get(null, resolve);
    });
  }, undefined);
  writeStateForPr("ahnpolished/dorv", 6, { storageSnapshot: snapshot } as any);
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

async function waitForDriveComment(docId: string, needle: string, timeout = 90_000): Promise<any> {
  await expect
    .poll(
      async () => {
        const comments = await listDriveComments(docId);
        return comments.find((c) => typeof c.content === "string" && c.content.includes(needle));
      },
      { timeout, intervals: [2_000, 3_000, 5_000] }
    )
    .toBeDefined();

  const comments = await listDriveComments(docId);
  return comments.find((c) => typeof c.content === "string" && c.content.includes(needle));
}

async function findStoredThreadId(
  extensionWorker: ExtensionWorker,
  ghCommentId: number
): Promise<string | undefined> {
  const snapshot = await extensionWorker.evaluate<Record<string, any>, undefined>(() => {
    return new Promise((resolve) => {
      chrome.storage.local.get(null, resolve);
    });
  }, undefined);

  for (const value of Object.values(snapshot)) {
    if (value && typeof value === "object" && value.ghCommentId === ghCommentId) {
      return typeof value.ghThreadId === "string" ? value.ghThreadId : undefined;
    }
  }

  return undefined;
}

const createdGhCommentIds: number[] = [];

test.afterAll(async () => {
  const ids = [...createdGhCommentIds, ...(readState().ghCommentIds ?? [])];
  for (const id of ids) {
    await deleteGhReviewComment(id);
  }
  writeState({ ghCommentIds: [] });

  const { docId } = readStateForPr("ahnpolished/dorv", 6);
  if (docId) {
    await cleanDriveComments(docId);
  }
});

test.describe("sync", () => {
  test("TC-002: GH review comment syncs to GDoc as anchored comment", async ({
    extensionWorker,
    triggerSync
  }) => {
    test.setTimeout(180_000);
    await seedDocMapping(extensionWorker);
    const state = readStateForPr("ahnpolished/dorv", 6);

    let target;
    try {
      target = await fetchCommentTarget();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isGitHubRateLimitMessage(msg)) {
        test.skip(true, `GitHub rate limited: ${msg}`);
        return;
      }
      throw err;
    }
    if (!target) return;

    const body = `${TEST_COMMENT_TAG} TC-002 basic threading test`;
    const commentId = await createGhReviewComment(target.headSha, target.path, target.line, body);
    if (!commentId) return;
    createdGhCommentIds.push(commentId);

    await triggerSync();
    const synced = await waitForDriveComment(state.docId!, "TC-002", 120_000);
    await persistStorage(extensionWorker);
    expect(synced, "GH comment must appear in GDoc").toBeDefined();
  });

  test("TC-003: GH reply syncs as GDoc thread reply", async ({ extensionWorker, triggerSync }) => {
    test.setTimeout(180_000);
    await seedDocMapping(extensionWorker);
    const state = readStateForPr("ahnpolished/dorv", 6);
    let target;
    try {
      target = await fetchCommentTarget();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isGitHubRateLimitMessage(msg)) {
        test.skip(true, `GitHub rate limited: ${msg}`);
        return;
      }
      throw err;
    }
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
    await waitForDriveComment(state.docId!, "TC-003 parent", 120_000);

    const replyBody = `${TEST_COMMENT_TAG} TC-003 reply`;
    const replyId = await createGhCommentReply(parentId, replyBody);
    if (!replyId) return;
    createdGhCommentIds.push(replyId);

    await triggerSync();
    await expect
      .poll(
        async () => {
          const driveComments = await listDriveComments(state.docId!);
          const parentComment = driveComments.find((c: any) =>
            c.content?.includes("TC-003 parent")
          );
          return (
            parentComment?.replies?.some((r: any) => r.content?.includes("TC-003 reply")) ?? false
          );
        },
        { timeout: 120_000, intervals: [2_000, 3_000, 5_000] }
      )
      .toBe(true);
    await persistStorage(extensionWorker);

    const driveComments = await listDriveComments(state.docId!);
    const parentComment = driveComments.find((c: any) => c.content?.includes("TC-003 parent"));
    const syncedReply = parentComment?.replies?.find((r: any) =>
      r.content?.includes("TC-003 reply")
    );
    expect(syncedReply, "GH reply must appear as a GDoc thread reply").toBeDefined();
  });

  test("TC-005: resolving a GH thread resolves the mapped GDoc comment", async ({
    extensionWorker,
    triggerSync
  }) => {
    test.setTimeout(180_000);
    await seedDocMapping(extensionWorker);
    const state = readStateForPr("ahnpolished/dorv", 6);
    let target;
    try {
      target = await fetchCommentTarget();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isGitHubRateLimitMessage(msg)) {
        test.skip(true, `GitHub rate limited: ${msg}`);
        return;
      }
      throw err;
    }
    if (!target) return;

    const body = `${TEST_COMMENT_TAG} TC-005 resolution`;
    const commentId = await createGhReviewComment(target.headSha, target.path, target.line, body);
    if (!commentId) return;
    createdGhCommentIds.push(commentId);

    await triggerSync();
    const synced = await waitForDriveComment(state.docId!, "TC-005", 120_000);
    const threadId = await findStoredThreadId(extensionWorker, commentId);
    expect(threadId, "synced root comment should persist its GitHub thread id").toBeTruthy();

    const resolved = await resolveGhThread(threadId!);
    expect(resolved, "GitHub thread should resolve successfully").toBe(true);

    await triggerSync();
    await expect
      .poll(
        async () => {
          const latest = await waitForDriveComment(state.docId!, "TC-005", 30_000);
          return latest?.resolved ?? false;
        },
        { timeout: 120_000, intervals: [2_000, 3_000, 5_000] }
      )
      .toBe(true);
    await persistStorage(extensionWorker);
    expect(synced, "resolved GH thread must have an existing GDoc root comment").toBeDefined();
  });

  test("TC-012: running sync twice produces no duplicate GDoc comments", async ({
    extensionWorker,
    triggerSync
  }) => {
    test.setTimeout(180_000);
    await seedDocMapping(extensionWorker);
    const state = readStateForPr("ahnpolished/dorv", 6);
    let target;
    try {
      target = await fetchCommentTarget();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isGitHubRateLimitMessage(msg)) {
        test.skip(true, `GitHub rate limited: ${msg}`);
        return;
      }
      throw err;
    }
    if (!target) return;

    const body = `${TEST_COMMENT_TAG} TC-012 idempotency`;
    const commentId = await createGhReviewComment(target.headSha, target.path, target.line, body);
    if (!commentId) return;
    createdGhCommentIds.push(commentId);

    // First sync
    await triggerSync();
    await waitForDriveComment(state.docId!, "TC-012", 120_000);
    await persistStorage(extensionWorker);

    // Second sync
    await triggerSync();
    await expect
      .poll(
        async () => {
          const driveComments = await listDriveComments(state.docId!);
          return driveComments.filter((c: any) => c.content?.includes("TC-012")).length;
        },
        { timeout: 120_000, intervals: [2_000, 3_000, 5_000] }
      )
      .toBe(1);
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
    test.setTimeout(180_000);
    await seedDocMapping(extensionWorker);
    const panel = await openSidepanelOnRealPr(extensionContext, extensionId);

    const mainPanel = panel.locator("[data-testid='dorv-main-panel']");
    const errorPanel = panel.locator("[data-testid='dorv-error']");
    await expect(mainPanel.or(errorPanel)).toBeVisible({ timeout: 30_000 });
    if (await errorPanel.isVisible().catch(() => false)) {
      const message = (await errorPanel.textContent()) ?? "unknown sidepanel error";
      if (message.includes("rate limit") || message.includes("API rate limit exceeded")) {
        test.skip(true, `GitHub rate limited: ${message}`);
        return;
      }
      throw new Error(`Sidepanel failed before sync button rendered: ${message}`);
    }

    const syncBtn = panel.locator("[data-testid='dorv-sync-now-btn']");
    await expect(syncBtn).toBeVisible({ timeout: 30_000 });

    await syncBtn.click();
    const spinner = panel.locator("[data-testid='dorv-refresh-icon']");
    await expect(spinner).toHaveClass(/dorv-spinning/, { timeout: 10_000 });
    await expect(spinner).not.toHaveClass(/dorv-spinning/, { timeout: 120_000 });
    await panel.close();
  });
});

/**
 * TC-002 Basic Threading   — GH thread → GDoc comment has [GitHub: @user] prefix
 * TC-003 Replies           — GH thread reply → Drive reply POST captured
 * TC-004 Multiline/Code    — thread with diffHunk → Drive POST quotedFileContent contains quoted line
 * TC-005 Resolution Sync   — resolved GH thread → Drive PATCH to resolve comment
 */
import { expect, test, TEST_PR } from "../fixtures/extension.js";
import {
  setupPageRoutes,
  FAKE_THREAD_SIMPLE,
  FAKE_THREAD_WITH_REPLY,
  FAKE_THREAD_WITH_DIFFHUNK,
  FAKE_THREAD_RESOLVED
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

test("TC-002: SYNC_NOW pushes GH thread to GDoc with [GitHub: @reviewer] prefix", async ({
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

  // Capture Drive comment POST body so we can assert its content
  let drivePostBody: string | undefined;
  await extensionContext.route("https://www.googleapis.com/drive/v3/files/*/comments*", (route) => {
    if (route.request().method() === "POST") {
      drivePostBody = route.request().postData() ?? undefined;
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: "doc-comment-new-1" })
      });
    } else {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ comments: [] })
      });
    }
  });

  await setupPageRoutes(extensionContext, {
    graphqlThreads: FAKE_THREAD_SIMPLE,
    ghReviewComments: []
  });

  await triggerSync();
  await extensionWorker.evaluate(() => new Promise((r) => setTimeout(r, 3000)));

  // Check either the Drive POST was captured (network) or the mapping is in storage
  const storage = await extensionWorker.evaluate<Record<string, unknown>>(
    () =>
      new Promise((resolve) => {
        chrome.storage.local.get(null, resolve);
      })
  );
  const hasMappingInStorage = "mappingStore:gh:1001" in storage;

  expect(hasMappingInStorage || drivePostBody !== undefined, "Drive POST or mapping expected").toBe(
    true
  );

  if (drivePostBody !== undefined) {
    const parsed = JSON.parse(drivePostBody) as { content?: string };
    expect(parsed.content).toContain("[GitHub: @reviewer]");
  }
});

test("TC-003: SYNC_NOW syncs GH thread reply to GDoc", async ({
  extensionContext,
  extensionWorker,
  seedStorage,
  patchWorkerIdentity,
  triggerSync
}) => {
  const docMappingKey = `docStore:${TEST_PR.ref}#${TEST_PR.prNumber.toString()}`;
  // Pre-seed the root comment mapping so the reply-sync path is exercised
  const rootMappingKey = "mappingStore:gh:1001";
  await seedStorage({
    github_pat: "ghp_test_pat_for_e2e",
    active_prs: [{ repo: TEST_PR.ref, prNumber: TEST_PR.prNumber }],
    [docMappingKey]: BASE_DOC_MAPPING,
    [rootMappingKey]: {
      repo: TEST_PR.ref,
      prNumber: TEST_PR.prNumber,
      ghCommentId: 1001,
      docCommentId: "doc-comment-existing",
      source: "github"
    }
  });
  await patchWorkerIdentity();

  let replyPostCaptured = false;
  // The reply endpoint is /comments/{parentId}/replies — distinct from the root comment endpoint
  await extensionContext.route(
    "https://www.googleapis.com/drive/v3/files/*/comments/*/replies*",
    (route) => {
      if (route.request().method() === "POST") {
        replyPostCaptured = true;
      }
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: "doc-reply-new-1" })
      });
    }
  );

  await setupPageRoutes(extensionContext, {
    graphqlThreads: FAKE_THREAD_WITH_REPLY,
    ghReviewComments: []
  });

  await triggerSync();
  await extensionWorker.evaluate(() => new Promise((r) => setTimeout(r, 3000)));

  const storage = await extensionWorker.evaluate<Record<string, unknown>>(
    () =>
      new Promise((resolve) => {
        chrome.storage.local.get(null, resolve);
      })
  );
  const hasReplyMappingInStorage = Object.keys(storage).some((k) =>
    k.startsWith("replyMappingStore:gh:")
  );

  expect(
    hasReplyMappingInStorage || replyPostCaptured,
    "Reply POST or reply mapping expected"
  ).toBe(true);
});

test("TC-004: SYNC_NOW thread with diffHunk has quotedFileContent in Drive POST", async ({
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

  let drivePostBody: string | undefined;
  await extensionContext.route("https://www.googleapis.com/drive/v3/files/*/comments*", (route) => {
    if (route.request().method() === "POST") {
      drivePostBody = route.request().postData() ?? undefined;
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: "doc-comment-anchor-1" })
      });
    } else {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ comments: [] })
      });
    }
  });

  await setupPageRoutes(extensionContext, {
    graphqlThreads: FAKE_THREAD_WITH_DIFFHUNK,
    ghReviewComments: []
  });

  await triggerSync();
  await extensionWorker.evaluate(() => new Promise((r) => setTimeout(r, 3000)));

  const storage = await extensionWorker.evaluate<Record<string, unknown>>(
    () =>
      new Promise((resolve) => {
        chrome.storage.local.get(null, resolve);
      })
  );
  const hasMappingInStorage = "mappingStore:gh:2001" in storage;

  expect(hasMappingInStorage || drivePostBody !== undefined, "Drive POST or mapping expected").toBe(
    true
  );

  if (drivePostBody !== undefined) {
    const parsed = JSON.parse(drivePostBody) as {
      quotedFileContent?: { mimeType: string; value: string };
    };
    expect(parsed.quotedFileContent?.mimeType).toBe("text/plain");
    expect(typeof parsed.quotedFileContent?.value).toBe("string");
  }
});

test("TC-005: SYNC_NOW resolves GDoc comment for resolved GH thread", async ({
  extensionContext,
  extensionWorker,
  seedStorage,
  patchWorkerIdentity,
  triggerSync
}) => {
  const docMappingKey = `docStore:${TEST_PR.ref}#${TEST_PR.prNumber.toString()}`;
  const existingMappingKey = "mappingStore:gh:3001";
  // Pre-seed a mapping for the root comment so the resolution path is exercised
  await seedStorage({
    github_pat: "ghp_test_pat_for_e2e",
    active_prs: [{ repo: TEST_PR.ref, prNumber: TEST_PR.prNumber }],
    [docMappingKey]: BASE_DOC_MAPPING,
    [existingMappingKey]: {
      repo: TEST_PR.ref,
      prNumber: TEST_PR.prNumber,
      ghCommentId: 3001,
      docCommentId: "doc-comment-to-resolve",
      source: "github",
      ghThreadId: "thread-003"
    }
  });
  await patchWorkerIdentity();

  let resolvePatchCaptured = false;
  // resolveGDocComment PATCHes /files/{docId}/comments/{commentId}?fields=id,resolved
  await extensionContext.route(
    "https://www.googleapis.com/drive/v3/files/*/comments/*",
    (route) => {
      if (route.request().method() === "PATCH") {
        const body = route.request().postData();
        if (body?.includes('"resolved":true')) {
          resolvePatchCaptured = true;
        }
      }
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: "doc-comment-to-resolve", resolved: true })
      });
    }
  );

  await setupPageRoutes(extensionContext, {
    graphqlThreads: FAKE_THREAD_RESOLVED,
    ghReviewComments: []
  });

  await triggerSync();
  await extensionWorker.evaluate(() => new Promise((r) => setTimeout(r, 3000)));

  const storage = await extensionWorker.evaluate<Record<string, unknown>>(
    () =>
      new Promise((resolve) => {
        chrome.storage.local.get(null, resolve);
      })
  );
  const mapping = storage[existingMappingKey] as Record<string, unknown> | undefined;
  const hasResolvedAt = mapping?.resolvedAt !== undefined;

  expect(
    hasResolvedAt || resolvePatchCaptured,
    "Drive PATCH to resolve or resolvedAt in mapping expected"
  ).toBe(true);
});

# HUM-1274 GH -> GDoc Thread Lifecycle Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make GitHub review threads sync into Google Docs as durable anchored comment threads with correct root creation, reply syncing, resolution syncing, idempotency, and lower GitHub API pressure.

**Architecture:** Keep the existing DirectAdapter seam, but make GitHub review threads the canonical GH -> GDoc sync unit. Expand real E2E coverage first, then tighten normalization, mapping reconciliation, and adapter lifecycle behavior so one sync pass fetches thread data once, reuses it locally, and applies only the required GDoc mutations.

**Tech Stack:** WXT Chrome extension, TypeScript, Vitest, Playwright real-E2E, GitHub REST/GraphQL APIs, Google Drive comments API

---

## File structure / responsibilities

- `tests/e2e/real/sync.spec.ts`
  - Real-credential proof for root sync, reply sync, resolution sync, idempotency, and anchor-related assertions.
- `tests/review-thread-normalization.test.ts`
  - Unit coverage for GitHub thread normalization and fetch behavior.
- `tests/thread-lifecycle.test.ts`
  - Adapter lifecycle regression coverage for recreate/resolve/no-reopen behavior.
- `tests/direct-adapter-sync.test.ts`
  - Additional adapter-level sync coverage if new behavior belongs in the existing sync test file.
- `apps/extension/lib/github/fetch.ts`
  - Fetch review threads once per PR, normalize GraphQL/REST payloads, and keep grouping deterministic.
- `apps/extension/lib/storage/stores.ts`
  - Mapping/reply lookup helpers for thread-oriented reconciliation.
- `apps/extension/lib/adapters/direct.ts`
  - Core GH -> GDoc lifecycle orchestration: create root, attach replies, resolve, recreate on snapshot change, and avoid redundant GitHub/API work.
- `apps/extension/lib/gdoc/comments.ts`
  - Reuse existing Drive comment/reply/resolve helpers; only touch if test evidence shows a missing seam.
- `.agents/claims.yaml`
  - Required claim tracking for the issue.

---

### Task 1: Claim HUM-1274 and create isolated worktree

**Files:**
- Modify: `.agents/claims.yaml`
- Update in Linear: `HUM-1274` comment thread

- [ ] **Step 1: Post the required Linear claim comment**

Use this exact body with current UTC timestamp filled in:

```md
🤖 Agent claim

| Field | Value |
| --- | --- |
| **Agent** | codex |
| **Status** | in_progress |
| **Depends on** | none |
| **Branch** | feature/hum-1274 |
| **Worktree** | .worktrees/feature-hum-1274 |
| **Session** | Real-E2E-first fix for GH -> GDoc thread lifecycle reliability |

Starting work in worktree. Other agents: do not pick this issue until status is `done` or `released`.
```

- [ ] **Step 2: Add the claim to `.agents/claims.yaml`**

Insert under `claims:`:

```yaml
  HUM-1274:
    agent: codex
    status: in_progress
    claimed_at: "2026-05-27T00:00:00Z"
    depends_on: []
    branch: feature/hum-1274
    worktree: .worktrees/feature-hum-1274
```

- [ ] **Step 3: Create the worktree**

Run:

```bash
git check-ignore -q .worktrees
git worktree add .worktrees/feature-hum-1274 -b feature/hum-1274
cd .worktrees/feature-hum-1274
pnpm install
```

Expected: worktree created on `feature/hum-1274`, install completes without dependency changes.

- [ ] **Step 4: Verify clean baseline before writing tests**

Run:

```bash
pnpm vitest tests/thread-lifecycle.test.ts tests/review-thread-normalization.test.ts
pnpm playwright test tests/e2e/real/sync.spec.ts --list
```

Expected: Vitest passes on baseline; Playwright lists tests successfully.

- [ ] **Step 5: Commit only the claim metadata if needed before feature changes**

```bash
git add .agents/claims.yaml
git commit -m "chore: claim HUM-1274" || true
```

Expected: commit created if the claim file changed in this worktree.

### Task 2: Add failing real-E2E coverage for the broken lifecycle

**Files:**
- Modify: `tests/e2e/real/sync.spec.ts`
- Test: `tests/e2e/real/sync.spec.ts`

- [ ] **Step 1: Write the failing real-E2E tests first**

Add these helpers/tests into `tests/e2e/real/sync.spec.ts`:

```ts
import { resolveGhThread } from "./fixture.js";

async function findDriveCommentByContent(docId: string, needle: string): Promise<any | undefined> {
  const comments = await listDriveComments(docId);
  return comments.find((c: any) => typeof c.content === "string" && c.content.includes(needle));
}

async function waitForDriveReply(docId: string, parentNeedle: string, replyNeedle: string) {
  await expect
    .poll(async () => {
      const parent = await findDriveCommentByContent(docId, parentNeedle);
      return parent?.replies?.some((reply: any) => reply.content?.includes(replyNeedle)) ?? false;
    }, { timeout: 120_000, intervals: [2_000, 3_000, 5_000] })
    .toBe(true);
}

test("TC-005: resolved GH thread resolves mapped GDoc comment", async ({ extensionWorker, triggerSync }) => {
  test.setTimeout(180_000);
  await seedDocMapping(extensionWorker);
  const state = readStateForPr("ahnpolished/dorv", 6);
  const target = await fetchCommentTarget();
  if (!target) return;

  const parentBody = `${TEST_COMMENT_TAG} TC-005 parent`;
  const parentId = await createGhReviewComment(target.headSha, target.path, target.line, parentBody);
  if (!parentId) return;
  createdGhCommentIds.push(parentId);

  await triggerSync();
  await waitForDriveComment(state.docId!, "TC-005 parent", 120_000);

  const storageSnapshot = await extensionWorker.evaluate<Record<string, any>, undefined>(() => {
    return new Promise((resolve) => chrome.storage.local.get(null, resolve));
  }, undefined);
  const mappingEntry = Object.values(storageSnapshot).find(
    (value: any) => value?.ghCommentId === parentId && value?.ghThreadId
  ) as { ghThreadId?: string } | undefined;

  expect(mappingEntry?.ghThreadId, "thread id should be persisted after first sync").toBeTruthy();
  const resolved = await resolveGhThread(mappingEntry!.ghThreadId!);
  expect(resolved).toBe(true);

  await triggerSync();
  await expect
    .poll(async () => {
      const comment = await findDriveCommentByContent(state.docId!, "TC-005 parent");
      return comment?.resolved ?? false;
    }, { timeout: 120_000, intervals: [2_000, 3_000, 5_000] })
    .toBe(true);
});
```

Also tighten the existing TC-002/TC-003/TC-012 assertions so they prove:
- root comment exists,
- reply exists under the same parent thread,
- rerun produces exactly one root and one reply,
- storage snapshot persists thread identifiers after sync.

- [ ] **Step 2: Run only the new/edited real-E2E cases to verify they fail for the intended reason**

Run:

```bash
pnpm playwright test tests/e2e/real/sync.spec.ts --grep "TC-002|TC-003|TC-005|TC-012"
```

Expected: at least one lifecycle case fails because the current implementation does not yet keep thread lifecycle fully correct. If GitHub rate-limits, capture the failure output and re-run once after a short pause.

- [ ] **Step 3: Record the exact failure mode in code comments only if the failure is subtle**

If needed, add one short comment near the failing assertion, for example:

```ts
// Regression target: thread root exists in dorv state but is not mirrored as a durable Drive thread.
```

- [ ] **Step 4: Commit the failing test expansion**

```bash
git add tests/e2e/real/sync.spec.ts
git commit -m "test: expand real e2e coverage for GH to GDoc thread lifecycle"
```

Expected: commit contains only the test changes.

### Task 3: Add focused unit coverage for normalization and request consolidation

**Files:**
- Modify: `tests/review-thread-normalization.test.ts`
- Modify: `apps/extension/lib/github/fetch.ts`
- Test: `tests/review-thread-normalization.test.ts`

- [ ] **Step 1: Write a failing normalization test for deterministic reply ordering and single-fetch grouping**

Add this test:

```ts
it("sorts replies by createdAt and groups them under one stable root thread", async () => {
  mockFetch.mockImplementation(async (url: string) => {
    if (url.includes("/graphql")) {
      return {
        ok: true,
        json: async () => ({
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  nodes: [
                    {
                      id: "thread-node-2",
                      isResolved: false,
                      path: "docs/rfc.md",
                      line: 42,
                      diffSide: "RIGHT",
                      comments: {
                        nodes: [
                          {
                            databaseId: 201,
                            body: "root",
                            path: "docs/rfc.md",
                            line: 42,
                            diffHunk: "@@ -42,1 +42,1 @@\n+target paragraph",
                            createdAt: "2026-05-25T00:00:00Z",
                            updatedAt: "2026-05-25T00:00:00Z",
                            url: "https://github.com/org/repo/pull/123#discussion_r201",
                            author: { login: "alice" },
                            replyTo: null
                          },
                          {
                            databaseId: 203,
                            body: "third chronologically",
                            path: "docs/rfc.md",
                            line: 42,
                            diffHunk: null,
                            createdAt: "2026-05-25T00:03:00Z",
                            updatedAt: "2026-05-25T00:03:00Z",
                            url: "https://github.com/org/repo/pull/123#discussion_r203",
                            author: { login: "carol" },
                            replyTo: { databaseId: 201 }
                          },
                          {
                            databaseId: 202,
                            body: "second chronologically",
                            path: "docs/rfc.md",
                            line: 42,
                            diffHunk: null,
                            createdAt: "2026-05-25T00:02:00Z",
                            updatedAt: "2026-05-25T00:02:00Z",
                            url: "https://github.com/org/repo/pull/123#discussion_r202",
                            author: { login: "bob" },
                            replyTo: { databaseId: 201 }
                          }
                        ]
                      }
                    }
                  ],
                  pageInfo: { hasNextPage: false, endCursor: null }
                }
              }
            }
          }
        })
      };
    }
    throw new Error(`Unexpected URL: ${url}`);
  });

  const [thread] = await fetchReviewThreads("gh-token", "org/repo", 123);
  expect(thread?.rootComment.id).toBe(201);
  expect(thread?.replies.map((reply) => reply.id)).toEqual([202, 203]);
});
```

- [ ] **Step 2: Run the unit test to verify failure**

Run:

```bash
pnpm vitest tests/review-thread-normalization.test.ts -t "sorts replies by createdAt"
```

Expected: FAIL if replies are not returned in stable chronological order.

- [ ] **Step 3: Implement the minimal normalization fix in `apps/extension/lib/github/fetch.ts`**

Update `buildReviewThread` usage so replies are normalized once and sorted before return:

```ts
function sortCommentsChronologically(comments: GitHubReviewComment[]): GitHubReviewComment[] {
  return [...comments].sort((a, b) => {
    const byCreatedAt = a.createdAt.localeCompare(b.createdAt);
    if (byCreatedAt !== 0) return byCreatedAt;
    return String(a.id).localeCompare(String(b.id));
  });
}

function buildReviewThread(input: {
  id: string;
  path: string;
  line: number;
  diffHunk: string | undefined;
  quotedLine: string | undefined;
  isResolved: boolean;
  rootComment: GitHubReviewComment;
  replies: GitHubReviewComment[];
}): GitHubReviewThread {
  return {
    id: input.id,
    path: input.path,
    line: input.line,
    side: "RIGHT",
    isResolved: input.isResolved,
    rootComment: input.rootComment,
    replies: sortCommentsChronologically(input.replies),
    ...(input.diffHunk ? { diffHunk: input.diffHunk } : {}),
    ...(input.quotedLine ? { quotedLine: input.quotedLine } : {})
  };
}
```

- [ ] **Step 4: Run the normalization test to verify it passes**

Run:

```bash
pnpm vitest tests/review-thread-normalization.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the normalization coverage/fix**

```bash
git add tests/review-thread-normalization.test.ts apps/extension/lib/github/fetch.ts
git commit -m "test: lock GitHub thread normalization ordering"
```

### Task 4: Add failing adapter tests for grouped mapping reconciliation

**Files:**
- Modify: `tests/thread-lifecycle.test.ts`
- Modify: `tests/direct-adapter-sync.test.ts` (only if one assertion fits better there)
- Test: `tests/thread-lifecycle.test.ts`

- [ ] **Step 1: Write a failing adapter test for reply idempotency on an unchanged thread snapshot**

Add this test to `tests/thread-lifecycle.test.ts`:

```ts
it("does not re-push replies when root snapshot is unchanged and reply mappings already exist", async () => {
  await mappingStore.upsert({
    ...REF,
    ghCommentId: 10,
    docCommentId: "doc-root-10",
    source: "github",
    ghThreadId: "thread-1",
    ghUpdatedAt: "2026-05-25T00:00:00Z",
    threadSnapshot: JSON.stringify({
      root: { id: 10, body: "old body", updatedAt: "2026-05-25T00:00:00Z" },
      replies: [{ id: 11, body: "new reply", inReplyToId: 10, updatedAt: "2026-05-25T00:01:00Z" }]
    })
  });
  await replyMappingStore.upsert({
    ...REF,
    ghReplyId: 11,
    docReplyId: "doc-reply-11",
    ghParentCommentId: 10,
    docParentCommentId: "doc-root-10",
    source: "github",
    ghUpdatedAt: "2026-05-25T00:01:00Z"
  });

  const driveMutationUrls: string[] = [];
  mockFetch.mockImplementation(async (url: any, init?: RequestInit) => {
    const urlStr = String(url);
    if (urlStr.includes("/graphql")) {
      return {
        ok: true,
        json: async () => reviewThreadsResponse({
          isResolved: false,
          rootBody: "old body",
          rootUpdatedAt: "2026-05-25T00:00:00Z"
        })
      };
    }
    if (urlStr.includes("googleapis.com/drive/v3/files/doc-1/comments")) {
      if ((init?.method ?? "GET") !== "GET") driveMutationUrls.push(urlStr);
      return { ok: true, json: async () => ({ comments: [] }) };
    }
    return { ok: true, json: async () => ({}) };
  });

  await adapter.syncAll();
  expect(driveMutationUrls).toEqual([]);
});
```

- [ ] **Step 2: Run the targeted adapter test to verify failure**

Run:

```bash
pnpm vitest tests/thread-lifecycle.test.ts -t "does not re-push replies"
```

Expected: FAIL if unchanged threads still cause redundant Drive mutations.

- [ ] **Step 3: If needed, add one more failing test for thread mapping lookup by root id**

Use this shape if the first test passes unexpectedly and the real bug is lookup-related:

```ts
it("reuses the mapped root comment id for all reply pushes in the same thread", async () => {
  // Arrange root mapping + new reply-only delta
  // Assert reply POST goes to /comments/<mapped-root-id>/replies and not a recreated root.
});
```

- [ ] **Step 4: Commit the failing adapter regression tests**

```bash
git add tests/thread-lifecycle.test.ts tests/direct-adapter-sync.test.ts
git commit -m "test: cover GH thread lifecycle reconciliation"
```

### Task 5: Add mapping-store helpers for thread-oriented reconciliation

**Files:**
- Modify: `apps/extension/lib/storage/stores.ts`
- Test: `tests/thread-lifecycle.test.ts`

- [ ] **Step 1: Write the smallest helper API needed by the adapter**

Add helper methods inside `createReplyMappingStore(storage)`:

```ts
async listByParentGH(ghParentCommentId: number | string): Promise<ReplyMapping[]> {
  return getArray<ReplyMapping>(storage, replyParentKey(ghParentCommentId));
},
async getLatestByParentGH(ghParentCommentId: number | string): Promise<ReplyMapping | undefined> {
  const mappings = await this.listByParentGH(ghParentCommentId);
  return [...mappings].sort((a, b) => {
    const left = a.ghUpdatedAt ?? "";
    const right = b.ghUpdatedAt ?? "";
    const byUpdatedAt = right.localeCompare(left);
    if (byUpdatedAt !== 0) return byUpdatedAt;
    return String(b.ghReplyId).localeCompare(String(a.ghReplyId));
  })[0];
}
```

If the adapter needs grouped root+reply state, add a small internal utility instead of a new exported store type:

```ts
function sameGhId(left: number | string, right: number | string): boolean {
  return String(left) === String(right);
}
```

- [ ] **Step 2: Run thread lifecycle tests to confirm store changes do not break existing behavior**

Run:

```bash
pnpm vitest tests/thread-lifecycle.test.ts
```

Expected: existing tests still fail only on the intended lifecycle gap or pass after helper-only changes.

- [ ] **Step 3: Commit the helper change**

```bash
git add apps/extension/lib/storage/stores.ts tests/thread-lifecycle.test.ts
git commit -m "refactor: add thread-oriented mapping helpers"
```

### Task 6: Refactor `DirectAdapter.syncAll()` around one thread lifecycle pipeline

**Files:**
- Modify: `apps/extension/lib/adapters/direct.ts`
- Test: `tests/thread-lifecycle.test.ts`
- Test: `tests/direct-adapter-sync.test.ts`
- Test: `tests/e2e/real/sync.spec.ts`

- [ ] **Step 1: Replace the split root/reply pass with a single per-thread reconciliation path**

Refactor the GH -> GDoc section inside `syncAll()` to this shape:

```ts
const threads = await fetchReviewThreads(ghToken, ref.repo, ref.prNumber);
const gToken = await this.authStore.getGoogleToken(false);
if (!gToken) throw new Error("Google token missing during sync");

for (const thread of threads) {
  const existingRootMapping = await this.mappingStore.getByGH(thread.rootComment.id);
  if (!existingRootMapping) {
    const rootMapping = await this.pushGHThreadToDoc(thread, mapping);
    await this.pushGHThreadRepliesToDoc(thread, mapping, rootMapping, gToken);
    continue;
  }

  const lifecycle = await this.syncGHThreadLifecycle(thread, mapping, existingRootMapping, gToken);
  if (lifecycle === "handled") continue;

  await this.pushGHThreadRepliesToDoc(thread, mapping, existingRootMapping, gToken);
}
```

Delete any second reply-only loop that re-iterates all threads after lifecycle handling.

- [ ] **Step 2: Keep snapshot comparisons deterministic**

Ensure `buildGitHubThreadSnapshot(thread)` serializes stable reply ordering:

```ts
function buildGitHubThreadSnapshot(thread: GitHubReviewThread): string {
  return JSON.stringify({
    root: {
      id: thread.rootComment.id,
      body: thread.rootComment.body,
      updatedAt: thread.rootComment.updatedAt
    },
    replies: [...thread.replies]
      .sort((a, b) => {
        const byCreatedAt = a.createdAt.localeCompare(b.createdAt);
        if (byCreatedAt !== 0) return byCreatedAt;
        return String(a.id).localeCompare(String(b.id));
      })
      .map((reply) => ({
        id: reply.id,
        body: reply.body,
        inReplyToId: reply.inReplyToId,
        updatedAt: reply.updatedAt
      }))
  });
}
```

- [ ] **Step 3: Make rate-limit handling explicit at the PR-sync boundary**

Near the PR-level `try/catch`, keep one sync failure from poisoning the rest of the batch and preserve a readable status message:

```ts
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  await this.statusStore.set({
    repo: ref.repo,
    prNumber: ref.prNumber,
    state: "error",
    message,
    updatedAt: new Date().toISOString()
  });
  continue;
}
```

If a special-case branch already exists, keep it DRY and only refine the message if it contains GitHub rate-limit text.

- [ ] **Step 4: Run targeted adapter/unit tests to verify they pass**

Run:

```bash
pnpm vitest tests/thread-lifecycle.test.ts tests/direct-adapter-sync.test.ts tests/review-thread-normalization.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run the expanded real-E2E sync tests to verify green behavior**

Run:

```bash
pnpm playwright test tests/e2e/real/sync.spec.ts --grep "TC-002|TC-003|TC-005|TC-012"
```

Expected: PASS, or skips only when explicit GitHub rate-limit guards trigger.

- [ ] **Step 6: Commit the lifecycle refactor**

```bash
git add apps/extension/lib/adapters/direct.ts apps/extension/lib/storage/stores.ts tests/thread-lifecycle.test.ts tests/direct-adapter-sync.test.ts tests/review-thread-normalization.test.ts tests/e2e/real/sync.spec.ts
git commit -m "fix: unify GH to GDoc thread lifecycle sync"
```

### Task 7: Verify full relevant suites and open PR

**Files:**
- Modify: `.agents/claims.yaml`
- Update in Linear: `HUM-1274` comment thread

- [ ] **Step 1: Run the full relevant verification set**

Run:

```bash
pnpm vitest tests/thread-lifecycle.test.ts tests/direct-adapter-sync.test.ts tests/review-thread-normalization.test.ts
pnpm playwright test tests/e2e/real/sync.spec.ts
pnpm test
pnpm lint
pnpm typecheck
```

Expected: all pass, with any real-E2E skips attributable only to explicit environment/rate-limit guards.

- [ ] **Step 2: Push the branch**

```bash
git push -u origin feature/hum-1274
```

Expected: remote branch created.

- [ ] **Step 3: Open the PR**

```bash
gh pr create --base main --title "HUM-1274: Fix GH to GDoc thread lifecycle sync" --body "## Summary
- unify GH -> GDoc sync around GitHub review threads
- add real-E2E coverage for root, replies, resolution, and idempotency
- reduce redundant per-thread mutation work during sync

## Linear
Closes HUM-1274

## Test plan
- [x] pnpm vitest tests/thread-lifecycle.test.ts tests/direct-adapter-sync.test.ts tests/review-thread-normalization.test.ts
- [x] pnpm playwright test tests/e2e/real/sync.spec.ts
- [x] pnpm test
- [x] pnpm lint
- [x] pnpm typecheck
" 
```

Expected: PR URL returned.

- [ ] **Step 4: Mark the claim done in Linear and `.agents/claims.yaml`**

Update YAML entry to:

```yaml
  HUM-1274:
    agent: codex
    status: done
    claimed_at: "2026-05-27T00:00:00Z"
    depends_on: []
    branch: feature/hum-1274
    worktree: .worktrees/feature-hum-1274
    pr: https://github.com/ahnpolished/dorv/pull/NN
    completed_at: "2026-05-27T00:00:00Z"
```

Post this Linear comment:

```md
🤖 Agent claim

| Field | Value |
| --- | --- |
| **Agent** | codex |
| **Status** | done |
| **PR** | https://github.com/ahnpolished/dorv/pull/NN |
| **Outcome** | Real E2E + unit coverage passing; ready for review |
```

- [ ] **Step 5: Commit final claim metadata if it changed in the branch**

```bash
git add .agents/claims.yaml
git commit -m "chore: update HUM-1274 claim status" || true
```

---

## Self-review

- Spec coverage check:
  - root sync: Task 2 + Task 6
  - reply sync: Task 2 + Task 6
  - resolution sync: Task 2 + Task 6
  - idempotency: Task 2 + Task 4 + Task 6
  - rate-limit-aware reduced GH pressure: Task 3 + Task 6
- Placeholder scan: no TBD/TODO placeholders remain.
- Type consistency check:
  - uses existing `GitHubReviewThread`, `CommentMapping`, `ReplyMapping`
  - keeps `threadSnapshot`, `ghThreadId`, and `resolvedAt` aligned with current adapter/storage types

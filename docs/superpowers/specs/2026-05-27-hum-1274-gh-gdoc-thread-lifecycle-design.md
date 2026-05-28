# Design Spec: GH -> GDoc Thread Lifecycle Reliability (HUM-1274)

**Status:** Draft
**Date:** 2026-05-27
**Issue:** [HUM-1274](https://linear.app/humphreyahn/issue/HUM-1274/gh-comments-are-not-showing-as-comments-on-gdocs)

## 1. Goal
Make GitHub PR review threads sync reliably into Google Docs as real comment threads, with durable behavior for:

- top-level GitHub review comments,
- nested GitHub replies,
- correct Google Doc anchor/selection targeting,
- resolved thread propagation,
- idempotent repeated syncs,
- lower GitHub API pressure during sync passes.

This issue prioritizes **GH -> GDoc correctness**. Existing Activities UI is out of scope except where sync state already records activity metadata.

## 2. Problem Summary
The current sync behavior appears to treat root comments, replies, anchors, and resolution as partially separate steps. That creates several likely failure modes:

- root comments render in dorv surfaces but do not become real Google Doc comments,
- replies do not attach to the correct Google Doc thread,
- anchors are computed inconsistently from the markdown/doc text seam,
- resolved GitHub threads do not consistently resolve the mapped Google Doc comment,
- repeated syncs can waste GitHub API calls or re-check the same state too aggressively.

The fix should not be a narrow patch for one symptom. It should create a unified thread lifecycle model that keeps all GH -> GDoc thread mutations consistent.

## 3. Architecture

### 3.1 Canonical Unit: GitHub Thread Lifecycle
Treat a GitHub review thread, not an individual comment event, as the canonical sync unit.

For each thread, the sync pipeline will normalize:

- root comment,
- replies in thread order,
- file/path/line metadata,
- head SHA / commit context where available,
- resolved state,
- stable identifiers used by mapping storage.

This creates one source of truth for all GH -> GDoc mutations.

### 3.2 Sync Pipeline
Within a single sync pass for one PR:

1. Fetch GitHub review comments/threads using the minimum request set needed for the PR.
2. Normalize raw GitHub payloads into a canonical thread model.
3. Resolve the target anchor in the generated Google Doc text for each root thread.
4. Load existing root/reply mappings for the PR and group them by thread.
5. Reconcile desired thread state against mapped Google Doc state.
6. Apply only required Google Doc mutations:
   - create missing root comment,
   - add missing replies,
   - resolve mapped root comment when the GitHub thread is resolved,
   - skip already-synced entities.
7. Persist updated mappings and activity/status metadata.

### 3.3 Canonical Thread Model
Introduce or derive a normalized in-memory shape similar to:

```ts
interface NormalizedGhThread {
  threadKey: string;
  root: GitHubReviewComment;
  replies: GitHubReviewComment[];
  path: string;
  line: number | null;
  side: string | null;
  commitId: string | null;
  htmlUrl: string;
  isResolved: boolean;
}
```

Notes:
- `threadKey` should be stable enough to group all comments belonging to the same GitHub thread in one sync pass.
- If GitHub payloads do not provide an explicit thread id on the existing seam, derive the grouping deterministically from root comment identity plus reply linkage.
- The normalized model is internal only; it does not change user-facing storage contracts unless needed for correctness.

### 3.4 Mapping / Lifecycle Model
Current storage already distinguishes root and reply mappings. HUM-1274 may extend the internal lifecycle rules without forcing a broad storage rewrite.

Required invariants:

1. One GitHub root thread maps to at most one Google Doc root comment.
2. A reply may only sync after its parent root mapping exists.
3. A resolved GitHub thread may only resolve the mapped Google Doc root comment for that same thread.
4. Repeated sync must be idempotent for root creation, reply creation, and resolution.
5. Loop guards continue to honor `source` metadata already used by dorv.

If needed, add a lightweight thread-oriented lookup helper that groups existing `CommentMapping` and `ReplyMapping` records by root comment id during reconciliation.

### 3.5 Anchor Resolution
Anchor resolution should be handled once per normalized root thread, not re-derived independently for replies.

Design rules:
- Root comment creation computes the anchor from PR markdown / rendered-doc text.
- Replies inherit the root thread’s Google Doc comment id and do not recompute anchor selection.
- Matching should prefer existing normalized line/quote matching utilities rather than introducing a second anchoring algorithm.
- If no safe anchor can be resolved, fail the thread cleanly and record status rather than creating an unanchored or misleading comment.

### 3.6 Rate-Limit-Aware Fetching
GitHub API pressure must be reduced as part of the design.

Rules:
- One sync pass should fetch PR comment data once and reuse it throughout reconciliation.
- Avoid per-comment or per-reply fetch patterns.
- Avoid redundant re-fetching of mappings/status inside the same PR loop.
- If the current implementation performs N+1 requests for thread context, replace it with one list fetch plus local grouping.
- On GitHub rate-limit or abuse responses, record the failure, stop mutating for that PR, and let the next poll/manual sync retry from persisted state.

This keeps the system safe under larger PRs with many comments.

## 4. Components to Change
Likely touchpoints:

- `apps/extension/lib/github/*` — comment fetch normalization and thread grouping
- `apps/extension/lib/gdoc/comments.ts` — root/reply/resolve mutation seam reuse
- `apps/extension/lib/storage/stores.ts` and related mapping helpers — grouped mapping lookup and idempotent persistence
- Direct adapter sync orchestration (`DirectAdapter.syncAll()` or equivalent path)
- Real E2E tests under `tests/e2e/real/`
- Focused integration/unit tests for normalization, mapping, anchoring, and idempotency

The exact filenames can follow the existing implementation seam; no second sync architecture should be introduced.

## 5. Error Handling
Per PR sync pass:

- A failure in one thread must not abort other PRs.
- A failure in one thread should not create partial duplicate mappings.
- Resolution should only happen after confirming the target root mapping exists.
- Missing anchor, missing mapping, or rate-limit conditions should be surfaced through existing sync status/activity mechanisms.
- Retry behavior remains poll/manual-sync driven; no aggressive immediate retry loop.

## 6. Testing Plan
HUM-1274 is gated by real E2E and should be implemented test-first.

### 6.1 Real E2E (primary gate)
Expand or add real-credential tests that fail first for:

1. **Top-level root sync**
   - Create a real GH review comment.
   - Trigger sync.
   - Assert a real Google Drive comment exists on the linked doc.

2. **Reply thread sync**
   - Add a reply to the GH thread.
   - Trigger sync.
   - Assert it appears as a reply on the same GDoc thread.

3. **Anchor correctness**
   - Assert the synced GDoc comment targets the expected quoted/selected markdown content as closely as the Drive API seam exposes.

4. **Resolution sync**
   - Resolve the GH thread.
   - Trigger sync.
   - Assert the mapped GDoc root comment becomes resolved.

5. **Idempotency**
   - Run sync twice.
   - Assert exactly one root thread and one copy of each reply exists in GDoc.

6. **Higher-volume / rate-pressure stability**
   - Reuse existing larger PR fixtures/targets.
   - Assert sync still completes without obvious duplicate mutations or request explosions.

### 6.2 Focused Integration / Unit Tests
Add smaller tests for:

- grouping GitHub comments into canonical threads,
- mapping reconciliation behavior,
- reply sync ordering constraints,
- anchor resolution selection rules,
- resolved-thread propagation,
- request consolidation / no N+1 regressions where testable.

### 6.3 TDD Rule
Implementation follows strict red-green-refactor:
- write/expand the failing test,
- verify it fails for the intended reason,
- implement the minimum change,
- rerun until all targeted cases pass.

## 7. Scope Boundaries
In scope:
- GH -> GDoc thread lifecycle reliability,
- internal mapping/lifecycle improvements required for correctness,
- rate-limit-aware GitHub fetch/reconcile behavior,
- tests needed to prove the behavior.

Out of scope unless a failing test proves they are required:
- Activities UI redesign,
- broad GDoc -> GH feature changes,
- backend/webhook architecture,
- automatic document body rewrites on new commits.

## 8. Recommended Delivery Sequence
1. Reproduce failures with real E2E where coverage is missing.
2. Add focused smaller tests for thread normalization/reconciliation.
3. Introduce normalized thread lifecycle pipeline in the existing sync path.
4. Consolidate GitHub fetch usage to reduce API pressure.
5. Verify idempotency and resolution behavior.
6. Run full relevant test suites before PR.

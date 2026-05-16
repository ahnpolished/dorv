# GH -> GDoc Comment Sync (HUM-1197) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement periodic polling and pushing of new top-level GitHub PR comments to linked Google Docs.

**Architecture:** Extend `DirectAdapter.syncAll` to orchestrate the polling loop using `MappingStore` for loop guards.

**Tech Stack:** TypeScript, GitHub REST API, Google Drive Comments API.

---

### Task 1: GitHub Review Comment Fetcher

**Files:**
- Create: `apps/extension/lib/github/fetch.ts`

- [ ] **Step 1: Implement fetchReviewComments**

```typescript
import type { GitHubReviewComment } from "../adapters/types.js";

export async function fetchReviewComments(
  token: string,
  repo: string,
  prNumber: number
): Promise<GitHubReviewComment[]> {
  const [owner, name] = repo.split("/");
  const url = `https://api.github.com/repos/${owner}/${name}/pulls/${prNumber}/comments`;

  const resp = await fetch(url, {
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json"
    }
  });

  if (!resp.ok) {
    throw new Error(`GitHub fetch failed: ${resp.status} ${await resp.text()}`);
  }

  const data = await resp.json() as any[];
  return data.map(c => ({
    id: c.id,
    body: c.body,
    path: c.path,
    line: c.line,
    side: c.side,
    inReplyToId: c.in_reply_to_id,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    user: c.user.login,
    htmlUrl: c.html_url
  }));
}
```

- [ ] **Step 2: Update GitHubReviewComment type**
  - Add `user: string` and `htmlUrl: string` to `lib/adapters/types.ts`.

- [ ] **Step 3: Commit**

---

### Task 2: Google Docs Comment Puser

**Files:**
- Create: `apps/extension/lib/gdoc/comments.ts`

- [ ] **Step 1: Implement pushGDocComment**

```typescript
export async function pushGDocComment(
  token: string,
  docId: string,
  content: string
): Promise<{ id: string }> {
  const url = `https://www.googleapis.com/drive/v3/files/${docId}/comments?fields=id`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ content })
  });

  if (!resp.ok) {
    throw new Error(`Drive comment push failed: ${resp.status} ${await resp.text()}`);
  }

  return resp.json();
}
```

- [ ] **Step 2: Commit**

---

### Task 3: DirectAdapter - pushGHCommentToDoc

**Files:**
- Modify: `apps/extension/lib/adapters/direct.ts`
- Modify: `tests/direct-adapter-sync.test.ts`

- [ ] **Step 1: Write test for comment formatting**
- [ ] **Step 2: Implement pushGHCommentToDoc**
    - Format body: `**@user** on path:line -- body -- [View](url)`.
    - Call `pushGDocComment`.
    - Save to `MappingStore`.
- [ ] **Step 3: Commit**

---

### Task 4: DirectAdapter - syncAll Polling Logic

**Files:**
- Modify: `apps/extension/lib/adapters/direct.ts`

- [ ] **Step 1: Implement full syncAll loop**
    - Iterate active PRs.
    - Fetch GH comments.
    - Filter `!c.inReplyToId` and `!mappingStore.hasByGH(c.id)`.
    - Push each to GDoc.
    - Update timestamps and status.
- [ ] **Step 2: Commit**

---

### Task 5: Final Validation

- [ ] **Step 1: Run lint and typecheck**
- [ ] **Step 2: Run full test suite**
- [ ] **Step 3: Commit and Push**


# GDoc -> GH Comment Push (HUM-1198) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the flow to push comments from a Google Doc back to the GitHub PR, including automated line matching.

**Architecture:** Extend `DirectAdapter` with line-matching logic and Drive API fetchers. Build a React interface in `DocSidebar` to trigger the push.

**Tech Stack:** TypeScript, React, Google Drive API, GitHub REST API.

---

### Task 1: Line Matching Engine

**Files:**
- Create: `apps/extension/lib/gdoc/matching.ts`
- Create: `tests/line-matching.test.ts`

- [ ] **Step 1: Write failing tests for line matching**

```typescript
import { describe, expect, it } from "vitest";
import { findLineMatch } from "../apps/extension/lib/gdoc/matching.js";

describe("findLineMatch", () => {
  const files = [
    { filename: "a.ts", content: "line 1\nline 2\nmatch me\nline 4" }
  ];

  it("finds exact string match", () => {
    const result = findLineMatch("match me", files);
    expect(result).toEqual([{ path: "a.ts", line: 3 }]);
  });

  it("returns empty for no match", () => {
    const result = findLineMatch("missing", files);
    expect(result).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Implement findLineMatch**

```typescript
export interface LineMatch {
  path: string;
  line: number;
}

export function findLineMatch(
  quotedText: string,
  files: { filename: string; content: string }[]
): LineMatch[] {
  const matches: LineMatch[] = [];
  const cleanQuote = quotedText.trim();
  if (!cleanQuote) return [];

  for (const file of files) {
    const lines = file.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(cleanQuote)) {
        matches.push({ path: file.filename, line: i + 1 });
      }
    }
  }
  return matches;
}
```

- [ ] **Step 3: Commit**

---

### Task 2: Google Doc Comment Fetcher

**Files:**
- Create: `apps/extension/lib/gdoc/fetch.ts`

- [ ] **Step 1: Implement fetchGDocComments**

```typescript
import type { GoogleDocComment } from "../adapters/types.js";

export async function fetchGDocComments(
  token: string,
  docId: string
): Promise<GoogleDocComment[]> {
  const url = `https://www.googleapis.com/drive/v3/files/${docId}/comments?fields=comments(id,content,quotedFileContent,author,createdTime)`;

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!resp.ok) {
    throw new Error(`Drive fetch failed: ${resp.status}`);
  }

  const data = await resp.json();
  return (data.comments || []).map((c: any) => ({
    id: c.id,
    content: c.content,
    quotedFileContent: c.quotedFileContent?.value,
    author: c.author?.displayName || "Unknown",
    createdAt: c.createdTime,
    updatedAt: c.createdTime
  }));
}
```

- [ ] **Step 2: Update types**
  - Ensure `GoogleDocComment` has `author: string`.

- [ ] **Step 3: Commit**

---

### Task 3: GitHub Review Comment Puser

**Files:**
- Modify: `apps/extension/lib/github/comments.ts`

- [ ] **Step 1: Implement createReviewComment**

```typescript
export async function createReviewComment(
  token: string,
  repo: string,
  prNumber: number,
  payload: {
    body: string;
    commit_id: string;
    path: string;
    line: number;
    side: "RIGHT";
  }
): Promise<{ id: number }> {
  const [owner, name] = repo.split("/");
  const url = `https://api.github.com/repos/${owner}/${name}/pulls/${prNumber}/comments`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!resp.ok) {
    throw new Error(`GitHub comment failed: ${resp.status} ${await resp.text()}`);
  }

  return resp.json();
}
```

- [ ] **Step 2: Commit**

---

### Task 4: DirectAdapter Implementation

**Files:**
- Modify: `apps/extension/lib/adapters/direct.ts`

- [ ] **Step 1: Implement getDocComments**
- [ ] **Step 2: Implement pushDocCommentToGH**
    - Format body with GDoc author.
    - Save to `MappingStore`.
- [ ] **Step 3: Commit**

---

### Task 5: Side Panel UI (GDoc Comments)

**Files:**
- Modify: `apps/extension/src/sidepanel.tsx`

- [ ] **Step 1: Display GDoc comments in separate section/tab**
- [ ] **Step 2: Add "Push to GitHub" button with line preview**
- [ ] **Step 3: Commit**

---

### Task 6: Final Validation

- [ ] **Step 1: Run lint and typecheck**
- [ ] **Step 2: Run all tests**
- [ ] **Step 3: Commit and Push**


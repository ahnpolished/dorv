# DocSidebar (HUM-1201) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the side panel for Google Docs that shows GitHub PR information and synchronized comments.

**Architecture:** Extend `DocStore` and `DirectAdapter` to provide the data, and build a React-based UI in `sidepanel.tsx`.

**Tech Stack:** TypeScript, React, chrome.sidePanel API, GitHub REST API.

---

### Task 1: Store & Adapter Enhancements

**Files:**
- Modify: `apps/extension/lib/storage/stores.ts`
- Modify: `apps/extension/lib/adapters/direct.ts`

- [ ] **Step 1: Add getByDocId to DocStore**

```typescript
// apps/extension/lib/storage/stores.ts
export function createDocStore(storage: StorageArea) {
  return {
    // ...
    async getByDocId(docId: string): Promise<DocMapping | undefined> {
      const active = await this.listActive();
      for (const ref of active) {
        const mapping = await this.get(ref.repo, ref.prNumber);
        if (mapping?.docId === docId) return mapping;
      }
      return undefined;
    }
  };
}
```

- [ ] **Step 2: Implement data methods in DirectAdapter**
    - `getGHComments(ref)`: Use `fetchReviewComments`.
    - `getCommentMappings(ref)`: Use a new `listByPR` in `MappingStore` or iterate.

- [ ] **Step 3: Commit**

---

### Task 2: Utility Helpers

**Files:**
- Create: `apps/extension/lib/gdoc/urls.ts`
- Create: `apps/extension/lib/gdoc/grouping.ts`

- [ ] **Step 1: Implement parseDocId**
    - Extract from `*://docs.google.com/document/d/{docId}/...`

- [ ] **Step 2: Implement groupCommentsByPath**
    - Groups `GitHubReviewComment[]` into a record or array of objects.

- [ ] **Step 3: Commit**

---

### Task 3: Side Panel UI (PR Info Tab)

**Files:**
- Modify: `apps/extension/src/sidepanel.tsx`
- Modify: `apps/extension/src/sidepanel.css`

- [ ] **Step 1: Implement tab switching logic**
- [ ] **Step 2: Implement PR Info display**
    - Show repo, PR #, branch, sync status.
- [ ] **Step 3: Commit**

---

### Task 4: Side Panel UI (Comments Tab)

**Files:**
- Modify: `apps/extension/src/sidepanel.tsx`

- [ ] **Step 1: Implement grouped comment list**
- [ ] **Step 2: Implement collapsible sections per file**
- [ ] **Step 3: Commit**

---

### Task 5: Final Validation

- [ ] **Step 1: Run lint and typecheck**
- [ ] **Step 2: Verify build**
- [ ] **Step 3: Commit and Push**


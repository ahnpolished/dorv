# GH -> GDoc Creation (HUM-1196) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the core flow to create a Google Doc from PR markdown files and post the link as a bot comment.

**Architecture:** Extend `DirectAdapter` to handle content fetching, HTML transformation via `marked`, and multipart upload to Google Drive.

**Tech Stack:** TypeScript, `marked`, Google Drive API (Multipart), GitHub REST API.

---

### Task 1: Add Dependencies

**Files:**
- Modify: `apps/extension/package.json`

- [ ] **Step 1: Install marked and @types/marked**

Run: `pnpm --filter @dorv/extension add marked && pnpm --filter @dorv/extension add -D @types/marked`

- [ ] **Step 2: Verify installation**

Run: `grep "marked" apps/extension/package.json`
Expected: `marked` listed in dependencies.

- [ ] **Step 3: Commit**

```bash
git add apps/extension/package.json pnpm-lock.yaml
git commit -m "chore(deps): add marked for markdown parsing"
```

---

### Task 2: HTML Template Generation

**Files:**
- Create: `apps/extension/lib/gdoc/template.ts`
- Create: `tests/gdoc-template.test.ts`

- [ ] **Step 1: Write failing test for HTML template**

```typescript
import { describe, expect, it } from "vitest";
import { generateGDocHtml } from "../apps/extension/lib/gdoc/template.js";

describe("generateGDocHtml", () => {
  it("renders PR metadata and markdown content", () => {
    const input = {
      title: "Test PR",
      author: "alice",
      prUrl: "https://github.com/org/repo/pull/1",
      files: [{ filename: "README.md", html: "<p>Hello</p>" }]
    };
    const html = generateGDocHtml(input);
    expect(html).toContain("Test PR");
    expect(html).toContain("alice");
    expect(html).toContain("README.md");
    expect(html).toContain("<p>Hello</p>");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement template logic**

```typescript
export interface TemplateInput {
  title: string;
  author: string;
  prUrl: string;
  files: { filename: string; html: string }[];
}

export function generateGDocHtml(input: TemplateInput): string {
  const fileSections = input.files
    .map(f => `<h1>${f.filename}</h1>\n${f.html}`)
    .join("\n<hr/>\n");

  return `
    <html>
      <head><meta charset="UTF-8"></head>
      <body>
        <table>
          <tr><td><b>Title</b></td><td>${input.title}</td></tr>
          <tr><td><b>Author</b></td><td>${input.author}</td></tr>
          <tr><td><b>PR</b></td><td><a href="${input.prUrl}">${input.prUrl}</a></td></tr>
        </table>
        <hr/>
        ${fileSections}
      </body>
    </html>
  `;
}
```

- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

```bash
git add apps/extension/lib/gdoc/template.ts tests/gdoc-template.test.ts
git commit -m "feat(gdoc): implement HTML template generation"
```

---

### Task 3: Multipart Upload Helper

**Files:**
- Create: `apps/extension/lib/gdoc/drive.ts`

- [ ] **Step 1: Implement multipart upload logic**

```typescript
export async function createGoogleDoc(
  token: string, 
  name: string, 
  html: string
): Promise<{ id: string; webViewLink: string }> {
  const boundary = "-------dorv_boundary";
  const metadata = {
    name,
    mimeType: "application/vnd.google-apps.document"
  };

  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: text/html",
    "",
    html,
    `--${boundary}--`
  ].join("\r\n");

  const resp = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`
    },
    body
  });

  if (!resp.ok) {
    throw new Error(`Drive API failed: ${resp.status} ${await resp.text()}`);
  }

  return resp.json();
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/extension/lib/gdoc/drive.ts
git commit -m "feat(gdoc): implement Drive multipart upload"
```

---

### Task 4: GitHub Bot Comment Helper

**Files:**
- Create: `apps/extension/lib/github/comments.ts`

- [ ] **Step 1: Implement bot comment logic**

```typescript
export async function postPRComment(
  token: string,
  repo: string,
  prNumber: number,
  body: string
): Promise<void> {
  const [owner, name] = repo.split("/");
  const url = `https://api.github.com/repos/${owner}/${name}/issues/${prNumber}/comments`;
  
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ body })
  });

  if (!resp.ok) {
    throw new Error(`GitHub API failed: ${resp.status} ${await resp.text()}`);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/extension/lib/github/comments.ts
git commit -m "feat(github): implement PR bot comment helper"
```

---

### Task 5: Implement DirectAdapter.createDoc

**Files:**
- Modify: `apps/extension/lib/adapters/direct.ts`

- [ ] **Step 1: Implement createDoc flow**
  - Get GH token and Google token from `AuthStore` (inject or import).
  - Fetch raw content for each file using GH token.
  - Parse MD to HTML via `marked`.
  - Generate full HTML via `generateGDocHtml`.
  - Create Doc via `createGoogleDoc`.
  - Post comment via `postPRComment`.
  - Return `DocMapping`.

- [ ] **Step 2: Verify build and lint**
- [ ] **Step 3: Commit**

```bash
git add apps/extension/lib/adapters/direct.ts
git commit -m "feat(adapter): implement createDoc in DirectAdapter"
```


/* eslint-disable */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { DirectAdapter } from "../apps/extension/lib/adapters/direct.js";
import { createMemoryStorageArea } from "../apps/extension/lib/storage/memory.js";
import { createAuthStore, type AuthStore } from "../apps/extension/lib/storage/auth.js";
import {
  createDocStore,
  createActivityStore,
  createIdentityStore,
  createMappingStore
} from "../apps/extension/lib/storage/stores.js";
import type { DocMapping } from "../apps/extension/lib/adapters/types.js";
import type { StorageArea } from "../apps/extension/lib/storage/area.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("DirectAdapter baseline sync", () => {
  let storage: StorageArea;
  let adapter: DirectAdapter;
  let authStore: AuthStore;
  let docStore: any;
  let mappingStore: any;
  let activityStore: any;

  beforeEach(() => {
    storage = createMemoryStorageArea();
    authStore = createAuthStore(storage);
    docStore = createDocStore(storage);
    mappingStore = createMappingStore(storage);
    activityStore = createActivityStore(storage);
    adapter = new DirectAdapter(authStore, storage);

    mockFetch.mockReset();

    (global as any).chrome = {
      runtime: { lastError: null },
      identity: {
        getAuthToken: vi.fn((_opts: any, cb: any) => cb(undefined)),
        removeCachedAuthToken: vi.fn()
      }
    };
  });

  it("syncAll updates lastSyncedAt", async () => {
    await authStore.setGitHubToken("mock-gh-token");
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([])
    });

    const ref = { repo: "org/repo", prNumber: 123 };
    const mapping: DocMapping = {
      ...ref,
      docs: [{ filename: "f.ts", docId: "doc-1", docUrl: "url-1" }],
      createdAt: "2026-05-16T12:00:00Z",
      lastSyncedAt: "2026-05-16T12:00:00Z",
      headSha: "sha1",
      latestSha: "sha1",
      isStale: false
    };
    await docStore.upsert(mapping);

    await adapter.syncAll();

    const updatedMapping = await docStore.get(ref.repo, ref.prNumber);
    expect(updatedMapping?.lastSyncedAt).not.toBe("2026-05-16T12:00:00Z");
  });

  it("pushes new comments to GDoc", async () => {
    await authStore.setGitHubToken("mock-gh-token");
    (chrome.identity.getAuthToken as any).mockImplementation((opts: any, cb: any) =>
      cb("mock-g-token")
    );

    const ref = { repo: "org/repo", prNumber: 123 };
    const mapping: DocMapping = {
      ...ref,
      docs: [{ filename: "f.ts", docId: "doc-1", docUrl: "url-1" }],
      createdAt: "2026-05-16T12:00:00Z",
      lastSyncedAt: "2026-05-16T12:00:00Z",
      headSha: "sha1",
      latestSha: "sha1",
      isStale: false
    };
    await docStore.upsert(mapping);

    mockFetch.mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("github.com")) {
        return {
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 1,
                body: "new comment",
                path: "f.ts",
                line: 10,
                in_reply_to_id: null,
                user: { login: "u" },
                html_url: "h",
                created_at: "t",
                updated_at: "t"
              }
            ])
        };
      } else if (urlStr.includes("googleapis.com")) {
        return {
          ok: true,
          json: () => Promise.resolve({ id: "g-comm-1" })
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    await adapter.syncAll();

    const m = await mappingStore.getByGH(1);
    expect(m).toBeDefined();
    expect(m.docCommentId).toBe("g-comm-1");
    await expect(activityStore.listByPR("org/repo", 123)).resolves.toMatchObject([
      {
        direction: "github_to_gdoc",
        kind: "comment_synced",
        ghCommentId: 1,
        docCommentId: "g-comm-1",
        path: "f.ts",
        line: 10,
        snippet: "new comment"
      }
    ]);
  });

  it("pushes GH comments to GDoc with exact body and line context", async () => {
    await authStore.setGitHubToken("mock-gh-token");
    (chrome.identity.getAuthToken as any).mockImplementation((opts: any, cb: any) =>
      cb("mock-g-token")
    );

    const ref = { repo: "org/repo", prNumber: 123 };
    await docStore.upsert({
      ...ref,
      docs: [{ filename: "docs/rfc.md", docId: "doc-1", docUrl: "url-1" }],
      createdAt: "2026-05-16T12:00:00Z",
      lastSyncedAt: "2026-05-16T12:00:00Z",
      headSha: "sha1",
      latestSha: "sha1",
      isStale: false
    });

    let driveBody: any;
    mockFetch.mockImplementation(async (url: any, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes("github.com")) {
        return {
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 1,
                body: "Please tighten this paragraph.",
                path: "docs/rfc.md",
                line: 42,
                side: "RIGHT",
                diff_hunk: "@@ -40,3 +40,3 @@\n context\n unchanged\n+target paragraph",
                in_reply_to_id: null,
                user: { login: "alice" },
                html_url: "https://github.com/org/repo/pull/123#discussion_r1",
                created_at: "t",
                updated_at: "t"
              }
            ])
        };
      }
      if (
        urlStr.includes("googleapis.com/drive/v3/files/doc-1/comments") &&
        init?.method === "POST"
      ) {
        driveBody = JSON.parse(String(init?.body));
        return { ok: true, json: () => Promise.resolve({ id: "g-comm-1" }) };
      }
      if (urlStr.includes("googleapis.com/drive/v3/files/doc-1/comments")) {
        return { ok: true, json: () => Promise.resolve({ comments: [] }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    await adapter.syncAll();

    expect(driveBody).toEqual({
      content:
        "[GitHub: @alice]\n\nPlease tighten this paragraph.\n\n[View on GitHub](https://github.com/org/repo/pull/123#discussion_r1)",
      quotedFileContent: {
        mimeType: "text/plain",
        value: "target paragraph"
      }
    });
  });

  it("skips LEFT-side GitHub review threads without creating GDoc comments", async () => {
    await authStore.setGitHubToken("mock-gh-token");
    (chrome.identity.getAuthToken as any).mockImplementation((opts: any, cb: any) =>
      cb("mock-g-token")
    );

    const ref = { repo: "org/repo", prNumber: 123 };
    await docStore.upsert({
      ...ref,
      docs: [{ filename: "docs/rfc.md", docId: "doc-1", docUrl: "url-1" }],
      createdAt: "2026-05-16T12:00:00Z",
      lastSyncedAt: "2026-05-16T12:00:00Z",
      headSha: "sha1",
      latestSha: "sha1",
      isStale: false
    });

    const driveCommentPosts: unknown[] = [];
    mockFetch.mockImplementation(async (url: any, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes("/graphql")) {
        return {
          ok: true,
          json: async () => ({
            data: {
              repository: {
                pullRequest: {
                  reviewThreads: {
                    nodes: [
                      {
                        id: "thread-left",
                        isResolved: false,
                        path: "docs/rfc.md",
                        line: 9,
                        diffSide: "LEFT",
                        comments: {
                          nodes: [
                            {
                              databaseId: 9,
                              body: "deleted line comment",
                              path: "docs/rfc.md",
                              line: 9,
                              diffHunk: "@@ -9,1 +0,0 @@\n-deleted line",
                              createdAt: "t",
                              updatedAt: "t",
                              url: "https://github.com/org/repo/pull/123#discussion_r9",
                              author: { login: "alice" },
                              replyTo: null
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

      if (urlStr.includes("googleapis.com/drive/v3/files/doc-1/comments")) {
        if (init?.method === "POST") {
          driveCommentPosts.push(JSON.parse(String(init.body)));
        }
        return { ok: true, json: () => Promise.resolve({ comments: [] }) };
      }

      return { ok: true, json: async () => ({}) };
    });

    await adapter.syncAll();

    expect(driveCommentPosts).toHaveLength(0);
    expect(await mappingStore.getByGH(9)).toBeUndefined();
  });

  it("syncs 100 GH comments to distinct GDoc comments", async () => {
    await authStore.setGitHubToken("mock-gh-token");
    (chrome.identity.getAuthToken as any).mockImplementation((opts: any, cb: any) =>
      cb("mock-g-token")
    );

    const ref = { repo: "org/repo", prNumber: 123 };
    await docStore.upsert({
      ...ref,
      docs: [{ filename: "docs/rfc.md", docId: "doc-1", docUrl: "url-1" }],
      createdAt: "2026-05-16T12:00:00Z",
      lastSyncedAt: "2026-05-16T12:00:00Z",
      headSha: "sha1",
      latestSha: "sha1",
      isStale: false
    });

    let nextDocId = 1;
    mockFetch.mockImplementation(async (url: any, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes("github.com")) {
        return {
          ok: true,
          json: () =>
            Promise.resolve(
              Array.from({ length: 100 }, (_, index) => ({
                id: index + 1,
                body: `comment ${index + 1}`,
                path: "docs/rfc.md",
                line: index + 1,
                side: "RIGHT",
                diff_hunk: `@@ -${index + 1},1 +${index + 1},1 @@\n+line ${index + 1}`,
                in_reply_to_id: null,
                user: { login: "alice" },
                html_url: `https://github.com/org/repo/pull/123#discussion_r${index + 1}`,
                created_at: "t",
                updated_at: "t"
              }))
            )
        };
      }
      if (
        urlStr.includes("googleapis.com/drive/v3/files/doc-1/comments") &&
        init?.method === "POST"
      ) {
        return { ok: true, json: () => Promise.resolve({ id: `g-comm-${nextDocId++}` }) };
      }
      if (urlStr.includes("googleapis.com/drive/v3/files/doc-1/comments")) {
        return { ok: true, json: () => Promise.resolve({ comments: [] }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    await adapter.syncAll();

    const mappings = await mappingStore.listByPR(ref.repo, ref.prNumber);
    expect(mappings).toHaveLength(100);
    expect(await mappingStore.getByGH(100)).toMatchObject({ docCommentId: "g-comm-100" });
  });

  it("creates review docs with anyone-with-link commenter access", async () => {
    await authStore.setGitHubToken("mock-gh-token");
    (chrome.identity.getAuthToken as any).mockImplementation((opts: any, cb: any) =>
      cb("mock-g-token")
    );

    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    mockFetch.mockImplementation(async (url: any, init?: RequestInit) => {
      const urlStr = String(url);
      calls.push({ url: urlStr, init });

      if (urlStr === "https://raw.example/README.md") {
        return { ok: true, text: () => Promise.resolve("# RFC") };
      }

      if (urlStr.includes("/upload/drive/v3/files")) {
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              id: "doc-1",
              webViewLink: "https://docs.google.com/document/d/doc-1/edit"
            })
        };
      }

      if (urlStr.includes("/drive/v3/files/doc-1/permissions")) {
        return { ok: true, json: () => Promise.resolve({ id: "perm-1" }) };
      }

      if (urlStr.includes("/api.github.com/repos/org/repo/issues/123/comments")) {
        return { ok: true, json: () => Promise.resolve({ id: 100 }) };
      }

      return { ok: true, json: async () => ({}) };
    });

    await adapter.createDoc({
      repo: "org/repo",
      prNumber: 123,
      title: "Review me",
      author: "alice",
      branch: "feature/docs",
      headSha: "sha1",
      prUrl: "https://github.com/org/repo/pull/123",
      files: [
        { filename: "README.md", rawUrl: "https://raw.example/README.md", status: "modified" }
      ]
    });

    const permissionCall = calls.find((call) =>
      call.url.includes("/drive/v3/files/doc-1/permissions")
    );

    expect(permissionCall).toBeDefined();
    expect(permissionCall?.init?.method).toBe("POST");
    expect(permissionCall?.init?.headers).toEqual({
      Authorization: "Bearer mock-g-token",
      "Content-Type": "application/json"
    });
    expect(JSON.parse(String(permissionCall?.init?.body))).toEqual({
      type: "anyone",
      role: "commenter",
      allowFileDiscovery: false
    });
  });

  it("HUM-1412: merges docs across separate createDoc calls instead of dropping earlier files", async () => {
    await authStore.setGitHubToken("mock-gh-token");
    (chrome.identity.getAuthToken as any).mockImplementation((opts: any, cb: any) =>
      cb("mock-g-token")
    );

    let botCommentId = 0;
    const postedComments: Array<{ method: string; body: string }> = [];

    mockFetch.mockImplementation(async (url: any, init?: RequestInit) => {
      const urlStr = String(url);
      const method = init?.method ?? "GET";

      if (urlStr === "https://raw.example/README.md") {
        return { ok: true, text: () => Promise.resolve("# README") };
      }
      if (urlStr === "https://raw.example/AGENTS.md") {
        return { ok: true, text: () => Promise.resolve("# AGENTS") };
      }

      if (urlStr.includes("/upload/drive/v3/files")) {
        const body = String(init?.body ?? "");
        const isReadme = body.includes("README.md");
        return {
          ok: true,
          json: () =>
            Promise.resolve(
              isReadme
                ? {
                    id: "doc-readme",
                    webViewLink: "https://docs.google.com/document/d/doc-readme/edit"
                  }
                : {
                    id: "doc-agents",
                    webViewLink: "https://docs.google.com/document/d/doc-agents/edit"
                  }
            )
        };
      }

      if (urlStr.includes("/drive/v3/files/") && urlStr.includes("/permissions")) {
        return { ok: true, json: () => Promise.resolve({ id: "perm-1" }) };
      }

      if (
        urlStr.includes("/api.github.com/repos/org/repo/issues/123/comments") ||
        urlStr.includes("/api.github.com/repos/org/repo/issues/comments/")
      ) {
        if (method === "GET") {
          if (botCommentId === 0) return { ok: true, json: () => Promise.resolve([]) };
          return {
            ok: true,
            json: () =>
              Promise.resolve([
                {
                  id: botCommentId,
                  body: postedComments[0]?.body ?? ""
                }
              ])
          };
        }
        if (method === "POST") {
          botCommentId = 100;
          postedComments.push({ method: "POST", body: JSON.parse(String(init?.body)).body });
          return { ok: true, json: () => Promise.resolve({ id: botCommentId }) };
        }
        if (method === "PATCH") {
          postedComments.push({ method: "PATCH", body: JSON.parse(String(init?.body)).body });
          return { ok: true, json: () => Promise.resolve({ id: botCommentId }) };
        }
      }

      return { ok: true, json: async () => ({}) };
    });

    const baseInput = {
      repo: "org/repo",
      prNumber: 123,
      title: "Review me",
      author: "alice",
      branch: "feature/docs",
      headSha: "sha1",
      prUrl: "https://github.com/org/repo/pull/123"
    };

    await adapter.createDoc({
      ...baseInput,
      files: [
        { filename: "README.md", rawUrl: "https://raw.example/README.md", status: "modified" }
      ]
    });

    await adapter.createDoc({
      ...baseInput,
      files: [
        { filename: "AGENTS.md", rawUrl: "https://raw.example/AGENTS.md", status: "modified" }
      ]
    });

    const mapping = await docStore.get("org/repo", 123);
    expect(mapping?.docs.map((d: any) => d.filename).sort()).toEqual(["AGENTS.md", "README.md"]);
    expect(mapping?.docs.find((d: any) => d.filename === "README.md")?.docId).toBe("doc-readme");
    expect(mapping?.docs.find((d: any) => d.filename === "AGENTS.md")?.docId).toBe("doc-agents");

    // Should post once and then update in-place instead of duplicating
    expect(postedComments).toHaveLength(2);
    expect(postedComments[0]?.method).toBe("POST");
    expect(postedComments[1]?.method).toBe("PATCH");
  });

  it("serializes concurrent createDoc calls for the same PR so the bot comment stays a singleton", async () => {
    // Two file buttons on the same PR clicked close together used to race:
    // both read GitHub issue comments before either had posted, so both saw
    // no existing bot comment and both POSTed, creating a duplicate.
    await authStore.setGitHubToken("mock-gh-token");
    (chrome.identity.getAuthToken as any).mockImplementation((opts: any, cb: any) =>
      cb("mock-g-token")
    );

    let botCommentId = 0;
    const postedComments: Array<{ method: string; body: string }> = [];

    mockFetch.mockImplementation(async (url: any, init?: RequestInit) => {
      const urlStr = String(url);
      const method = init?.method ?? "GET";

      if (urlStr === "https://raw.example/README.md") {
        return { ok: true, text: () => Promise.resolve("# README") };
      }
      if (urlStr === "https://raw.example/AGENTS.md") {
        return { ok: true, text: () => Promise.resolve("# AGENTS") };
      }

      if (urlStr.includes("/upload/drive/v3/files")) {
        const body = String(init?.body ?? "");
        const isReadme = body.includes("README.md");
        return {
          ok: true,
          json: () =>
            Promise.resolve(
              isReadme
                ? {
                    id: "doc-readme",
                    webViewLink: "https://docs.google.com/document/d/doc-readme/edit"
                  }
                : {
                    id: "doc-agents",
                    webViewLink: "https://docs.google.com/document/d/doc-agents/edit"
                  }
            )
        };
      }

      if (urlStr.includes("/drive/v3/files/") && urlStr.includes("/permissions")) {
        return { ok: true, json: () => Promise.resolve({ id: "perm-1" }) };
      }

      if (
        urlStr.includes("/api.github.com/repos/org/repo/issues/123/comments") ||
        urlStr.includes("/api.github.com/repos/org/repo/issues/comments/")
      ) {
        if (method === "GET") {
          if (botCommentId === 0) return { ok: true, json: () => Promise.resolve([]) };
          return {
            ok: true,
            json: () =>
              Promise.resolve([
                {
                  id: botCommentId,
                  body: postedComments[postedComments.length - 1]?.body ?? ""
                }
              ])
          };
        }
        if (method === "POST") {
          botCommentId = 100;
          postedComments.push({ method: "POST", body: JSON.parse(String(init?.body)).body });
          return { ok: true, json: () => Promise.resolve({ id: botCommentId }) };
        }
        if (method === "PATCH") {
          postedComments.push({ method: "PATCH", body: JSON.parse(String(init?.body)).body });
          return { ok: true, json: () => Promise.resolve({ id: botCommentId }) };
        }
      }

      return { ok: true, json: async () => ({}) };
    });

    const baseInput = {
      repo: "org/repo",
      prNumber: 123,
      title: "Review me",
      author: "alice",
      branch: "feature/docs",
      headSha: "sha1",
      prUrl: "https://github.com/org/repo/pull/123"
    };

    // Fire both file-button creates concurrently, no await between them.
    await Promise.all([
      adapter.createDoc({
        ...baseInput,
        files: [
          { filename: "README.md", rawUrl: "https://raw.example/README.md", status: "modified" }
        ]
      }),
      adapter.createDoc({
        ...baseInput,
        files: [
          { filename: "AGENTS.md", rawUrl: "https://raw.example/AGENTS.md", status: "modified" }
        ]
      })
    ]);

    const mapping = await docStore.get("org/repo", 123);
    expect(mapping?.docs.map((d: any) => d.filename).sort()).toEqual(["AGENTS.md", "README.md"]);

    // Exactly one POST (singleton created) followed by edits-in-place, never a second POST.
    expect(postedComments.filter((c) => c.method === "POST")).toHaveLength(1);
    expect(postedComments.filter((c) => c.method === "PATCH")).toHaveLength(1);
  });

  it("renders mermaid fenced blocks as images in the uploaded Google Doc HTML", async () => {
    await authStore.setGitHubToken("mock-gh-token");
    (chrome.identity.getAuthToken as any).mockImplementation((opts: any, cb: any) =>
      cb("mock-g-token")
    );

    let uploadBody = "";
    mockFetch.mockImplementation(async (url: any, init?: RequestInit) => {
      const urlStr = String(url);

      if (urlStr === "https://raw.example/README.md") {
        return {
          ok: true,
          text: () =>
            Promise.resolve(
              [
                "# Architecture",
                "",
                "```mermaid",
                "flowchart TD",
                "  A[GitHub] --> B[Google Docs]",
                "```"
              ].join("\n")
            )
        };
      }

      if (urlStr.includes("/upload/drive/v3/files")) {
        uploadBody = String(init?.body ?? "");
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              id: "doc-1",
              webViewLink: "https://docs.google.com/document/d/doc-1/edit"
            })
        };
      }

      if (urlStr.includes("/drive/v3/files/doc-1/permissions")) {
        return { ok: true, json: () => Promise.resolve({ id: "perm-1" }) };
      }

      if (urlStr.includes("/api.github.com/repos/org/repo/issues/123/comments")) {
        return { ok: true, json: () => Promise.resolve({ id: 100 }) };
      }

      return { ok: true, json: async () => ({}) };
    });

    await adapter.createDoc({
      repo: "org/repo",
      prNumber: 123,
      title: "Review me",
      author: "alice",
      branch: "feature/docs",
      headSha: "sha1",
      prUrl: "https://github.com/org/repo/pull/123",
      files: [
        { filename: "README.md", rawUrl: "https://raw.example/README.md", status: "modified" }
      ]
    });

    expect(uploadBody).toContain("https://mermaid.ink/img/");
    expect(uploadBody).toContain('alt="Mermaid diagram for Architecture"');
    expect(uploadBody).not.toContain("language-mermaid");
  });

  it("falls back to organization commenter access when public link sharing is blocked", async () => {
    await authStore.setGitHubToken("mock-gh-token");
    (chrome.identity.getAuthToken as any).mockImplementation((opts: any, cb: any) =>
      cb("mock-g-token")
    );

    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    mockFetch.mockImplementation(async (url: any, init?: RequestInit) => {
      const urlStr = String(url);
      calls.push({ url: urlStr, init });

      if (urlStr === "https://raw.example/README.md") {
        return { ok: true, text: () => Promise.resolve("# RFC") };
      }

      if (urlStr.includes("/upload/drive/v3/files")) {
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              id: "doc-1",
              webViewLink: "https://docs.google.com/document/d/doc-1/edit",
              owners: [{ emailAddress: "alice@example.com" }]
            })
        };
      }

      if (urlStr.includes("/drive/v3/files/doc-1/permissions")) {
        const body = JSON.parse(String(init?.body));
        if (body.type === "anyone") {
          return {
            ok: false,
            status: 400,
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  error: {
                    code: 400,
                    errors: [{ reason: "publishOutNotPermitted" }]
                  }
                })
              )
          };
        }
        return { ok: true, json: () => Promise.resolve({ id: "perm-domain" }) };
      }

      if (urlStr.includes("/api.github.com/repos/org/repo/issues/123/comments")) {
        return { ok: true, json: () => Promise.resolve({ id: 100 }) };
      }

      return { ok: true, json: async () => ({}) };
    });

    await adapter.createDoc({
      repo: "org/repo",
      prNumber: 123,
      title: "Review me",
      author: "alice",
      branch: "feature/docs",
      headSha: "sha1",
      prUrl: "https://github.com/org/repo/pull/123",
      files: [
        { filename: "README.md", rawUrl: "https://raw.example/README.md", status: "modified" }
      ]
    });

    const permissionBodies = calls
      .filter((call) => call.url.includes("/drive/v3/files/doc-1/permissions"))
      .map((call) => JSON.parse(String(call.init?.body)));

    expect(permissionBodies).toEqual([
      {
        type: "anyone",
        role: "commenter",
        allowFileDiscovery: false
      },
      {
        type: "domain",
        domain: "example.com",
        role: "commenter",
        allowFileDiscovery: false
      }
    ]);
  });

  it("pushes GDoc comments to GitHub with mapped GitHub author mention", async () => {
    await authStore.setGitHubToken("mock-gh-token");
    const identityStore = createIdentityStore(storage);
    await identityStore.upsert({ googleAuthor: "Sangtae Ahn", githubLogin: "humphreyahn" });

    let reviewBody: unknown;
    mockFetch.mockImplementation(async (url: any, init?: RequestInit) => {
      const urlStr = String(url);
      const method = init?.method ?? "GET";

      if (urlStr.includes("/pulls/123/files")) {
        return {
          ok: true,
          json: () =>
            Promise.resolve([
              {
                filename: "README.md",
                raw_url: "https://raw.example/README.md",
                status: "modified"
              }
            ])
        };
      }

      if (urlStr === "https://raw.example/README.md") {
        return { ok: true, text: () => Promise.resolve("hello selected text") };
      }

      if (urlStr.includes("/pulls/123/comments") && method === "POST") {
        reviewBody = JSON.parse(String(init?.body));
        return { ok: true, json: () => Promise.resolve({ id: 777 }) };
      }

      return { ok: true, json: async () => ({}) };
    });

    await adapter.pushDocCommentToGH(
      {
        id: "doc-comment-1",
        content: "Please fix this",
        quotedFileContent: "selected text",
        createdAt: "t",
        updatedAt: "t",
        author: "Sangtae Ahn",
        resolved: false
      },
      {
        repo: "org/repo",
        prNumber: 123,
        docs: [
          {
            filename: "README.md",
            docId: "doc-1",
            docUrl: "https://docs.google.com/document/d/doc-1/edit"
          }
        ],
        createdAt: "t",
        lastSyncedAt: "t",
        headSha: "sha1",
        latestSha: "sha1",
        isStale: false
      },
      "doc-1"
    );

    expect(reviewBody).toMatchObject({
      body: "> From Google Docs -- @humphreyahn -- Please fix this\n\n[View in GDoc](https://docs.google.com/document/d/doc-1/edit?disco=doc-comment-1)\n\n<!-- dorv-src=doc:doc-comment-1 -->",
      path: "README.md",
      line: 1
    });
  });
});

describe("DirectAdapter createDoc: reuse existing GDoc from PR comment", () => {
  let storage: StorageArea;
  let adapter: DirectAdapter;
  let authStore: AuthStore;
  let docStore: any;

  beforeEach(() => {
    storage = createMemoryStorageArea();
    authStore = createAuthStore(storage);
    docStore = createDocStore(storage);
    adapter = new DirectAdapter(authStore, storage);
    mockFetch.mockReset();
    (global as any).chrome = {
      runtime: { lastError: null },
      identity: {
        getAuthToken: vi.fn((_opts: any, cb: any) => cb(undefined)),
        removeCachedAuthToken: vi.fn()
      }
    };
  });

  it("reuses existing GDoc when dorv bot comment (new marker format) is in PR comments", async () => {
    await authStore.setGitHubToken("mock-gh-token");
    const calls: string[] = [];

    mockFetch.mockImplementation(async (url: any, init?: RequestInit) => {
      const urlStr = String(url);
      calls.push(urlStr);

      if (urlStr.includes("/issues/42/comments") && (!init?.method || init.method === "GET")) {
        return {
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 100,
                body: '<!-- dorv-docs={"README.md":"existing-doc-id"} -->\n🤖 **dorv** has created linked Google Doc for review:\n\n- [README.md](https://docs.google.com/document/d/existing-doc-id/edit)'
              }
            ])
        };
      }

      return { ok: true, json: async () => ({}) };
    });

    const result = await adapter.createDoc({
      repo: "org/repo",
      prNumber: 42,
      title: "My PR",
      author: "alice",
      branch: "feature/x",
      headSha: "sha-abc",
      prUrl: "https://github.com/org/repo/pull/42",
      files: [
        { filename: "README.md", rawUrl: "https://raw.example/README.md", status: "modified" }
      ]
    });

    expect(result.mapping.docs).toEqual([
      {
        filename: "README.md",
        docId: "existing-doc-id",
        docUrl: "https://docs.google.com/document/d/existing-doc-id/edit"
      }
    ]);
    expect(result.mapping.headSha).toBe("sha-abc");

    const driveUpload = calls.find((u) => u.includes("/upload/drive/v3/files"));
    expect(driveUpload).toBeUndefined();

    const mapping = await docStore.get("org/repo", 42);
    expect(mapping?.docs[0]?.docId).toBe("existing-doc-id");
  });

  it("reuses existing GDoc when dorv bot comment (legacy format, no marker) is in PR comments", async () => {
    await authStore.setGitHubToken("mock-gh-token");
    const calls: string[] = [];

    mockFetch.mockImplementation(async (url: any, init?: RequestInit) => {
      const urlStr = String(url);
      calls.push(urlStr);

      if (urlStr.includes("/issues/42/comments") && (!init?.method || init.method === "GET")) {
        return {
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 101,
                body: "🤖 **dorv** has created a linked Google Doc for review:\n\n[PR #42 - My PR](https://docs.google.com/document/d/legacy-doc-id/edit)"
              }
            ])
        };
      }

      return { ok: true, json: async () => ({}) };
    });

    const result = await adapter.createDoc({
      repo: "org/repo",
      prNumber: 42,
      title: "My PR",
      author: "alice",
      branch: "feature/x",
      headSha: "sha-abc",
      prUrl: "https://github.com/org/repo/pull/42",
      files: [
        { filename: "README.md", rawUrl: "https://raw.example/README.md", status: "modified" }
      ]
    });

    expect(result.mapping.docs).toEqual([
      {
        filename: "__legacy__",
        docId: "legacy-doc-id",
        docUrl: "https://docs.google.com/document/d/legacy-doc-id/edit"
      }
    ]);

    const driveUpload = calls.find((u) => u.includes("/upload/drive/v3/files"));
    expect(driveUpload).toBeUndefined();
  });

  it("does not post a new bot comment when picking up an existing GDoc", async () => {
    await authStore.setGitHubToken("mock-gh-token");
    const postCalls: string[] = [];

    mockFetch.mockImplementation(async (url: any, init?: RequestInit) => {
      const urlStr = String(url);
      if (init?.method === "POST" && urlStr.includes("/issues/")) {
        postCalls.push(urlStr);
      }

      if (urlStr.includes("/issues/42/comments") && (!init?.method || init.method === "GET")) {
        return {
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 102,
                body: "🤖 **dorv** has created a linked Google Doc for review:\n\n[PR #42](https://docs.google.com/document/d/picked-doc-id/edit)"
              }
            ])
        };
      }

      return { ok: true, json: async () => ({}) };
    });

    await adapter.createDoc({
      repo: "org/repo",
      prNumber: 42,
      title: "My PR",
      author: "alice",
      branch: "feature/x",
      headSha: "sha-abc",
      prUrl: "https://github.com/org/repo/pull/42",
      files: []
    });

    expect(postCalls).toHaveLength(0);
  });

  it("falls through to creation when no bot comment is found", async () => {
    await authStore.setGitHubToken("mock-gh-token");
    (chrome.identity.getAuthToken as any).mockImplementation((opts: any, cb: any) =>
      cb("mock-g-token")
    );
    const calls: string[] = [];

    mockFetch.mockImplementation(async (url: any, init?: RequestInit) => {
      const urlStr = String(url);
      calls.push(`${init?.method ?? "GET"} ${urlStr}`);

      if (urlStr.includes("/issues/42/comments") && (!init?.method || init.method === "GET")) {
        return { ok: true, json: () => Promise.resolve([]) };
      }

      if (urlStr === "https://raw.example/README.md") {
        return { ok: true, text: () => Promise.resolve("# RFC") };
      }

      if (urlStr.includes("/upload/drive/v3/files")) {
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              id: "new-doc-id",
              webViewLink: "https://docs.google.com/document/d/new-doc-id/edit"
            })
        };
      }

      return { ok: true, json: async () => ({}) };
    });

    const result = await adapter.createDoc({
      repo: "org/repo",
      prNumber: 42,
      title: "My PR",
      author: "alice",
      branch: "feature/x",
      headSha: "sha-abc",
      prUrl: "https://github.com/org/repo/pull/42",
      files: [
        { filename: "README.md", rawUrl: "https://raw.example/README.md", status: "modified" }
      ]
    });

    expect(result.mapping.docs[0]?.docId).toBe("new-doc-id");
    const driveUpload = calls.find((u) => u.includes("/upload/drive/v3/files"));
    expect(driveUpload).toBeDefined();
  });

  it("green-field: creates new GDoc and posts bot comment with hidden marker when no prior comment exists", async () => {
    await authStore.setGitHubToken("mock-gh-token");
    (chrome.identity.getAuthToken as any).mockImplementation((opts: any, cb: any) =>
      cb("mock-g-token")
    );

    let postedBotComment = "";
    mockFetch.mockImplementation(async (url: any, init?: RequestInit) => {
      const urlStr = String(url);

      if (urlStr.includes("/issues/42/comments") && (!init?.method || init.method === "GET")) {
        return { ok: true, json: () => Promise.resolve([]) };
      }

      if (urlStr === "https://raw.example/README.md") {
        return { ok: true, text: () => Promise.resolve("# RFC") };
      }

      if (urlStr.includes("/upload/drive/v3/files")) {
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              id: "green-field-doc-id",
              webViewLink: "https://docs.google.com/document/d/green-field-doc-id/edit"
            })
        };
      }

      if (urlStr.includes("/drive/v3/files/green-field-doc-id/permissions")) {
        return { ok: true, json: () => Promise.resolve({ id: "perm-1" }) };
      }

      if (urlStr.includes("/issues/42/comments") && init?.method === "POST") {
        postedBotComment = JSON.parse(String(init.body)).body as string;
        return { ok: true, json: () => Promise.resolve({ id: 999 }) };
      }

      return { ok: true, json: async () => ({}) };
    });

    const result = await adapter.createDoc({
      repo: "org/repo",
      prNumber: 42,
      title: "My PR",
      author: "alice",
      branch: "feature/x",
      headSha: "sha-abc",
      prUrl: "https://github.com/org/repo/pull/42",
      files: [
        { filename: "README.md", rawUrl: "https://raw.example/README.md", status: "modified" }
      ]
    });

    expect(result.mapping.docs[0]?.docId).toBe("green-field-doc-id");
    expect(result.mapping.headSha).toBe("sha-abc");

    // Bot comment must carry the hidden marker so future pickup finds it
    expect(postedBotComment).toContain('"README.md":"green-field-doc-id"');
    expect(postedBotComment).toContain("**dorv**");
    expect(postedBotComment).toContain(
      "https://docs.google.com/document/d/green-field-doc-id/edit"
    );
    // Version history is recorded for the initial creation
    expect(postedBotComment).toContain("(ref: sha-abc)");

    // Mapping must be stored
    const stored = await docStore.get("org/repo", 42);
    expect(stored?.docs[0]?.docId).toBe("green-field-doc-id");
  });
});

describe("DirectAdapter refreshDocsIfStale", () => {
  let storage: StorageArea;
  let adapter: DirectAdapter;
  let authStore: AuthStore;
  let docStore: any;
  let activityStore: any;

  beforeEach(() => {
    storage = createMemoryStorageArea();
    authStore = createAuthStore(storage);
    docStore = createDocStore(storage);
    activityStore = createActivityStore(storage);
    adapter = new DirectAdapter(authStore, storage);
    mockFetch.mockReset();
    (global as any).chrome = {
      runtime: { lastError: null },
      identity: {
        getAuthToken: vi.fn((_opts: any, cb: any) => cb("mock-g-token")),
        removeCachedAuthToken: vi.fn()
      }
    };
  });

  it("creates a new doc, archives the old one in versions, and clears stale", async () => {
    await authStore.setGitHubToken("mock-gh-token");

    let patchedBody: string | undefined;
    mockFetch.mockImplementation(async (url: any, init?: RequestInit) => {
      const urlStr = String(url);
      const method = init?.method ?? "GET";

      // Order matters: /pulls/123/files must be checked BEFORE /pulls/123
      if (urlStr.includes("/pulls/123/files")) {
        return {
          ok: true,
          json: () =>
            Promise.resolve([
              {
                filename: "README.md",
                raw_url: "https://raw.example/README.md",
                status: "modified"
              }
            ])
        };
      }

      if (urlStr.includes("/pulls/123")) {
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              title: "My PR",
              user: { login: "alice" },
              head: { ref: "feature/x", sha: "new-sha-123" },
              html_url: "https://github.com/org/repo/pull/123"
            })
        };
      }

      if (urlStr === "https://raw.example/README.md") {
        return { ok: true, text: () => Promise.resolve("# Updated README") };
      }

      if (urlStr.includes("/upload/drive/v3/files")) {
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              id: "new-doc-id",
              webViewLink: "https://docs.google.com/document/d/new-doc-id/edit"
            })
        };
      }

      if (urlStr.includes("/drive/v3/files/new-doc-id/permissions")) {
        return { ok: true, json: () => Promise.resolve({ id: "perm-1" }) };
      }

      if (urlStr.includes("/issues/123/comments") && method === "GET") {
        return {
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 200,
                body: '<!-- dorv-docs={"README.md":"old-doc-id"} -->\n🤖 **dorv** has created linked Google Doc for review:\n\n- [README.md](https://docs.google.com/document/d/old-doc-id/edit)'
              }
            ])
        };
      }

      if (urlStr.includes("/issues/comments/200") && method === "PATCH") {
        patchedBody = JSON.parse(String(init?.body)).body as string;
        return { ok: true, json: () => Promise.resolve({ id: 200 }) };
      }

      return { ok: true, json: async () => ({}) };
    });

    const ref = { repo: "org/repo", prNumber: 123 };
    const mapping = {
      ...ref,
      docs: [
        {
          filename: "README.md",
          docId: "old-doc-id",
          docUrl: "https://docs.google.com/document/d/old-doc-id/edit"
        }
      ],
      createdAt: "2026-05-16T12:00:00Z",
      lastSyncedAt: "2026-05-16T12:00:00Z",
      headSha: "old-sha-456",
      latestSha: "old-sha-456",
      isStale: false
    };
    await docStore.upsert(mapping);

    // Call refresh directly to bypass sync lock / stale detection complexity in tests
    await (adapter as any).refreshDocsIfStale(ref, mapping, "mock-gh-token", "mock-g-token");

    const updated = await docStore.get("org/repo", 123);
    expect(updated?.isStale).toBe(false);
    expect(updated?.headSha).toBe("new-sha-123");
    expect(updated?.latestSha).toBe("new-sha-123");
    expect(updated?.docs[0]?.docId).toBe("new-doc-id");

    // The bot comment is updated in-place: the primary link becomes the new
    // doc URL, and the full version history — oldest to newest — is appended
    // in parens, with the highest version number pointing at the latest doc.
    expect(patchedBody).toContain(
      "[README.md](https://docs.google.com/document/d/new-doc-id/edit)"
    );
    expect(patchedBody).toContain(
      "[v1 (ref: old-sha)](https://docs.google.com/document/d/old-doc-id/edit)"
    );
    expect(patchedBody).toContain(
      "[v2 (ref: new-sha)](https://docs.google.com/document/d/new-doc-id/edit)"
    );
    expect(updated?.docs[0]?.versions).toEqual([
      { sha: "old-sha-456", docId: "old-doc-id" },
      { sha: "new-sha-123", docId: "new-doc-id" }
    ]);
  });

  it("does not duplicate the self-tagged version createDoc records when a single refresh follows", async () => {
    await authStore.setGitHubToken("mock-gh-token");

    let uploadCount = 0;
    let postedBotComment = "";
    let patchedBody: string | undefined;
    mockFetch.mockImplementation(async (url: any, init?: RequestInit) => {
      const urlStr = String(url);
      const method = init?.method ?? "GET";

      if (urlStr.includes("/pulls/123/files")) {
        return {
          ok: true,
          json: () =>
            Promise.resolve([
              {
                filename: "README.md",
                raw_url: "https://raw.example/README.md",
                status: "modified"
              }
            ])
        };
      }
      if (urlStr.includes("/pulls/123")) {
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              title: "My PR",
              user: { login: "alice" },
              head: { ref: "feature/x", sha: "sha-2" },
              html_url: "https://github.com/org/repo/pull/123"
            })
        };
      }
      if (urlStr === "https://raw.example/README.md") {
        return { ok: true, text: () => Promise.resolve("# Updated README") };
      }
      if (urlStr.includes("/upload/drive/v3/files")) {
        uploadCount += 1;
        const docId = uploadCount === 1 ? "doc-1" : "doc-2";
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              id: docId,
              webViewLink: `https://docs.google.com/document/d/${docId}/edit`
            })
        };
      }
      if (urlStr.includes("/permissions")) {
        return { ok: true, json: () => Promise.resolve({ id: "perm-1" }) };
      }
      if (urlStr.includes("/issues/123/comments") && method === "GET") {
        return { ok: true, json: () => Promise.resolve([{ id: 500, body: postedBotComment }]) };
      }
      if (urlStr.includes("/issues/123/comments") && method === "POST") {
        postedBotComment = JSON.parse(String(init?.body)).body as string;
        return { ok: true, json: () => Promise.resolve({ id: 500 }) };
      }
      if (urlStr.includes("/issues/comments/500") && method === "PATCH") {
        patchedBody = JSON.parse(String(init?.body)).body as string;
        return { ok: true, json: () => Promise.resolve({ id: 500 }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    const ref = { repo: "org/repo", prNumber: 123 };

    // Real createDoc self-tags the freshly created doc: versions = [{sha: sha-1, docId: doc-1}].
    const created = await adapter.createDoc({
      repo: ref.repo,
      prNumber: ref.prNumber,
      title: "My PR",
      author: "alice",
      branch: "feature/x",
      headSha: "sha-1",
      prUrl: "https://github.com/org/repo/pull/123",
      files: [
        { filename: "README.md", rawUrl: "https://raw.example/README.md", status: "modified" }
      ]
    });
    expect(created.mapping.docs[0]?.versions).toEqual([{ sha: "sha-1", docId: "doc-1" }]);

    // One refresh follows (sha-1 -> sha-2). The old doc's self-tag from
    // createDoc must not be duplicated into a second, identical entry.
    const mapping = created.mapping;
    await (adapter as any).refreshDocsIfStale(ref, mapping, "mock-gh-token", "mock-g-token");

    const updated = await docStore.get("org/repo", 123);
    expect(updated?.docs[0]?.docId).toBe("doc-2");
    // doc-1's own self-tag (from createDoc) is reused as v1, not duplicated —
    // and doc-2, the latest, lands at v2: highest version = latest doc.
    expect(updated?.docs[0]?.versions).toEqual([
      { sha: "sha-1", docId: "doc-1" },
      { sha: "sha-2", docId: "doc-2" }
    ]);

    expect(patchedBody).toContain("[README.md](https://docs.google.com/document/d/doc-2/edit)");
    expect(patchedBody).toContain(
      "[v1 (ref: sha-1)](https://docs.google.com/document/d/doc-1/edit)"
    );
    expect(patchedBody).toContain(
      "[v2 (ref: sha-2)](https://docs.google.com/document/d/doc-2/edit)"
    );
    // v1 must not appear a second time under a different version number.
    expect(patchedBody?.match(/doc-1\/edit/g)?.length).toBe(1);

    // A second refresh (sha-2 -> sha-3): the latest doc must still be the
    // highest version number, not just true for a single refresh.
    const secondMapping = updated;
    if (!secondMapping) throw new Error("test setup: mapping missing");
    mockFetch.mockImplementation(async (url: any, init?: RequestInit) => {
      const urlStr = String(url);
      const method = init?.method ?? "GET";
      if (urlStr.includes("/pulls/123/files")) {
        return {
          ok: true,
          json: () =>
            Promise.resolve([
              {
                filename: "README.md",
                raw_url: "https://raw.example/README.md",
                status: "modified"
              }
            ])
        };
      }
      if (urlStr.includes("/pulls/123")) {
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              title: "My PR",
              user: { login: "alice" },
              head: { ref: "feature/x", sha: "sha-3" },
              html_url: "https://github.com/org/repo/pull/123"
            })
        };
      }
      if (urlStr === "https://raw.example/README.md") {
        return { ok: true, text: () => Promise.resolve("# Updated README") };
      }
      if (urlStr.includes("/upload/drive/v3/files")) {
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              id: "doc-3",
              webViewLink: "https://docs.google.com/document/d/doc-3/edit"
            })
        };
      }
      if (urlStr.includes("/permissions")) {
        return { ok: true, json: () => Promise.resolve({ id: "perm-1" }) };
      }
      if (urlStr.includes("/issues/123/comments") && method === "GET") {
        return { ok: true, json: () => Promise.resolve([{ id: 500, body: postedBotComment }]) };
      }
      if (urlStr.includes("/issues/comments/500") && method === "PATCH") {
        patchedBody = JSON.parse(String(init?.body)).body as string;
        return { ok: true, json: () => Promise.resolve({ id: 500 }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    await (adapter as any).refreshDocsIfStale(ref, secondMapping, "mock-gh-token", "mock-g-token");

    const twiceRefreshed = await docStore.get("org/repo", 123);
    expect(twiceRefreshed?.docs[0]?.docId).toBe("doc-3");
    expect(twiceRefreshed?.docs[0]?.versions).toEqual([
      { sha: "sha-1", docId: "doc-1" },
      { sha: "sha-2", docId: "doc-2" },
      { sha: "sha-3", docId: "doc-3" }
    ]);
    // Latest doc (doc-3) must be the highest version number.
    expect(patchedBody).toContain(
      "[v3 (ref: sha-3)](https://docs.google.com/document/d/doc-3/edit)"
    );
  });

  it("findDocById resolves a doc archived in versions[]", async () => {
    const mapping = {
      repo: "org/repo",
      prNumber: 123,
      docs: [
        {
          filename: "README.md",
          docId: "new-doc-id",
          docUrl: "https://docs.google.com/document/d/new-doc-id/edit",
          versions: [{ sha: "old-sha", docId: "old-doc-id" }]
        }
      ],
      createdAt: "2026-05-16T12:00:00Z",
      lastSyncedAt: "2026-05-16T12:00:00Z",
      headSha: "new-sha",
      latestSha: "new-sha",
      isStale: false
    };

    const { findDocById } = await import("../apps/extension/lib/adapters/types.js");
    expect(findDocById(mapping, "old-doc-id")?.docId).toBe("old-doc-id");
    expect(findDocById(mapping, "new-doc-id")?.docId).toBe("new-doc-id");
  });

  it("marks stale but does not refresh when Google token is missing", async () => {
    await authStore.setGitHubToken("mock-gh-token");
    (chrome.identity.getAuthToken as any).mockImplementation((opts: any, cb: any) => cb(undefined));

    mockFetch.mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("/pulls/123")) {
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              title: "My PR",
              user: { login: "alice" },
              head: { ref: "feature/x", sha: "new-sha-789" },
              html_url: "https://github.com/org/repo/pull/123"
            })
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    const ref = { repo: "org/repo", prNumber: 123 };
    const mapping = {
      ...ref,
      docs: [
        {
          filename: "README.md",
          docId: "doc-1",
          docUrl: "https://docs.google.com/document/d/doc-1/edit"
        }
      ],
      createdAt: "2026-05-16T12:00:00Z",
      lastSyncedAt: "2026-05-16T12:00:00Z",
      headSha: "old-sha",
      latestSha: "old-sha",
      isStale: false
    };
    await docStore.upsert(mapping);

    await adapter.syncPR(ref);

    const updated = await docStore.get("org/repo", 123);
    expect(updated?.isStale).toBe(true);
    expect(updated?.latestSha).toBe("new-sha-789");
    expect(updated?.docs[0]?.docId).toBe("doc-1");
  });

  it("refreshes a PR that was previously marked stale once the Google token becomes available", async () => {
    await authStore.setGitHubToken("mock-gh-token");

    mockFetch.mockImplementation(async (url: any, init?: RequestInit) => {
      const urlStr = String(url);
      const method = init?.method ?? "GET";

      if (urlStr.includes("/pulls/123/files")) {
        return {
          ok: true,
          json: () =>
            Promise.resolve([
              {
                filename: "README.md",
                raw_url: "https://raw.example/README.md",
                status: "modified"
              }
            ])
        };
      }

      if (urlStr.includes("/pulls/123")) {
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              title: "My PR",
              user: { login: "alice" },
              head: { ref: "feature/x", sha: "new-sha-789" },
              html_url: "https://github.com/org/repo/pull/123"
            })
        };
      }

      if (urlStr === "https://raw.example/README.md") {
        return { ok: true, text: () => Promise.resolve("# Updated README") };
      }

      if (urlStr.includes("/upload/drive/v3/files")) {
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              id: "new-doc-id",
              webViewLink: "https://docs.google.com/document/d/new-doc-id/edit"
            })
        };
      }

      if (urlStr.includes("/drive/v3/files/new-doc-id/permissions")) {
        return { ok: true, json: () => Promise.resolve({ id: "perm-1" }) };
      }

      if (urlStr.includes("/issues/123/comments") && method === "GET") {
        return {
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 200,
                body: '<!-- dorv-docs={"README.md":"doc-1"} -->\n🤖 **dorv** has created linked Google Doc for review:\n\n- [README.md](https://docs.google.com/document/d/doc-1/edit)'
              }
            ])
        };
      }

      if (urlStr.includes("/issues/comments/200") && method === "PATCH") {
        return { ok: true, json: () => Promise.resolve({ id: 200 }) };
      }

      return { ok: true, json: async () => ({}) };
    });

    const ref = { repo: "org/repo", prNumber: 123 };
    const mapping = {
      ...ref,
      docs: [
        {
          filename: "README.md",
          docId: "doc-1",
          docUrl: "https://docs.google.com/document/d/doc-1/edit"
        }
      ],
      createdAt: "2026-05-16T12:00:00Z",
      lastSyncedAt: "2026-05-16T12:00:00Z",
      headSha: "old-sha",
      latestSha: "new-sha-789",
      isStale: true
    };
    await docStore.upsert(mapping);

    await adapter.syncPR(ref);

    const updated = await docStore.get("org/repo", 123);
    expect(updated?.isStale).toBe(false);
    expect(updated?.headSha).toBe("new-sha-789");
    expect(updated?.docs[0]?.docId).toBe("new-doc-id");
    expect(updated?.docs[0]?.versions).toEqual([
      { sha: "old-sha", docId: "doc-1" },
      { sha: "new-sha-789", docId: "new-doc-id" }
    ]);
  });

  it("skips a file removed from the PR during refresh", async () => {
    await authStore.setGitHubToken("mock-gh-token");

    mockFetch.mockImplementation(async (url: any, init?: RequestInit) => {
      const urlStr = String(url);
      const method = init?.method ?? "GET";

      // Order matters: /pulls/123/files must be checked BEFORE /pulls/123
      if (urlStr.includes("/pulls/123/files")) {
        // README.md is gone, only AGENTS.md remains
        return {
          ok: true,
          json: () =>
            Promise.resolve([
              {
                filename: "AGENTS.md",
                raw_url: "https://raw.example/AGENTS.md",
                status: "modified"
              }
            ])
        };
      }

      if (urlStr.includes("/pulls/123")) {
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              title: "My PR",
              user: { login: "alice" },
              head: { ref: "feature/x", sha: "new-sha-999" },
              html_url: "https://github.com/org/repo/pull/123"
            })
        };
      }

      if (urlStr === "https://raw.example/AGENTS.md") {
        return { ok: true, text: () => Promise.resolve("# Updated AGENTS") };
      }

      if (urlStr.includes("/upload/drive/v3/files")) {
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              id: "new-agents-doc",
              webViewLink: "https://docs.google.com/document/d/new-agents-doc/edit"
            })
        };
      }

      if (urlStr.includes("/drive/v3/files/new-agents-doc/permissions")) {
        return { ok: true, json: () => Promise.resolve({ id: "perm-1" }) };
      }

      if (urlStr.includes("/issues/123/comments") && method === "GET") {
        return {
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 200,
                body: '<!-- dorv-docs={"README.md":"readme-doc","AGENTS.md":"agents-doc"} -->\n🤖 **dorv** ...'
              }
            ])
        };
      }

      if (urlStr.includes("/issues/comments/200") && method === "PATCH") {
        return { ok: true, json: () => Promise.resolve({ id: 200 }) };
      }

      return { ok: true, json: async () => ({}) };
    });

    const ref = { repo: "org/repo", prNumber: 123 };
    const mapping = {
      ...ref,
      docs: [
        {
          filename: "README.md",
          docId: "readme-doc",
          docUrl: "https://docs.google.com/document/d/readme-doc/edit"
        },
        {
          filename: "AGENTS.md",
          docId: "agents-doc",
          docUrl: "https://docs.google.com/document/d/agents-doc/edit"
        }
      ],
      createdAt: "2026-05-16T12:00:00Z",
      lastSyncedAt: "2026-05-16T12:00:00Z",
      headSha: "old-sha",
      latestSha: "old-sha",
      isStale: false
    };
    await docStore.upsert(mapping);

    await adapter.syncPR(ref);

    const updated = await docStore.get("org/repo", 123);
    expect(updated?.isStale).toBe(false);
    const readmeDoc = updated?.docs.find((d: any) => d.filename === "README.md");
    const agentsDoc = updated?.docs.find((d: any) => d.filename === "AGENTS.md");
    expect(readmeDoc?.docId).toBe("readme-doc"); // unchanged — file removed
    expect(agentsDoc?.docId).toBe("new-agents-doc"); // refreshed
  });

  it.each([3, 4, 5])(
    "keeps an independent version chain per file across multiple refreshes (%i markdown files)",
    async (fileCount) => {
      await authStore.setGitHubToken("mock-gh-token");

      const filenames = Array.from({ length: fileCount }, (_, i) => `doc${i.toString()}.md`);
      let uploadCallIndex = 0;
      let currentSha = "s0";

      mockFetch.mockImplementation(async (url: any, init?: RequestInit) => {
        const urlStr = String(url);
        const method = init?.method ?? "GET";

        if (urlStr.includes("/pulls/123/files")) {
          return {
            ok: true,
            json: () =>
              Promise.resolve(
                filenames.map((filename) => ({
                  filename,
                  raw_url: `https://raw.example/${filename}`,
                  status: "modified"
                }))
              )
          };
        }
        if (urlStr.includes("/pulls/123")) {
          return {
            ok: true,
            json: () =>
              Promise.resolve({
                title: "My PR",
                user: { login: "alice" },
                head: { ref: "feature/x", sha: currentSha },
                html_url: "https://github.com/org/repo/pull/123"
              })
          };
        }
        if (urlStr.startsWith("https://raw.example/")) {
          return { ok: true, text: () => Promise.resolve("# content") };
        }
        if (urlStr.includes("/upload/drive/v3/files")) {
          // Uploads happen sequentially in filename order, fileCount at a
          // time per round — derive (round, fileIndex) from call order so
          // each file gets its own docId per round.
          const round = Math.floor(uploadCallIndex / fileCount);
          const fileIndex = uploadCallIndex % fileCount;
          uploadCallIndex += 1;
          const docId = `d${fileIndex.toString()}-${round.toString()}`;
          return {
            ok: true,
            json: () =>
              Promise.resolve({
                id: docId,
                webViewLink: `https://docs.google.com/document/d/${docId}/edit`
              })
          };
        }
        if (urlStr.includes("/permissions")) {
          return { ok: true, json: () => Promise.resolve({ id: "perm-1" }) };
        }
        if (urlStr.includes("/issues/123/comments") && method === "GET") {
          return { ok: true, json: () => Promise.resolve([]) };
        }
        return { ok: true, json: async () => ({}) };
      });

      const ref = { repo: "org/repo", prNumber: 123 };
      const created = await adapter.createDoc({
        repo: ref.repo,
        prNumber: ref.prNumber,
        title: "My PR",
        author: "alice",
        branch: "feature/x",
        headSha: currentSha,
        prUrl: "https://github.com/org/repo/pull/123",
        files: filenames.map((filename) => ({
          filename,
          rawUrl: `https://raw.example/${filename}`,
          status: "modified"
        }))
      });

      // Round 0: every file self-tagged with its own creation doc.
      for (const [i, filename] of filenames.entries()) {
        const doc = created.mapping.docs.find((d) => d.filename === filename);
        expect(doc?.docId).toBe(`d${i.toString()}-0`);
        expect(doc?.versions).toEqual([{ sha: "s0", docId: `d${i.toString()}-0` }]);
      }

      currentSha = "s1";
      let mapping = created.mapping;
      await (adapter as any).refreshDocsIfStale(ref, mapping, "mock-gh-token", "mock-g-token");
      mapping = (await docStore.get(ref.repo, ref.prNumber))!;

      currentSha = "s2";
      await (adapter as any).refreshDocsIfStale(ref, mapping, "mock-gh-token", "mock-g-token");
      mapping = (await docStore.get(ref.repo, ref.prNumber))!;

      // Every file must independently carry all three rounds, in order,
      // with the highest version number pointing at that file's latest doc —
      // no cross-contamination between files' version chains.
      for (const [i, filename] of filenames.entries()) {
        const doc = mapping.docs.find((d) => d.filename === filename);
        expect(doc?.docId).toBe(`d${i.toString()}-2`);
        expect(doc?.versions).toEqual([
          { sha: "s0", docId: `d${i.toString()}-0` },
          { sha: "s1", docId: `d${i.toString()}-1` },
          { sha: "s2", docId: `d${i.toString()}-2` }
        ]);
      }
    }
  );
});

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
      docId: "doc-1",
      docUrl: "url-1",
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
      docId: "doc-1",
      docUrl: "url-1",
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
      docId: "doc-1",
      docUrl: "url-1",
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
      anchor: JSON.stringify({
        region: { kind: "drive#commentRegion", line: 42, rev: "head" },
        dorv: { path: "docs/rfc.md", side: "RIGHT" }
      }),
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
      docId: "doc-1",
      docUrl: "url-1",
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
      docId: "doc-1",
      docUrl: "url-1",
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
        docId: "doc-1",
        docUrl: "https://docs.google.com/document/d/doc-1/edit",
        createdAt: "t",
        lastSyncedAt: "t",
        headSha: "sha1",
        latestSha: "sha1",
        isStale: false
      }
    );

    expect(reviewBody).toMatchObject({
      body: "> From Google Docs -- @humphreyahn -- Please fix this\n\n[View in GDoc](https://docs.google.com/document/d/doc-1/edit)",
      path: "README.md",
      line: 1
    });
  });
});

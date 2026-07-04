/* eslint-disable */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { DirectAdapter } from "../apps/extension/lib/adapters/direct.js";
import { createMemoryStorageArea } from "../apps/extension/lib/storage/memory.js";
import { createAuthStore, type AuthStore } from "../apps/extension/lib/storage/auth.js";
import {
  createDocStore,
  createMappingStore,
  createReplyMappingStore
} from "../apps/extension/lib/storage/stores.js";
import type { DocMapping } from "../apps/extension/lib/adapters/types.js";
import type { StorageArea } from "../apps/extension/lib/storage/area.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeDocMapping(ref: { repo: string; prNumber: number }): DocMapping {
  return {
    ...ref,
    docs: [
      { filename: "f.md", docId: "doc-1", docUrl: "https://docs.google.com/document/d/doc-1" }
    ],
    createdAt: "2026-05-16T12:00:00Z",
    lastSyncedAt: "2026-05-16T12:00:00Z",
    headSha: "sha1",
    latestSha: "sha1",
    isStale: false
  };
}

describe("Reply sync — bidirectional", () => {
  let storage: StorageArea;
  let adapter: DirectAdapter;
  let authStore: AuthStore;
  let docStore: ReturnType<typeof createDocStore>;
  let mappingStore: ReturnType<typeof createMappingStore>;
  let replyMappingStore: ReturnType<typeof createReplyMappingStore>;

  beforeEach(() => {
    storage = createMemoryStorageArea();
    authStore = createAuthStore(storage);
    docStore = createDocStore(storage);
    mappingStore = createMappingStore(storage);
    replyMappingStore = createReplyMappingStore(storage);
    adapter = new DirectAdapter(authStore, storage);

    mockFetch.mockReset();

    (global as any).chrome = {
      runtime: { lastError: null },
      identity: {
        getAuthToken: vi.fn(),
        removeCachedAuthToken: vi.fn()
      }
    };
  });

  describe("GH reply → Doc", () => {
    it("syncs a GH reply to Drive when parent is mapped", async () => {
      const ref = { repo: "org/repo", prNumber: 1 };
      await authStore.setGitHubToken("gh-tok");
      (chrome.identity.getAuthToken as any).mockImplementation((_: any, cb: any) => cb("g-tok"));
      await docStore.upsert(makeDocMapping(ref));

      // Parent comment already mapped
      await mappingStore.upsert({
        ...ref,
        ghCommentId: 10,
        docCommentId: "doc-c-10",
        docId: "doc-1",
        source: "github"
      });

      let driveReplyBody: any;
      mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.includes("api.github.com")) {
          return {
            ok: true,
            json: () =>
              Promise.resolve([
                // Parent
                {
                  id: 10,
                  body: "parent",
                  path: "f.md",
                  line: 5,
                  in_reply_to_id: null,
                  user: { login: "alice" },
                  html_url: "https://github.com/p",
                  created_at: "t",
                  updated_at: "t"
                },
                // Reply
                {
                  id: 11,
                  body: "reply text",
                  path: "f.md",
                  line: 5,
                  in_reply_to_id: 10,
                  user: { login: "bob" },
                  html_url: "https://github.com/r",
                  created_at: "t",
                  updated_at: "t"
                }
              ])
          };
        }
        if (url.includes("googleapis.com/drive") && url.includes("/replies")) {
          driveReplyBody = JSON.parse(String(init?.body));
          return { ok: true, json: () => Promise.resolve({ id: "drive-reply-1" }) };
        }
        if (url.includes("googleapis.com/drive")) {
          // fetchGDocComments returns empty
          return { ok: true, json: () => Promise.resolve({ comments: [] }) };
        }
        return { ok: true, json: () => Promise.resolve({}) };
      });

      await adapter.syncAll();

      const replyMapping = await replyMappingStore.getByGH(11);
      expect(replyMapping).toBeDefined();
      expect(replyMapping?.docReplyId).toBe("drive-reply-1");
      expect(replyMapping?.ghParentCommentId).toBe(10);
      expect(replyMapping?.docParentCommentId).toBe("doc-c-10");
      expect(replyMapping?.source).toBe("github");
      expect(driveReplyBody).toEqual({
        content: "[GitHub: @bob]\n\nreply text\n\n[View on GitHub](https://github.com/r)"
      });
    });

    it("skips GH reply if parent comment not yet mapped", async () => {
      const ref = { repo: "org/repo", prNumber: 1 };
      await authStore.setGitHubToken("gh-tok");
      (chrome.identity.getAuthToken as any).mockImplementation((_: any, cb: any) => cb("g-tok"));
      await docStore.upsert(makeDocMapping(ref));
      // No parent mapping stored

      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("api.github.com")) {
          return {
            ok: true,
            json: () =>
              Promise.resolve([
                {
                  id: 20,
                  body: "orphan reply",
                  path: "f.md",
                  line: 1,
                  in_reply_to_id: 99,
                  user: { login: "eve" },
                  html_url: "https://github.com/x",
                  created_at: "t",
                  updated_at: "t"
                }
              ])
          };
        }
        if (url.includes("googleapis.com/drive")) {
          return { ok: true, json: () => Promise.resolve({ comments: [] }) };
        }
        return { ok: true, json: () => Promise.resolve({}) };
      });

      await adapter.syncAll();

      expect(await replyMappingStore.getByGH(20)).toBeUndefined();
    });

    it("does not double-sync a GH reply", async () => {
      const ref = { repo: "org/repo", prNumber: 1 };
      await authStore.setGitHubToken("gh-tok");
      (chrome.identity.getAuthToken as any).mockImplementation((_: any, cb: any) => cb("g-tok"));
      await docStore.upsert(makeDocMapping(ref));
      await mappingStore.upsert({
        ...ref,
        ghCommentId: 10,
        docCommentId: "doc-c-10",
        docId: "doc-1",
        source: "github"
      });
      // Pre-populate reply mapping
      await replyMappingStore.upsert({
        ...ref,
        ghReplyId: 11,
        docReplyId: "existing-reply",
        ghParentCommentId: 10,
        docParentCommentId: "doc-c-10",
        docId: "doc-1",
        source: "github"
      });

      const driveReplyCalls: string[] = [];
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("api.github.com")) {
          return {
            ok: true,
            json: () =>
              Promise.resolve([
                {
                  id: 10,
                  body: "parent",
                  path: "f.md",
                  line: 5,
                  in_reply_to_id: null,
                  user: { login: "a" },
                  html_url: "h",
                  created_at: "t",
                  updated_at: "t"
                },
                {
                  id: 11,
                  body: "reply",
                  path: "f.md",
                  line: 5,
                  in_reply_to_id: 10,
                  user: { login: "b" },
                  html_url: "h",
                  created_at: "t",
                  updated_at: "t"
                }
              ])
          };
        }
        if (url.includes("/replies")) {
          driveReplyCalls.push(url);
          return { ok: true, json: () => Promise.resolve({ id: "new-reply" }) };
        }
        if (url.includes("googleapis.com")) {
          return { ok: true, json: () => Promise.resolve({ comments: [] }) };
        }
        return { ok: true, json: () => Promise.resolve({}) };
      });

      await adapter.syncAll();

      expect(driveReplyCalls).toHaveLength(0);
      expect((await replyMappingStore.getByGH(11))?.docReplyId).toBe("existing-reply");
    });
  });

  describe("Doc reply → GH", () => {
    it("syncs a Doc reply to GH when parent is mapped", async () => {
      const ref = { repo: "org/repo", prNumber: 1 };
      await authStore.setGitHubToken("gh-tok");
      (chrome.identity.getAuthToken as any).mockImplementation((_: any, cb: any) => cb("g-tok"));
      await docStore.upsert(makeDocMapping(ref));
      await mappingStore.upsert({
        ...ref,
        ghCommentId: 50,
        docCommentId: "doc-c-50",
        docId: "doc-1",
        source: "github"
      });

      mockFetch.mockImplementation(async (url: string, opts?: RequestInit) => {
        const method = opts?.method ?? "GET";
        if (url.includes("api.github.com") && method === "GET") {
          // fetchReviewComments — no top-level or reply comments
          return { ok: true, json: () => Promise.resolve([]) };
        }
        if (url.includes("googleapis.com/drive/v3/files/doc-1/comments") && method === "GET") {
          return {
            ok: true,
            json: () =>
              Promise.resolve({
                comments: [
                  {
                    id: "doc-c-50",
                    content: "parent comment",
                    author: { displayName: "Alice" },
                    createdTime: "t",
                    replies: [
                      {
                        id: "doc-reply-7",
                        content: "reply from doc",
                        author: { displayName: "Bob" },
                        createdTime: "t"
                      }
                    ]
                  }
                ]
              })
          };
        }
        if (url.includes("api.github.com") && method === "POST") {
          return { ok: true, json: () => Promise.resolve({ id: 77 }) };
        }
        return { ok: true, json: () => Promise.resolve({}) };
      });

      await adapter.syncAll();

      const replyMapping = await replyMappingStore.getByDoc("doc-reply-7");
      expect(replyMapping).toBeDefined();
      expect(replyMapping?.ghReplyId).toBe(77);
      expect(replyMapping?.ghParentCommentId).toBe(50);
      expect(replyMapping?.source).toBe("gdoc");
    });

    it("does not double-sync a Doc reply", async () => {
      const ref = { repo: "org/repo", prNumber: 1 };
      await authStore.setGitHubToken("gh-tok");
      (chrome.identity.getAuthToken as any).mockImplementation((_: any, cb: any) => cb("g-tok"));
      await docStore.upsert(makeDocMapping(ref));
      await mappingStore.upsert({
        ...ref,
        ghCommentId: 50,
        docCommentId: "doc-c-50",
        docId: "doc-1",
        source: "github"
      });
      await replyMappingStore.upsert({
        ...ref,
        ghReplyId: 77,
        docReplyId: "doc-reply-7",
        ghParentCommentId: 50,
        docParentCommentId: "doc-c-50",
        docId: "doc-1",
        source: "gdoc"
      });

      const ghReplyCalls: string[] = [];
      mockFetch.mockImplementation(async (url: string, opts?: RequestInit) => {
        const method = opts?.method ?? "GET";
        if (url.includes("api.github.com") && method === "POST") {
          ghReplyCalls.push(url);
          return { ok: true, json: () => Promise.resolve({ id: 999 }) };
        }
        if (url.includes("api.github.com") && method === "GET") {
          return { ok: true, json: () => Promise.resolve([]) };
        }
        if (url.includes("googleapis.com")) {
          return {
            ok: true,
            json: () =>
              Promise.resolve({
                comments: [
                  {
                    id: "doc-c-50",
                    content: "parent",
                    author: { displayName: "Alice" },
                    createdTime: "t",
                    replies: [
                      {
                        id: "doc-reply-7",
                        content: "reply",
                        author: { displayName: "Bob" },
                        createdTime: "t"
                      }
                    ]
                  }
                ]
              })
          };
        }
        return { ok: true, json: () => Promise.resolve({}) };
      });

      await adapter.syncAll();

      // No new GH reply calls should happen (the reply is already mapped)
      const replyToGhCalls = ghReplyCalls.filter((u) => u.match(/pulls\/\d+\/comments/));
      expect(replyToGhCalls).toHaveLength(0);
    });
  });
});

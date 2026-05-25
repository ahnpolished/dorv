/* eslint-disable */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DirectAdapter } from "../apps/extension/lib/adapters/direct.js";
import type { DocMapping } from "../apps/extension/lib/adapters/types.js";
import { createAuthStore, type AuthStore } from "../apps/extension/lib/storage/auth.js";
import type { StorageArea } from "../apps/extension/lib/storage/area.js";
import { createMemoryStorageArea } from "../apps/extension/lib/storage/memory.js";
import {
  createDocStore,
  createMappingStore,
  createReplyMappingStore
} from "../apps/extension/lib/storage/stores.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const REF = { repo: "org/repo", prNumber: 123 };
const DOC_MAPPING: DocMapping = {
  ...REF,
  docId: "doc-1",
  docUrl: "https://docs.google.com/document/d/doc-1/edit",
  createdAt: "2026-05-16T12:00:00Z",
  lastSyncedAt: "2026-05-16T12:00:00Z",
  headSha: "sha1",
  latestSha: "sha1",
  isStale: false
};

const ORIGINAL_SNAPSHOT = JSON.stringify({
  root: { id: 10, body: "old body", updatedAt: "2026-05-25T00:00:00Z" },
  replies: [{ id: 11, body: "old reply", inReplyToId: 10, updatedAt: "2026-05-25T00:01:00Z" }]
});

function reviewThreadsResponse(input: {
  isResolved: boolean;
  rootBody: string;
  rootUpdatedAt: string;
}) {
  return {
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: [
              {
                id: "thread-1",
                isResolved: input.isResolved,
                path: "docs/rfc.md",
                line: 42,
                diffSide: "RIGHT",
                comments: {
                  nodes: [
                    {
                      databaseId: 10,
                      body: input.rootBody,
                      path: "docs/rfc.md",
                      line: 42,
                      diffHunk: "@@ -42,1 +42,1 @@\n+target paragraph",
                      createdAt: "2026-05-25T00:00:00Z",
                      updatedAt: input.rootUpdatedAt,
                      url: "https://github.com/org/repo/pull/123#discussion_r10",
                      author: { login: "alice" },
                      replyTo: null
                    },
                    {
                      databaseId: 11,
                      body: "new reply",
                      path: "docs/rfc.md",
                      line: 42,
                      diffHunk: null,
                      createdAt: "2026-05-25T00:01:00Z",
                      updatedAt: "2026-05-25T00:01:00Z",
                      url: "https://github.com/org/repo/pull/123#discussion_r11",
                      author: { login: "bob" },
                      replyTo: { databaseId: 10 }
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
  };
}

describe("GitHub thread lifecycle sync", () => {
  let storage: StorageArea;
  let authStore: AuthStore;
  let adapter: DirectAdapter;
  let docStore: ReturnType<typeof createDocStore>;
  let mappingStore: ReturnType<typeof createMappingStore>;
  let replyMappingStore: ReturnType<typeof createReplyMappingStore>;

  beforeEach(async () => {
    storage = createMemoryStorageArea();
    authStore = createAuthStore(storage);
    adapter = new DirectAdapter(authStore, storage);
    docStore = createDocStore(storage);
    mappingStore = createMappingStore(storage);
    replyMappingStore = createReplyMappingStore(storage);

    mockFetch.mockReset();
    (global as any).chrome = {
      runtime: { lastError: null },
      identity: {
        getAuthToken: vi.fn((_opts: any, cb: any) => cb("g-token")),
        removeCachedAuthToken: vi.fn()
      }
    };

    await authStore.setGitHubToken("gh-token");
    await docStore.upsert(DOC_MAPPING);
  });

  it("recreates a whole mirrored GDoc thread when the GitHub thread snapshot changes", async () => {
    await mappingStore.upsert({
      ...REF,
      ghCommentId: 10,
      docCommentId: "doc-root-old",
      source: "github",
      ghThreadId: "thread-1",
      threadSnapshot: ORIGINAL_SNAPSHOT
    });
    await replyMappingStore.upsert({
      ...REF,
      ghReplyId: 11,
      docReplyId: "doc-reply-old",
      ghParentCommentId: 10,
      docParentCommentId: "doc-root-old",
      source: "github"
    });

    const driveCalls: Array<{ url: string; method: string; body?: unknown }> = [];
    mockFetch.mockImplementation(async (url: any, init?: RequestInit) => {
      const urlStr = String(url);
      const method = init?.method ?? "GET";
      if (urlStr.includes("/graphql")) {
        return {
          ok: true,
          json: async () =>
            reviewThreadsResponse({
              isResolved: false,
              rootBody: "new body",
              rootUpdatedAt: "2026-05-25T00:02:00Z"
            })
        };
      }
      if (urlStr.includes("googleapis.com/drive/v3/files/doc-1/comments")) {
        driveCalls.push({
          url: urlStr,
          method,
          body: init?.body ? JSON.parse(String(init.body)) : undefined
        });
        if (method === "DELETE") return { ok: true, json: async () => ({}) };
        if (urlStr.includes("/replies")) {
          return { ok: true, json: async () => ({ id: "doc-reply-new" }) };
        }
        if (method === "POST") {
          return { ok: true, json: async () => ({ id: "doc-root-new" }) };
        }
        return { ok: true, json: async () => ({ comments: [] }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    await adapter.syncAll();

    expect(driveCalls.map((call) => call.method)).toEqual(["DELETE", "POST", "POST", "GET"]);
    expect(driveCalls[0]?.url).toContain("/comments/doc-root-old");
    expect(driveCalls[1]?.body).toMatchObject({ content: expect.stringContaining("new body") });
    expect(driveCalls[2]?.url).toContain("/comments/doc-root-new/replies");

    expect(await mappingStore.getByDoc("doc-root-old")).toBeUndefined();
    expect(await mappingStore.getByGH(10)).toMatchObject({
      docCommentId: "doc-root-new",
      ghThreadId: "thread-1",
      ghUpdatedAt: "2026-05-25T00:02:00Z"
    });
    expect(await replyMappingStore.getByDoc("doc-reply-old")).toBeUndefined();
    expect(await replyMappingStore.getByGH(11)).toMatchObject({
      docReplyId: "doc-reply-new",
      docParentCommentId: "doc-root-new",
      ghUpdatedAt: "2026-05-25T00:01:00Z"
    });
  });

  it("resolves only the mirrored root GDoc comment when a GitHub thread is resolved", async () => {
    await mappingStore.upsert({
      ...REF,
      ghCommentId: 10,
      docCommentId: "doc-root-10",
      source: "github",
      ghThreadId: "thread-1",
      threadSnapshot: ORIGINAL_SNAPSHOT
    });

    let patchBody: unknown;
    mockFetch.mockImplementation(async (url: any, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes("/graphql")) {
        return {
          ok: true,
          json: async () =>
            reviewThreadsResponse({
              isResolved: true,
              rootBody: "old body",
              rootUpdatedAt: "2026-05-25T00:00:00Z"
            })
        };
      }
      if (urlStr.includes("/comments/doc-root-10") && init?.method === "PATCH") {
        patchBody = JSON.parse(String(init.body));
        return { ok: true, json: async () => ({ id: "doc-root-10", resolved: true }) };
      }
      if (urlStr.includes("googleapis.com/drive")) {
        return { ok: true, json: async () => ({ comments: [] }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    await adapter.syncAll();

    expect(patchBody).toEqual({ resolved: true });
    expect(await mappingStore.getByGH(10)).toMatchObject({
      docCommentId: "doc-root-10",
      resolvedAt: expect.any(String)
    });
  });

  it("does not recreate or reopen a previously resolved mirrored thread", async () => {
    await mappingStore.upsert({
      ...REF,
      ghCommentId: 10,
      docCommentId: "doc-root-10",
      source: "github",
      ghThreadId: "thread-1",
      threadSnapshot: ORIGINAL_SNAPSHOT,
      resolvedAt: "2026-05-25T00:03:00Z"
    });

    const mutationMethods: string[] = [];
    mockFetch.mockImplementation(async (url: any, init?: RequestInit) => {
      const urlStr = String(url);
      const method = init?.method ?? "GET";
      if (urlStr.includes("/graphql")) {
        return {
          ok: true,
          json: async () =>
            reviewThreadsResponse({
              isResolved: false,
              rootBody: "new body after reopen",
              rootUpdatedAt: "2026-05-25T00:04:00Z"
            })
        };
      }
      if (urlStr.includes("googleapis.com/drive/v3/files/doc-1/comments")) {
        if (method !== "GET") mutationMethods.push(method);
        return { ok: true, json: async () => ({ comments: [] }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    await adapter.syncAll();

    expect(mutationMethods).toEqual([]);
    expect(await mappingStore.getByGH(10)).toMatchObject({
      docCommentId: "doc-root-10",
      resolvedAt: "2026-05-25T00:03:00Z",
      threadSnapshot: ORIGINAL_SNAPSHOT
    });
  });
});

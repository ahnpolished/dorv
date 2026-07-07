/* eslint-disable */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { DirectAdapter } from "../apps/extension/lib/adapters/direct.js";
import { createMemoryStorageArea } from "../apps/extension/lib/storage/memory.js";
import { createAuthStore, type AuthStore } from "../apps/extension/lib/storage/auth.js";
import { createDocStore, createMappingStore } from "../apps/extension/lib/storage/stores.js";
import type { DocMapping } from "../apps/extension/lib/adapters/types.js";
import type { StorageArea } from "../apps/extension/lib/storage/area.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const DOC_URL = "https://docs.google.com/document/d/doc-99/edit";
const GH_COMMENT_URL = "https://github.com/org/repo/pull/1#discussion_r42";

const BASE_MAPPING: DocMapping = {
  repo: "org/repo",
  prNumber: 1,
  docs: [{ filename: "README.md", docId: "doc-99", docUrl: DOC_URL }],
  createdAt: "t",
  lastSyncedAt: "t",
  headSha: "sha1",
  latestSha: "sha1",
  isStale: false
};

describe("HUM-1254 cross-links", () => {
  let storage: StorageArea;
  let adapter: DirectAdapter;
  let authStore: AuthStore;
  let docStore: ReturnType<typeof createDocStore>;
  let mappingStore: ReturnType<typeof createMappingStore>;

  beforeEach(() => {
    storage = createMemoryStorageArea();
    authStore = createAuthStore(storage);
    docStore = createDocStore(storage);
    mappingStore = createMappingStore(storage);
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

  it("GH → GDoc: pushed comment includes link back to original GitHub comment", async () => {
    await authStore.setGitHubToken("mock-gh-token");
    await docStore.upsert(BASE_MAPPING);

    let capturedBody: string | undefined;
    mockFetch.mockImplementation(async (url: any, init?: RequestInit) => {
      const urlStr = String(url);
      if (
        urlStr.includes("googleapis.com/drive/v3/files/doc-99/comments") &&
        init?.method === "POST"
      ) {
        capturedBody = JSON.parse(String(init?.body)).content as string;
        return { ok: true, json: () => Promise.resolve({ id: "gdoc-c-1" }) };
      }
      if (urlStr.includes("googleapis.com/drive/v3/files/doc-99/comments")) {
        return { ok: true, json: () => Promise.resolve({ comments: [] }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    await adapter.pushGHCommentToDoc(
      {
        id: 42,
        body: "Looks good",
        path: "README.md",
        line: 5,
        user: "alice",
        htmlUrl: GH_COMMENT_URL,
        createdAt: "t",
        updatedAt: "t",
        resolved: false
      } as any,
      BASE_MAPPING
    );

    expect(capturedBody).toContain("Looks good");
    expect(capturedBody).toContain("[GitHub: @alice]");
    expect(capturedBody).toContain(`[View on GitHub](${GH_COMMENT_URL})`);
  });

  it("GDoc → GH: pushed comment includes link back to Google Doc", async () => {
    await authStore.setGitHubToken("mock-gh-token");

    let capturedBody: string | undefined;
    mockFetch.mockImplementation(async (url: any, init?: RequestInit) => {
      const urlStr = String(url);
      const method = init?.method ?? "GET";

      if (urlStr.includes("/pulls/1/files")) {
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
        return { ok: true, text: () => Promise.resolve("highlighted text here") };
      }
      if (urlStr.includes("/pulls/1/comments") && method === "POST") {
        capturedBody = JSON.parse(String(init?.body)).body as string;
        return { ok: true, json: () => Promise.resolve({ id: 888 }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    await adapter.pushDocCommentToGH(
      {
        id: "gdoc-c-1",
        content: "Please clarify",
        quotedFileContent: "highlighted text",
        author: "Bob Smith",
        createdAt: "t",
        updatedAt: "t",
        resolved: false
      } as any,
      BASE_MAPPING,
      "doc-99"
    );

    expect(capturedBody).toContain("Please clarify");
    expect(capturedBody).toContain(`[View in GDoc](${DOC_URL})`);
  });
});

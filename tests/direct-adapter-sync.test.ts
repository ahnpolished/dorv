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

describe("DirectAdapter baseline sync", () => {
  let storage: StorageArea;
  let adapter: DirectAdapter;
  let authStore: AuthStore;
  let docStore: any;
  let mappingStore: any;

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
        getAuthToken: vi.fn(),
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
    (chrome.identity.getAuthToken as any).mockImplementation((opts: any, cb: any) => cb("mock-g-token"));

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
          json: () => Promise.resolve([{
            id: 1,
            body: "new comment",
            path: "f.ts",
            line: 10,
            in_reply_to_id: null,
            user: { login: "u" },
            html_url: "h",
            created_at: "t",
            updated_at: "t"
          }])
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
  });
});

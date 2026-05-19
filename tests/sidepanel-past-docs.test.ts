import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryStorageArea } from "../apps/extension/lib/storage/memory.js";
import { createDocStore, createSettingsStore } from "../apps/extension/lib/storage/stores.js";
import { buildPastDocsList } from "../apps/extension/lib/sidepanel/model.js";
import type { DocMapping } from "../apps/extension/lib/adapters/types.js";

const base: DocMapping = {
  repo: "org/repo",
  prNumber: 1,
  docId: "doc-1",
  docUrl: "https://docs.google.com/document/d/doc-1/edit",
  createdAt: "2026-05-19T00:00:00Z",
  lastSyncedAt: "2026-05-19T00:00:00Z",
  headSha: "abc",
  latestSha: "abc",
  isStale: false
};

describe("buildPastDocsList", () => {
  it("returns empty list when no docs linked", async () => {
    const storage = createMemoryStorageArea();
    const docStore = createDocStore(storage);
    expect(await buildPastDocsList(docStore)).toEqual([]);
  });

  it("returns all linked DocMappings in active list", async () => {
    const storage = createMemoryStorageArea();
    const docStore = createDocStore(storage);
    await docStore.upsert({ ...base, repo: "org/a", prNumber: 1, docId: "d1" });
    await docStore.upsert({ ...base, repo: "org/b", prNumber: 2, docId: "d2" });
    const result = await buildPastDocsList(docStore);
    expect(result).toHaveLength(2);
    expect(result.map((m) => m.docId).sort()).toEqual(["d1", "d2"]);
  });

  it("omits refs whose DocMapping was evicted from storage", async () => {
    const storage = createMemoryStorageArea();
    const docStore = createDocStore(storage);
    await docStore.upsert(base);
    // Inject an orphaned active_prs entry alongside the real one
    await storage.set({
      active_prs: [
        { repo: "org/repo", prNumber: 1 },
        { repo: "org/ghost", prNumber: 99 }
      ]
    });
    const result = await buildPastDocsList(docStore);
    // Only the real mapping survives
    expect(result).toHaveLength(1);
    expect(result[0]?.docId).toBe("doc-1");
  });
});

describe("createSettingsStore", () => {
  let storage: ReturnType<typeof createMemoryStorageArea>;

  beforeEach(() => {
    storage = createMemoryStorageArea();
  });

  it("defaults autoOpenSidepanel to true", async () => {
    const store = createSettingsStore(storage);
    expect(await store.getAutoOpenSidepanel()).toBe(true);
  });

  it("persists autoOpenSidepanel false", async () => {
    const store = createSettingsStore(storage);
    await store.setAutoOpenSidepanel(false);
    expect(await store.getAutoOpenSidepanel()).toBe(false);
  });

  it("persists autoOpenSidepanel true after being set false", async () => {
    const store = createSettingsStore(storage);
    await store.setAutoOpenSidepanel(false);
    await store.setAutoOpenSidepanel(true);
    expect(await store.getAutoOpenSidepanel()).toBe(true);
  });
});

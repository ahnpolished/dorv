/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, beforeEach } from "vitest";
import { DirectAdapter } from "../apps/extension/lib/adapters/direct.js";
import { createMemoryStorageArea } from "../apps/extension/lib/storage/memory.js";
import { createAuthStore, type AuthStore } from "../apps/extension/lib/storage/auth.js";
import { createDocStore, createStatusStore } from "../apps/extension/lib/storage/stores.js";
import type { DocMapping } from "../apps/extension/lib/adapters/types.js";
import type { StorageArea } from "../apps/extension/lib/storage/area.js";

describe("DirectAdapter baseline sync", () => {
  let storage: StorageArea;
  let adapter: DirectAdapter;
  let authStore: AuthStore;
  let docStore: any;
  let statusStore: any;

  beforeEach(() => {
    storage = createMemoryStorageArea();
    authStore = createAuthStore(storage);
    docStore = createDocStore(storage);
    statusStore = createStatusStore(storage);
    adapter = new DirectAdapter(authStore, storage);
  });

  it("syncAll updates lastSyncedAt and status", async () => {
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

    // Initial state
    expect((await docStore.get(ref.repo, ref.prNumber))?.lastSyncedAt).toBe("2026-05-16T12:00:00Z");

    // Perform sync
    await adapter.syncAll();

    // Verify updates
    const updatedMapping = await docStore.get(ref.repo, ref.prNumber);
    expect(updatedMapping?.lastSyncedAt).not.toBe("2026-05-16T12:00:00Z");

    const status = await statusStore.get(ref.repo, ref.prNumber);
    expect(status?.state).toBe("idle");
  });
});

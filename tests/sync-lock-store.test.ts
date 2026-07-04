import { describe, expect, it, vi } from "vitest";
import { createSyncLockStore } from "../apps/extension/lib/storage/sync-lock-store.js";
import { createMemoryStorageArea } from "../apps/extension/lib/storage/memory.js";

const ref = { repo: "o/r", prNumber: 1 };

describe("syncLockStore", () => {
  it("acquires a lock when none exists", async () => {
    const store = createSyncLockStore(createMemoryStorageArea());
    await expect(store.acquire(ref, 60_000)).resolves.toBe(true);
  });

  it("refuses to acquire a fresh, already-held lock", async () => {
    const store = createSyncLockStore(createMemoryStorageArea());
    await store.acquire(ref, 60_000);
    await expect(store.acquire(ref, 60_000)).resolves.toBe(false);
  });

  it("steals a stale lock past its ttl", async () => {
    vi.useFakeTimers();
    try {
      const store = createSyncLockStore(createMemoryStorageArea());
      await store.acquire(ref, 1_000);
      vi.advanceTimersByTime(2_000);
      await expect(store.acquire(ref, 1_000)).resolves.toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("allows re-acquiring after release", async () => {
    const store = createSyncLockStore(createMemoryStorageArea());
    await store.acquire(ref, 60_000);
    await store.release(ref);
    await expect(store.acquire(ref, 60_000)).resolves.toBe(true);
  });

  it("scopes locks per repo/PR", async () => {
    const store = createSyncLockStore(createMemoryStorageArea());
    await store.acquire(ref, 60_000);
    await expect(store.acquire({ repo: "o/r", prNumber: 2 }, 60_000)).resolves.toBe(true);
  });
});

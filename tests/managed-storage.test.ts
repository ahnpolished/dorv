/* eslint-disable */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { createAuthStore } from "../apps/extension/lib/storage/auth.js";
import { createMemoryStorageArea } from "../apps/extension/lib/storage/memory.js";

describe("AuthStore managed storage", () => {
  beforeEach(() => {
    (global as any).chrome = {
      runtime: { lastError: null },
      identity: { getAuthToken: vi.fn(), removeCachedAuthToken: vi.fn() }
    };
  });

  it("isManagedBackendUrl returns false when no managed storage provided", async () => {
    const local = createMemoryStorageArea();
    const store = createAuthStore(local);
    expect(await store.isManagedBackendUrl()).toBe(false);
  });

  it("isManagedBackendUrl returns false when managed storage has no backend_url", async () => {
    const local = createMemoryStorageArea();
    const managed = createMemoryStorageArea();
    const store = createAuthStore(local, managed);
    expect(await store.isManagedBackendUrl()).toBe(false);
  });

  it("isManagedBackendUrl returns true when managed storage has backend_url", async () => {
    const local = createMemoryStorageArea();
    const managed = createMemoryStorageArea();
    await managed.set({ backend_url: "https://api.corp.example.com" });
    const store = createAuthStore(local, managed);
    expect(await store.isManagedBackendUrl()).toBe(true);
  });

  it("getBackendUrl prefers managed over local", async () => {
    const local = createMemoryStorageArea();
    const managed = createMemoryStorageArea();
    await local.set({ backend_url: "https://local.example.com" });
    await managed.set({ backend_url: "https://managed.example.com" });
    const store = createAuthStore(local, managed);
    expect(await store.getBackendUrl()).toBe("https://managed.example.com");
  });

  it("getBackendUrl falls back to local when managed has no backend_url", async () => {
    const local = createMemoryStorageArea();
    const managed = createMemoryStorageArea();
    await local.set({ backend_url: "https://local.example.com" });
    const store = createAuthStore(local, managed);
    expect(await store.getBackendUrl()).toBe("https://local.example.com");
  });

  it("getBackendUrl returns undefined when neither storage has backend_url", async () => {
    const local = createMemoryStorageArea();
    const managed = createMemoryStorageArea();
    const store = createAuthStore(local, managed);
    expect(await store.getBackendUrl()).toBeUndefined();
  });
});

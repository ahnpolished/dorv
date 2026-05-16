import { describe, expect, it, beforeEach } from "vitest";
import { createAuthStore } from "../apps/extension/lib/storage/auth.js";
import { createMemoryStorageArea } from "../apps/extension/lib/storage/memory.js";

describe("AuthStore", () => {
  let storage: any;
  let authStore: any;

  beforeEach(() => {
    storage = createMemoryStorageArea();
    authStore = createAuthStore(storage);
  });

  describe("GitHub", () => {
    it("gets and sets github token", async () => {
      expect(await authStore.getGitHubToken()).toBeUndefined();
      await authStore.setGitHubToken("ghp_test123");
      expect(await authStore.getGitHubToken()).toBe("ghp_test123");
    });

    it("clears github token", async () => {
      await authStore.setGitHubToken("ghp_test123");
      await authStore.clearGitHubToken();
      expect(await authStore.getGitHubToken()).toBeUndefined();
    });
  });

  describe("Backend", () => {
    it("gets and sets backend url", async () => {
      expect(await authStore.getBackendUrl()).toBeUndefined();
      await authStore.setBackendUrl("https://api.dorv.dev");
      expect(await authStore.getBackendUrl()).toBe("https://api.dorv.dev");
    });
  });
});

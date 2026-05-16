/* eslint-disable */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { createAuthStore, type AuthStore } from "../apps/extension/lib/storage/auth.js";
import { createMemoryStorageArea } from "../apps/extension/lib/storage/memory.js";
import type { StorageArea } from "../apps/extension/lib/storage/area.js";

describe("AuthStore", () => {
  let storage: StorageArea;
  let authStore: AuthStore;

  beforeEach(() => {
    storage = createMemoryStorageArea();
    authStore = createAuthStore(storage);

    // Mock chrome globals
    (global as any).chrome = {
      runtime: {
        lastError: null
      },
      identity: {
        getAuthToken: vi.fn(),
        removeCachedAuthToken: vi.fn()
      }
    };
  });

  describe("GitHub", () => {
    it("gets and sets github token", async () => {
      expect(await authStore.getGitHubToken()).toBeUndefined();
      await authStore.setGitHubToken("ghp_test123");
      expect(await authStore.getGitHubToken()).toBe("ghp_test123");
    });
  });

  describe("Google OAuth", () => {
    it("gets google token via chrome.identity", async () => {
      const mockToken = "mock-google-token";
      (vi.mocked(chrome.identity.getAuthToken) as any).mockImplementation((opts: any, cb: any) => {
        cb(mockToken);
      });

      const token = await authStore.getGoogleToken(true);
      expect(token).toBe(mockToken);
      expect(chrome.identity.getAuthToken).toHaveBeenCalledWith(
        { interactive: true },
        expect.any(Function)
      );
    });

    it("handles chrome.identity error", async () => {
      (chrome.runtime as any).lastError = { message: "Error" };
      (vi.mocked(chrome.identity.getAuthToken) as any).mockImplementation((opts: any, cb: any) => {
        cb(undefined);
      });

      const token = await authStore.getGoogleToken(false);
      expect(token).toBeUndefined();
    });

    it("revokes google token", async () => {
      const mockToken = "stale-token";
      (vi.mocked(chrome.identity.getAuthToken) as any).mockImplementation((opts: any, cb: any) => {
        cb(mockToken);
      });
      (vi.mocked(chrome.identity.removeCachedAuthToken) as any).mockImplementation(
        (opts: any, cb: any) => {
          cb();
        }
      );

      await authStore.revokeGoogleToken();
      expect(chrome.identity.removeCachedAuthToken).toHaveBeenCalledWith(
        { token: mockToken },
        expect.any(Function)
      );
    });
  });
});

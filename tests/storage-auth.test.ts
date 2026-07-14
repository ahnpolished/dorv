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

    (global as any).chrome = {
      runtime: {
        lastError: null,
        getManifest: vi.fn().mockReturnValue({
          oauth2: { client_id: "test-client-id", scopes: ["email", "profile"] }
        })
      },
      identity: {
        launchWebAuthFlow: vi.fn(),
        getRedirectURL: vi.fn().mockReturnValue("https://test-extension-id.chromiumapp.org/")
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
    it("gets google token via launchWebAuthFlow and caches it", async () => {
      (vi.mocked(chrome.identity.launchWebAuthFlow) as any).mockImplementation(
        (opts: any, cb: any) => {
          cb(
            "https://test-extension-id.chromiumapp.org/#access_token=mock-google-token&token_type=Bearer"
          );
        }
      );

      const token = await authStore.getGoogleToken(true);
      expect(token).toBe("mock-google-token");
      expect(chrome.identity.launchWebAuthFlow).toHaveBeenCalledWith(
        expect.objectContaining({ interactive: true }),
        expect.any(Function)
      );

      // Passive lookups read the token back from the cache populated above.
      await expect(authStore.getGoogleToken(false)).resolves.toBe("mock-google-token");
    });

    it("returns undefined when passive google token lookup misses", async () => {
      await expect(authStore.getGoogleToken(false)).resolves.toBeUndefined();
      expect(chrome.identity.launchWebAuthFlow).not.toHaveBeenCalled();
    });

    it("rejects when the user cancels the auth popup", async () => {
      (vi.mocked(chrome.identity.launchWebAuthFlow) as any).mockImplementation(
        (opts: any, cb: any) => {
          (chrome.runtime as any).lastError = { message: "The user did not approve access." };
          cb(undefined);
        }
      );

      await expect(authStore.getGoogleToken(true)).rejects.toThrow(
        "The user did not approve access."
      );
    });

    it("fetches google profile from userinfo endpoint", async () => {
      const mockProfile = {
        email: "test@example.com",
        name: "Test User",
        picture: "https://example.com/avatar.jpg"
      };

      // Mock fetch for the userinfo call
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockProfile)
      });

      try {
        const profile = await authStore.getGoogleProfile("mock-token");
        expect(profile).toEqual(mockProfile);
        expect(global.fetch).toHaveBeenCalledWith("https://www.googleapis.com/oauth2/v2/userinfo", {
          headers: { Authorization: "Bearer mock-token" }
        });
      } finally {
        global.fetch = originalFetch;
      }
    });

    it("throws when userinfo fetch fails", async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized"
      });

      try {
        await expect(authStore.getGoogleProfile("bad-token")).rejects.toThrow(
          "Failed to fetch Google profile: 401 Unauthorized"
        );
      } finally {
        global.fetch = originalFetch;
      }
    });

    it("revokes google token by clearing the cache", async () => {
      (vi.mocked(chrome.identity.launchWebAuthFlow) as any).mockImplementation(
        (opts: any, cb: any) => {
          cb(
            "https://test-extension-id.chromiumapp.org/#access_token=stale-token&token_type=Bearer"
          );
        }
      );
      await authStore.getGoogleToken(true);
      await expect(authStore.getGoogleToken(false)).resolves.toBe("stale-token");

      await authStore.revokeGoogleToken();
      await expect(authStore.getGoogleToken(false)).resolves.toBeUndefined();
    });
  });
});

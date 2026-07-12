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

    // Mock chrome globals — defaults simulate real Chrome (native identity supported)
    (global as any).chrome = {
      runtime: {
        lastError: null,
        getManifest: vi.fn().mockReturnValue({
          oauth2: { client_id: "test-client-id", scopes: ["email", "profile"] }
        })
      },
      identity: {
        getAuthToken: vi.fn(),
        removeCachedAuthToken: vi.fn(),
        getProfileUserInfo: vi.fn().mockImplementation((opts: any, cb: any) => {
          cb({ id: "chrome-profile-id", email: "test@example.com" });
        }),
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

    it("returns undefined when passive google token lookup misses", async () => {
      (chrome.runtime as any).lastError = { message: "OAuth2 not granted or revoked." };
      (vi.mocked(chrome.identity.getAuthToken) as any).mockImplementation((opts: any, cb: any) => {
        cb(undefined);
      });

      await expect(authStore.getGoogleToken(false)).resolves.toBeUndefined();
    });

    it("rejects with the Chrome error message on interactive identity failure", async () => {
      (chrome.runtime as any).lastError = { message: "The user did not approve access." };
      (vi.mocked(chrome.identity.getAuthToken) as any).mockImplementation((opts: any, cb: any) => {
        cb(undefined);
      });

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

    it("falls back to launchWebAuthFlow on browsers without native identity support (e.g. Arc)", async () => {
      (vi.mocked(chrome.identity.getProfileUserInfo) as any).mockImplementation(
        (opts: any, cb: any) => {
          cb({ id: "", email: "" });
        }
      );
      (vi.mocked(chrome.identity.launchWebAuthFlow) as any).mockImplementation(
        (opts: any, cb: any) => {
          cb(
            "https://test-extension-id.chromiumapp.org/#access_token=web-flow-token&token_type=Bearer"
          );
        }
      );

      const token = await authStore.getGoogleToken(true);
      expect(token).toBe("web-flow-token");
      expect(chrome.identity.getAuthToken).not.toHaveBeenCalled();
      expect(chrome.identity.launchWebAuthFlow).toHaveBeenCalledWith(
        expect.objectContaining({ interactive: true }),
        expect.any(Function)
      );
    });

    it("skips launchWebAuthFlow for passive lookups on unsupported browsers", async () => {
      (vi.mocked(chrome.identity.getProfileUserInfo) as any).mockImplementation(
        (opts: any, cb: any) => {
          cb({ id: "", email: "" });
        }
      );

      await expect(authStore.getGoogleToken(false)).resolves.toBeUndefined();
      expect(chrome.identity.launchWebAuthFlow).not.toHaveBeenCalled();
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

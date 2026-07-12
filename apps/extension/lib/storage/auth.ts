import type { StorageArea } from "./area.js";

export interface GoogleProfile {
  email: string;
  name: string;
  picture: string;
}

export interface AuthStore {
  getGitHubToken(): Promise<string | undefined>;
  setGitHubToken(token: string): Promise<void>;
  clearGitHubToken(): Promise<void>;
  getBackendUrl(): Promise<string | undefined>;
  setBackendUrl(url: string): Promise<void>;
  isManagedBackendUrl(): Promise<boolean>;
  getGoogleToken(interactive: boolean): Promise<string | undefined>;
  getGoogleProfile(token: string): Promise<GoogleProfile>;
  revokeGoogleToken(): Promise<void>;
}

function hasChromeIdentitySupport(): Promise<boolean> {
  if (typeof chrome.identity.getProfileUserInfo !== "function") {
    // Older/partial chrome.identity shims (and some test mocks): assume
    // native support and let getAuthToken itself surface any failure.
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    chrome.identity.getProfileUserInfo({ accountStatus: "ANY" }, (info) => {
      resolve(!!info.id);
    });
  });
}

function getTokenViaChromeIdentity(interactive: boolean): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) {
        if (!interactive) {
          resolve(undefined);
          return;
        }
        reject(new Error(chrome.runtime.lastError.message ?? "Unknown identity error"));
        return;
      }
      resolve(token as string);
    });
  });
}

// Traditional OAuth popup flow for browsers without Chrome's native identity
// integration. Requires the manifest's oauth2 client to allow the
// https://<extension-id>.chromiumapp.org/ redirect URI in Google Cloud Console.
function getTokenViaWebAuthFlow(): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const oauth2 = chrome.runtime.getManifest().oauth2;
    if (!oauth2?.client_id) {
      reject(new Error("Missing oauth2.client_id in manifest"));
      return;
    }

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", oauth2.client_id);
    authUrl.searchParams.set("response_type", "token");
    authUrl.searchParams.set("redirect_uri", chrome.identity.getRedirectURL());
    authUrl.searchParams.set("scope", oauth2.scopes?.join(" ") ?? "");
    authUrl.searchParams.set("prompt", "select_account");

    chrome.identity.launchWebAuthFlow(
      { url: authUrl.toString(), interactive: true },
      (responseUrl) => {
        if (chrome.runtime.lastError || !responseUrl) {
          reject(new Error(chrome.runtime.lastError?.message ?? "Google sign-in was cancelled"));
          return;
        }
        const token = new URLSearchParams(new URL(responseUrl).hash.slice(1)).get("access_token");
        if (!token) {
          reject(new Error("Google sign-in did not return an access token"));
          return;
        }
        resolve(token);
      }
    );
  });
}

export function createAuthStore(storage: StorageArea, managedStorage?: StorageArea): AuthStore {
  const keys = {
    githubPat: "github_pat",
    backendUrl: "backend_url",
    googleToken: "google_token"
  };

  return {
    async getGitHubToken(): Promise<string | undefined> {
      const values = await storage.get([keys.githubPat]);
      return values[keys.githubPat] as string | undefined;
    },
    async setGitHubToken(token: string): Promise<void> {
      await storage.set({ [keys.githubPat]: token });
    },
    async clearGitHubToken(): Promise<void> {
      await storage.remove([keys.githubPat]);
    },
    async getBackendUrl(): Promise<string | undefined> {
      if (managedStorage) {
        const managed = await managedStorage.get([keys.backendUrl]);
        if (managed[keys.backendUrl]) return managed[keys.backendUrl] as string;
      }
      const values = await storage.get([keys.backendUrl]);
      return values[keys.backendUrl] as string | undefined;
    },
    async setBackendUrl(url: string): Promise<void> {
      await storage.set({ [keys.backendUrl]: url });
    },
    async isManagedBackendUrl(): Promise<boolean> {
      if (!managedStorage) return false;
      const managed = await managedStorage.get([keys.backendUrl]);
      return !!managed[keys.backendUrl];
    },
    async getGoogleToken(interactive: boolean): Promise<string | undefined> {
      // ponytail: chrome.identity.getAuthToken is only backed by a real OAuth
      // flow in actual Google Chrome. Chromium forks (Arc, Brave, ...) fall
      // through to a broken redirect flow that Google rejects with a 400
      // page. getProfileUserInfo is a silent, popup-free way to tell them
      // apart: only real Chrome (signed into a profile) returns an id.
      const chromeNative = await hasChromeIdentitySupport();
      if (chromeNative) {
        return getTokenViaChromeIdentity(interactive);
      }
      // Non-Chrome browsers (Arc, Brave, Edge, …) use launchWebAuthFlow.
      // That flow does NOT cache the token in chrome.identity, so we persist
      // it ourselves in storage so that passive (non-interactive) lookups work.
      if (!interactive) {
        const cached = await storage.get([keys.googleToken]);
        return cached[keys.googleToken] as string | undefined;
      }
      const token = await getTokenViaWebAuthFlow();
      if (token) {
        await storage.set({ [keys.googleToken]: token });
      }
      return token;
    },
    async getGoogleProfile(token: string): Promise<GoogleProfile> {
      const resp = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!resp.ok) {
        throw new Error(
          `Failed to fetch Google profile: ${resp.status.toString()} ${resp.statusText}`
        );
      }

      const data = (await resp.json()) as {
        email: string;
        name: string;
        picture: string;
      };

      return {
        email: data.email,
        name: data.name,
        picture: data.picture
      };
    },

    async revokeGoogleToken(): Promise<void> {
      // Always clear our fallback storage, even if chrome.identity has nothing cached.
      await storage.remove([keys.googleToken]);
      return new Promise((resolve) => {
        chrome.identity.getAuthToken({ interactive: false }, (token) => {
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (token) {
            chrome.identity.removeCachedAuthToken({ token: token as string }, () => {
              resolve();
            });
          } else {
            resolve();
          }
        });
      });
    }
  };
}

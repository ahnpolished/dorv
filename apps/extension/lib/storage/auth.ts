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

export function createAuthStore(storage: StorageArea, managedStorage?: StorageArea): AuthStore {
  const keys = {
    githubPat: "github_pat",
    backendUrl: "backend_url"
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
      return new Promise((resolve, reject) => {
        let settled = false;
        // ponytail: some Chromium forks (e.g. Arc) never invoke the getAuthToken
        // callback when chrome.identity isn't backed by a real OAuth flow — bound
        // the wait so "Please wait..." can't hang forever.
        const timeoutId = interactive
          ? setTimeout(() => {
              if (settled) return;
              settled = true;
              reject(
                new Error(
                  "Google sign-in timed out. This browser may not support chrome.identity (try Chrome instead of Arc)."
                )
              );
            }, 15000)
          : undefined;

        chrome.identity.getAuthToken({ interactive }, (token) => {
          if (settled) return;
          settled = true;
          if (timeoutId) clearTimeout(timeoutId);

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

import type { StorageArea } from "./area.js";

export interface AuthStore {
  getGitHubToken(): Promise<string | undefined>;
  setGitHubToken(token: string): Promise<void>;
  clearGitHubToken(): Promise<void>;
  getBackendUrl(): Promise<string | undefined>;
  setBackendUrl(url: string): Promise<void>;
  isManagedBackendUrl(): Promise<boolean>;
  getGoogleToken(interactive: boolean): Promise<string | undefined>;
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
      return new Promise((resolve) => {
        chrome.identity.getAuthToken({ interactive }, (token) => {
          if (chrome.runtime.lastError) {
            resolve(undefined);
            return;
          }
          resolve(token as string | undefined);
        });
      });
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

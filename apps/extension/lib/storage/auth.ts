import type { StorageArea } from "./area.js";

export interface AuthStore {
  getGitHubToken(): Promise<string | undefined>;
  setGitHubToken(token: string): Promise<void>;
  clearGitHubToken(): Promise<void>;
  getBackendUrl(): Promise<string | undefined>;
  setBackendUrl(url: string): Promise<void>;
}

export function createAuthStore(storage: StorageArea) {
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
      const values = await storage.get([keys.backendUrl]);
      return values[keys.backendUrl] as string | undefined;
    },
    async setBackendUrl(url: string): Promise<void> {
      await storage.set({ [keys.backendUrl]: url });
    }
  };
}

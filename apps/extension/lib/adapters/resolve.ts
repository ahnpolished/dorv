import { DirectAdapter } from "./direct.js";
import type { SyncAdapter } from "./types.js";
import type { AuthStore } from "../storage/auth.js";
import type { StorageArea } from "../storage/area.js";

export interface ResolveAdapterOptions {
  backendUrl?: string | undefined;
  authStore: AuthStore;
  storageArea: StorageArea;
}

export function resolveAdapter(options: ResolveAdapterOptions): SyncAdapter {
  if (options.backendUrl === undefined || options.backendUrl.trim() === "") {
    return new DirectAdapter(options.authStore, options.storageArea);
  }

  throw new Error("BackendAdapter is out of scope for v0.1.0");
}

import { DirectAdapter } from "./direct.js";
import type { SyncAdapter } from "./types.js";

export interface ResolveAdapterOptions {
  backendUrl?: string;
}

export function resolveAdapter(options: ResolveAdapterOptions): SyncAdapter {
  if (options.backendUrl === undefined || options.backendUrl.trim() === "") {
    return new DirectAdapter();
  }

  throw new Error("BackendAdapter is out of scope for v0.1.0");
}

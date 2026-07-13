import type { PullRequestRef } from "../adapters/types.js";
import type { StorageArea } from "./area.js";

interface SyncLock {
  startedAt: string;
}

function lockKey(ref: PullRequestRef): string {
  return `syncLockStore:${ref.repo}#${ref.prNumber.toString()}`;
}

/**
 * Persisted per-PR sync lock, replacing an in-memory Map so a service-worker
 * restart mid-sync doesn't leave a permanently-held lock. Locks older than
 * ttlMs are treated as stale and can be stolen by the next acquire call.
 */
export function createSyncLockStore(storage: StorageArea) {
  return {
    async acquire(ref: PullRequestRef, ttlMs: number): Promise<boolean> {
      const key = lockKey(ref);
      const existing = (await storage.get([key]))[key] as SyncLock | undefined;
      if (existing) {
        const age = Date.now() - new Date(existing.startedAt).getTime();
        if (age < ttlMs) {
          console.log(
            "[dorv:syncLock] acquire FAILED — lock held for",
            age,
            "ms (ttl=",
            ttlMs,
            ")",
            ref.repo,
            ref.prNumber
          );
          return false;
        }
        console.log(
          "[dorv:syncLock] acquire STEAL — stale lock age=",
          age,
          "ms",
          ref.repo,
          ref.prNumber
        );
      }
      await storage.set({ [key]: { startedAt: new Date().toISOString() } satisfies SyncLock });
      console.log("[dorv:syncLock] acquire OK", ref.repo, ref.prNumber);
      return true;
    },
    async release(ref: PullRequestRef): Promise<void> {
      await storage.remove([lockKey(ref)]);
      console.log("[dorv:syncLock] release", ref.repo, ref.prNumber);
    }
  };
}

import { QueryClient, type QueryKey } from "@tanstack/react-query";
import type { StorageArea } from "../storage/area.js";
import type {
  CommentMapping,
  DocMapping,
  GitHubReviewComment,
  GoogleDocComment,
  SyncStatus
} from "../adapters/types.js";

export const SIDEPANEL_QUERY_STALE_MS = 60_000;
const SIDEPANEL_QUERY_GC_MS = 10 * 60_000;
const SNAPSHOT_KEY = "sidepanel_query_cache_snapshot";

// Maximum number of GH comments to store in the persisted snapshot.
// Full bodies are stripped because they dominate storage — only IDs
// and metadata survive a restart. Re-fetching 100 comments is fast;
// the snapshot is just for instant tab-switch UX.
const MAX_SNAPSHOT_COMMENTS = 100;

// Snapshots older than this are discarded on hydration.
const SNAPSHOT_TTL_MS = 30 * 60_000;

interface SidepanelCacheSnapshot {
  version: 1 | 2;
  updatedAt: string;
  entries: {
    key: QueryKey;
    data: GitHubReviewComment[] | GoogleDocComment[] | CommentMapping[] | SyncStatus | undefined;
  }[];
}

/** Return a lightweight copy of a comment that omits the full body when storing. */
function slimComment(c: GitHubReviewComment): GitHubReviewComment {
  return {
    ...c,
    body: c.body.length > 200 ? c.body.slice(0, 200) : c.body
  };
}

export const sidepanelQueryKeys = {
  prFiles(repo: string, prNumber: number, headSha?: string): QueryKey {
    return ["pr", repo, prNumber, "files", headSha ?? "current"];
  },
  prMeta(repo: string, prNumber: number): QueryKey {
    return ["pr", repo, prNumber, "meta"];
  },
  ghComments(mapping: Pick<DocMapping, "repo" | "prNumber" | "headSha">): QueryKey {
    return ["pr", mapping.repo, mapping.prNumber, "gh-comments", mapping.headSha];
  },
  gdocComments(docId: string): QueryKey {
    return ["gdoc", docId, "comments"];
  },
  commentMappings(mapping: Pick<DocMapping, "repo" | "prNumber">): QueryKey {
    return ["pr", mapping.repo, mapping.prNumber, "mappings"];
  },
  status(mapping: Pick<DocMapping, "repo" | "prNumber">): QueryKey {
    return ["pr", mapping.repo, mapping.prNumber, "status"];
  },
  activePrs(): QueryKey {
    return ["active-prs"];
  },
  doc(docId: string): QueryKey {
    return ["doc", docId];
  }
};

export function createSidepanelQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: SIDEPANEL_QUERY_STALE_MS,
        gcTime: SIDEPANEL_QUERY_GC_MS,
        refetchOnWindowFocus: false,
        retry: 1
      }
    }
  });
}

/**
 * Persist a lightweight sidepanel cache snapshot.
 *
 * GH comments are trimmed to reduce storage: bodies are truncated,
 * and at most 100 entries are kept. Snapshots older than 30 minutes
 * are discarded on hydrate.
 */
export async function persistSidepanelCacheSnapshot(
  storage: StorageArea,
  queryClient: QueryClient,
  mapping: DocMapping
): Promise<void> {
  const rawGhComments = queryClient.getQueryData<GitHubReviewComment[]>(
    sidepanelQueryKeys.ghComments(mapping)
  );
  const slimmedGhComments = rawGhComments?.slice(0, MAX_SNAPSHOT_COMMENTS).map(slimComment);

  const entries: SidepanelCacheSnapshot["entries"] = [
    ...(slimmedGhComments
      ? [{ key: sidepanelQueryKeys.ghComments(mapping), data: slimmedGhComments }]
      : []),
    {
      key: sidepanelQueryKeys.gdocComments(mapping.docId),
      data: queryClient.getQueryData<GoogleDocComment[]>(
        sidepanelQueryKeys.gdocComments(mapping.docId)
      )
    },
    {
      key: sidepanelQueryKeys.commentMappings(mapping),
      data: queryClient.getQueryData<CommentMapping[]>(sidepanelQueryKeys.commentMappings(mapping))
    },
    {
      key: sidepanelQueryKeys.status(mapping),
      data: queryClient.getQueryData<SyncStatus>(sidepanelQueryKeys.status(mapping))
    }
  ].filter((entry) => entry.data !== undefined);

  const snapshot: SidepanelCacheSnapshot = {
    version: 2,
    updatedAt: new Date().toISOString(),
    entries
  };

  await storage.set({ [SNAPSHOT_KEY]: snapshot });
}

export async function hydrateSidepanelCache(
  storage: StorageArea,
  queryClient: QueryClient,
  mapping: DocMapping
): Promise<void> {
  const values = await storage.get([SNAPSHOT_KEY]);
  const snapshot = values[SNAPSHOT_KEY] as SidepanelCacheSnapshot | undefined;
  if (snapshot?.version !== 1 && snapshot?.version !== 2) return;

  // Discard stale snapshots to free storage.
  const age = Date.now() - new Date(snapshot.updatedAt).getTime();
  if (age > SNAPSHOT_TTL_MS) {
    await storage.remove([SNAPSHOT_KEY]);
    return;
  }

  const allowedKeys = new Set(
    [
      sidepanelQueryKeys.ghComments(mapping),
      sidepanelQueryKeys.gdocComments(mapping.docId),
      sidepanelQueryKeys.commentMappings(mapping),
      sidepanelQueryKeys.status(mapping)
    ].map(stableKey)
  );

  for (const entry of snapshot.entries) {
    if (allowedKeys.has(stableKey(entry.key))) {
      queryClient.setQueryData(entry.key, entry.data);
    }
  }
}

function stableKey(key: QueryKey): string {
  return JSON.stringify(key);
}

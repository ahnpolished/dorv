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

interface SidepanelCacheSnapshot {
  version: 1;
  updatedAt: string;
  entries: {
    key: QueryKey;
    data: GitHubReviewComment[] | GoogleDocComment[] | CommentMapping[] | SyncStatus | undefined;
  }[];
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

export async function persistSidepanelCacheSnapshot(
  storage: StorageArea,
  queryClient: QueryClient,
  mapping: DocMapping
): Promise<void> {
  const entries: SidepanelCacheSnapshot["entries"] = [
    {
      key: sidepanelQueryKeys.ghComments(mapping),
      data: queryClient.getQueryData<GitHubReviewComment[]>(sidepanelQueryKeys.ghComments(mapping))
    },
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
    version: 1,
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
  if (snapshot?.version !== 1) return;

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

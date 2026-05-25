import { describe, expect, it } from "vitest";
import { createMemoryStorageArea } from "../apps/extension/lib/storage/memory.js";
import {
  createSidepanelQueryClient,
  hydrateSidepanelCache,
  persistSidepanelCacheSnapshot,
  sidepanelQueryKeys,
  SIDEPANEL_QUERY_STALE_MS
} from "../apps/extension/lib/sidepanel/query-cache.js";
import type {
  CommentMapping,
  DocMapping,
  GitHubReviewComment,
  GoogleDocComment,
  SyncStatus
} from "../apps/extension/lib/adapters/types.js";

const mapping: DocMapping = {
  repo: "org/repo",
  prNumber: 12,
  docId: "doc-12",
  docUrl: "https://docs.google.com/document/d/doc-12/edit",
  createdAt: "2026-05-20T00:00:00Z",
  lastSyncedAt: "2026-05-20T00:00:00Z",
  headSha: "head-1",
  latestSha: "head-1",
  isStale: false
};

describe("sidepanelQueryKeys", () => {
  it("scopes keys by repo, PR, doc, and head sha", () => {
    expect(sidepanelQueryKeys.ghComments(mapping)).toEqual([
      "pr",
      "org/repo",
      12,
      "gh-comments",
      "head-1"
    ]);
    expect(sidepanelQueryKeys.gdocComments(mapping.docId)).toEqual(["gdoc", "doc-12", "comments"]);
    expect(sidepanelQueryKeys.prFiles("org/repo", 12, "head-1")).toEqual([
      "pr",
      "org/repo",
      12,
      "files",
      "head-1"
    ]);
  });
});

describe("createSidepanelQueryClient", () => {
  it("uses 60s stale time for sidepanel response cache", () => {
    const client = createSidepanelQueryClient();
    expect(client.getDefaultOptions().queries?.staleTime).toBe(SIDEPANEL_QUERY_STALE_MS);
  });
});

describe("sidepanel cache storage snapshot", () => {
  it("persists and hydrates curated sidepanel data", async () => {
    const storage = createMemoryStorageArea();
    const client = createSidepanelQueryClient();

    const ghComments: GitHubReviewComment[] = [
      {
        id: 1,
        body: "Looks good",
        path: "README.md",
        line: 4,
        createdAt: "t",
        updatedAt: "t",
        user: "alice",
        htmlUrl: "https://github.com/org/repo/pull/12#discussion_r1"
      }
    ];
    const gdocComments: GoogleDocComment[] = [
      {
        id: "gdoc-1",
        content: "clarify",
        author: "Bob",
        createdAt: "t",
        updatedAt: "t",
        resolved: false
      }
    ];
    const commentMappings: CommentMapping[] = [
      { repo: "org/repo", prNumber: 12, ghCommentId: 1, docCommentId: "gdoc-1", source: "github" }
    ];
    const status: SyncStatus = {
      repo: "org/repo",
      prNumber: 12,
      state: "idle",
      updatedAt: "2026-05-20T00:00:00Z"
    };

    client.setQueryData(sidepanelQueryKeys.ghComments(mapping), ghComments);
    client.setQueryData(sidepanelQueryKeys.gdocComments(mapping.docId), gdocComments);
    client.setQueryData(sidepanelQueryKeys.commentMappings(mapping), commentMappings);
    client.setQueryData(sidepanelQueryKeys.status(mapping), status);

    await persistSidepanelCacheSnapshot(storage, client, mapping);

    const hydrated = createSidepanelQueryClient();
    await hydrateSidepanelCache(storage, hydrated, mapping);

    expect(hydrated.getQueryData(sidepanelQueryKeys.ghComments(mapping))).toEqual(ghComments);
    expect(hydrated.getQueryData(sidepanelQueryKeys.gdocComments(mapping.docId))).toEqual(
      gdocComments
    );
    expect(hydrated.getQueryData(sidepanelQueryKeys.commentMappings(mapping))).toEqual(
      commentMappings
    );
    expect(hydrated.getQueryData(sidepanelQueryKeys.status(mapping))).toEqual(status);
  });
});

import { describe, expect, it } from "vitest";

import type { CommentMapping } from "../apps/extension/lib/adapters/types.js";
import { createMemoryStorageArea } from "../apps/extension/lib/storage/memory.js";
import { createActivityStore } from "../apps/extension/lib/storage/stores.js";

describe("HUM-1279 activities storage", () => {
  it("appends synced events, returns current PR newest-first, and isolates other PRs", async () => {
    const store = createActivityStore(createMemoryStorageArea());

    await store.append({
      repo: "ahnpolished/dorv",
      prNumber: 42,
      direction: "github_to_gdoc",
      kind: "comment_synced",
      ghCommentId: 1001,
      docCommentId: "doc-comment-1",
      snippet: "First comment",
      createdAt: "2026-05-25T00:00:00Z"
    });
    await store.append({
      repo: "ahnpolished/dorv",
      prNumber: 7,
      direction: "gdoc_to_github",
      kind: "comment_synced",
      ghCommentId: 7001,
      docCommentId: "doc-comment-7",
      snippet: "Wrong PR",
      createdAt: "2026-05-25T00:02:00Z"
    });
    await store.append({
      repo: "ahnpolished/dorv",
      prNumber: 42,
      direction: "gdoc_to_github",
      kind: "comment_synced",
      ghCommentId: 1002,
      docCommentId: "doc-comment-2",
      path: "README.md",
      line: 12,
      snippet: "Second comment",
      createdAt: "2026-05-25T00:01:00Z"
    });

    await expect(store.listByPR("ahnpolished/dorv", 42)).resolves.toMatchObject([
      {
        repo: "ahnpolished/dorv",
        prNumber: 42,
        direction: "gdoc_to_github",
        ghCommentId: 1002,
        docCommentId: "doc-comment-2",
        path: "README.md",
        line: 12,
        snippet: "Second comment",
        createdAt: "2026-05-25T00:01:00Z"
      },
      {
        repo: "ahnpolished/dorv",
        prNumber: 42,
        direction: "github_to_gdoc",
        ghCommentId: 1001,
        docCommentId: "doc-comment-1",
        snippet: "First comment",
        createdAt: "2026-05-25T00:00:00Z"
      }
    ]);
  });

  it("retains at most 1000 events and drops the oldest entries first", async () => {
    const store = createActivityStore(createMemoryStorageArea());

    for (let index = 0; index < 1002; index += 1) {
      await store.append({
        repo: "ahnpolished/dorv",
        prNumber: 42,
        direction: "github_to_gdoc",
        kind: "comment_synced",
        ghCommentId: index,
        docCommentId: `doc-comment-${index.toString()}`,
        snippet: `comment ${index.toString()}`,
        createdAt: new Date(Date.UTC(2026, 4, 25, 0, 0, index)).toISOString()
      });
    }

    const all = await store.listAll();
    expect(all).toHaveLength(1000);
    expect(all.at(-1)).toMatchObject({ ghCommentId: 2, snippet: "comment 2" });
    expect(all[0]).toMatchObject({ ghCommentId: 1001, snippet: "comment 1001" });
  });

  it("bootstraps useful synced activities from existing comment mappings without duplicating them", async () => {
    const store = createActivityStore(createMemoryStorageArea());
    const mappings: CommentMapping[] = [
      {
        repo: "ahnpolished/dorv",
        prNumber: 42,
        ghCommentId: 1001,
        docCommentId: "doc-comment-1",
        source: "github"
      },
      {
        repo: "ahnpolished/dorv",
        prNumber: 42,
        ghCommentId: 1002,
        docCommentId: "doc-comment-2",
        source: "gdoc"
      }
    ];

    await store.bootstrapFromMappings("ahnpolished/dorv", 42, mappings, "2026-05-25T00:10:00Z");
    await store.bootstrapFromMappings("ahnpolished/dorv", 42, mappings, "2026-05-25T00:11:00Z");

    await expect(store.listByPR("ahnpolished/dorv", 42)).resolves.toMatchObject([
      {
        direction: "github_to_gdoc",
        kind: "comment_synced",
        ghCommentId: 1001,
        docCommentId: "doc-comment-1",
        createdAt: "2026-05-25T00:10:00Z",
        snippet: "GitHub comment 1001 synced to GDoc comment doc-comment-1"
      },
      {
        direction: "gdoc_to_github",
        kind: "comment_synced",
        ghCommentId: 1002,
        docCommentId: "doc-comment-2",
        createdAt: "2026-05-25T00:10:00Z",
        snippet: "GDoc comment doc-comment-2 synced to GitHub comment 1002"
      }
    ]);
  });
});

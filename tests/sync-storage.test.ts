import { describe, expect, it } from "vitest";

import { DirectAdapter } from "../apps/extension/lib/adapters/direct.js";
import { resolveAdapter } from "../apps/extension/lib/adapters/resolve.js";
import { createMemoryStorageArea } from "../apps/extension/lib/storage/memory.js";
import { createAuthStore } from "../apps/extension/lib/storage/auth.js";
import {
  createDocStore,
  createIdentityStore,
  createMappingStore,
  createReplyMappingStore,
  createStatusStore
} from "../apps/extension/lib/storage/stores.js";
import type {
  CommentMapping,
  DocMapping,
  ReplyMapping,
  SyncStatus
} from "../apps/extension/lib/adapters/types.js";

describe("HUM-1193 adapter resolution", () => {
  const storageArea = createMemoryStorageArea();
  const authStore = createAuthStore(storageArea);

  it("returns DirectAdapter when backendUrl is unset", () => {
    expect(resolveAdapter({ backendUrl: "", authStore, storageArea })).toBeInstanceOf(
      DirectAdapter
    );
    expect(resolveAdapter({ authStore, storageArea })).toBeInstanceOf(DirectAdapter);
  });

  it("rejects backend adapter resolution until backend scope exists", () => {
    expect(() =>
      resolveAdapter({ backendUrl: "https://dorv.example", authStore, storageArea })
    ).toThrow("BackendAdapter is out of scope for v0.1.0");
  });
});

describe("HUM-1193 typed storage stores", () => {
  it("stores doc mappings by repo and PR number", async () => {
    const store = createDocStore(createMemoryStorageArea());
    const mapping: DocMapping = {
      repo: "ahnpolished/dorv",
      prNumber: 42,
      docs: [
        {
          filename: "README.md",
          docId: "doc-123",
          docUrl: "https://docs.google.com/document/d/doc-123"
        }
      ],
      createdAt: "2026-05-16T15:00:00Z",
      lastSyncedAt: "2026-05-16T15:01:00Z",
      headSha: "abc1234",
      latestSha: "abc1234",
      isStale: false
    };

    await store.upsert(mapping);

    await expect(store.get("ahnpolished/dorv", 42)).resolves.toEqual(mapping);
    await expect(store.listActive()).resolves.toEqual([{ repo: "ahnpolished/dorv", prNumber: 42 }]);
  });

  it("indexes comment mappings in both directions for loop guards", async () => {
    const store = createMappingStore(createMemoryStorageArea());
    const mapping: CommentMapping = {
      repo: "ahnpolished/dorv",
      prNumber: 42,
      ghCommentId: 1001,
      docCommentId: "doc-comment-1",
      docId: "doc-123",
      source: "github"
    };

    await store.upsert(mapping);

    expect(await store.hasByGH(1001)).toBe(true);
    expect(await store.hasByDoc("doc-comment-1")).toBe(true);
    await expect(store.getByGH(1001)).resolves.toEqual(mapping);
    await expect(store.getByDoc("doc-comment-1")).resolves.toEqual(mapping);
  });

  it("stores reply mappings and sync status independently", async () => {
    const storage = createMemoryStorageArea();
    const replyStore = createReplyMappingStore(storage);
    const statusStore = createStatusStore(storage);
    const reply: ReplyMapping = {
      repo: "ahnpolished/dorv",
      prNumber: 42,
      ghReplyId: 2002,
      docReplyId: "doc-reply-2",
      ghParentCommentId: 1001,
      docParentCommentId: "doc-comment-1",
      docId: "doc-123",
      source: "gdoc"
    };
    const status: SyncStatus = {
      repo: "ahnpolished/dorv",
      prNumber: 42,
      state: "syncing",
      updatedAt: "2026-05-16T15:02:00Z"
    };

    await replyStore.upsert(reply);
    await statusStore.set(status);

    await expect(replyStore.getByGH(2002)).resolves.toEqual(reply);
    await expect(replyStore.getByDoc("doc-reply-2")).resolves.toEqual(reply);
    await expect(statusStore.get("ahnpolished/dorv", 42)).resolves.toEqual(status);
  });

  it("stores Google author to GitHub login mappings", async () => {
    const store = createIdentityStore(createMemoryStorageArea());

    await store.upsert({ googleAuthor: "Sangtae Ahn", githubLogin: "humphreyahn" });

    await expect(store.getByGoogleAuthor("Sangtae Ahn")).resolves.toEqual({
      googleAuthor: "Sangtae Ahn",
      githubLogin: "humphreyahn"
    });
  });
});

describe("HUM-1412 multi-doc upsert", () => {
  it("merges docs[] by filename — linking a second markdown file preserves the first", async () => {
    const store = createDocStore(createMemoryStorageArea());
    const repo = "ahnpolished/dorv";
    const prNumber = 42;

    // First doc: README.md
    const firstDoc: DocMapping = {
      repo,
      prNumber,
      docs: [
        {
          filename: "README.md",
          docId: "doc-readme-123",
          docUrl: "https://docs.google.com/document/d/doc-readme-123"
        }
      ],
      createdAt: "2026-05-16T15:00:00Z",
      lastSyncedAt: "2026-05-16T15:00:00Z",
      headSha: "abc1234",
      latestSha: "abc1234",
      isStale: false
    };
    await store.upsert(firstDoc);

    // Second doc: CONTRIBUTING.md (same PR)
    const secondDoc: DocMapping = {
      repo,
      prNumber,
      docs: [
        {
          filename: "CONTRIBUTING.md",
          docId: "doc-contrib-456",
          docUrl: "https://docs.google.com/document/d/doc-contrib-456"
        }
      ],
      createdAt: "2026-05-16T15:01:00Z",
      lastSyncedAt: "2026-05-16T15:01:00Z",
      headSha: "abc1234",
      latestSha: "abc1234",
      isStale: false
    };
    await store.upsert(secondDoc);

    const result = await store.get(repo, prNumber);
    expect(result).toBeDefined();
    if (!result) throw new Error("expected mapping");
    expect(result.docs).toHaveLength(2);
    expect(result.docs.find((d) => d.filename === "README.md")).toEqual({
      filename: "README.md",
      docId: "doc-readme-123",
      docUrl: "https://docs.google.com/document/d/doc-readme-123"
    });
    expect(result.docs.find((d) => d.filename === "CONTRIBUTING.md")).toEqual({
      filename: "CONTRIBUTING.md",
      docId: "doc-contrib-456",
      docUrl: "https://docs.google.com/document/d/doc-contrib-456"
    });
  });

  it("replaces existing doc when filename matches (idempotent re-create)", async () => {
    const store = createDocStore(createMemoryStorageArea());
    const repo = "ahnpolished/dorv";
    const prNumber = 42;

    const first: DocMapping = {
      repo,
      prNumber,
      docs: [
        {
          filename: "README.md",
          docId: "doc-readme-v1",
          docUrl: "https://docs.google.com/document/d/doc-readme-v1"
        }
      ],
      createdAt: "2026-05-16T15:00:00Z",
      lastSyncedAt: "2026-05-16T15:00:00Z",
      headSha: "abc1234",
      latestSha: "abc1234",
      isStale: false
    };
    await store.upsert(first);

    // Re-create same file with a new docId
    const updated: DocMapping = {
      repo,
      prNumber,
      docs: [
        {
          filename: "README.md",
          docId: "doc-readme-v2",
          docUrl: "https://docs.google.com/document/d/doc-readme-v2"
        }
      ],
      createdAt: "2026-05-16T15:05:00Z",
      lastSyncedAt: "2026-05-16T15:05:00Z",
      headSha: "abc1234",
      latestSha: "abc1234",
      isStale: false
    };
    await store.upsert(updated);

    const result = await store.get(repo, prNumber);
    expect(result).toBeDefined();
    if (!result) throw new Error("expected mapping");
    // Only one entry — the old one was replaced
    expect(result.docs).toHaveLength(1);
    expect(result.docs[0]).toEqual({
      filename: "README.md",
      docId: "doc-readme-v2",
      docUrl: "https://docs.google.com/document/d/doc-readme-v2"
    });
  });
});

import { describe, expect, it } from "vitest";

import { buildPrSidebarModel } from "../apps/extension/lib/github/pr-sidebar.js";
import type { MarkdownFileRef } from "../apps/extension/lib/adapters/types.js";
import type { PrSidebarInput } from "../apps/extension/lib/github/pr-sidebar.js";

const files: MarkdownFileRef[] = [
  {
    filename: "docs/rfc.md",
    rawUrl: "https://raw.githubusercontent.com/ahnpolished/dorv/docs/rfc.md",
    status: "modified"
  },
  {
    filename: "docs/new.md",
    previousFilename: "docs/old.md",
    rawUrl: "https://raw.githubusercontent.com/ahnpolished/dorv/docs/new.md",
    status: "renamed"
  }
];

function build(input: Partial<PrSidebarInput>) {
  return buildPrSidebarModel({
    files,
    status: {
      repo: "ahnpolished/dorv",
      prNumber: 42,
      state: "idle",
      updatedAt: "2026-05-16T15:30:00Z"
    },
    ...input
  });
}

describe("HUM-1200 PR sidebar model", () => {
  it("hides when there are no markdown files", () => {
    expect(build({ files: [] })).toEqual({ kind: "hidden" });
  });

  it("renders loading state", () => {
    expect(build({ mode: "loading" })).toEqual({
      kind: "loading",
      title: "dorv",
      message: "Checking markdown files..."
    });
  });

  it("renders no-doc state with file list and create button", () => {
    expect(build({ mode: "no-doc" })).toEqual({
      kind: "no-doc",
      title: "dorv",
      files,
      primaryActionLabel: "Create Google Doc (2 files)"
    });
  });

  it("renders linked doc state with sync metadata", () => {
    expect(
      build({
        mode: "linked",
        doc: {
          repo: "ahnpolished/dorv",
          prNumber: 42,
          docId: "doc-1",
          docUrl: "https://docs.google.com/document/d/doc-1",
          createdAt: "2026-05-16T15:00:00Z",
          lastSyncedAt: "2026-05-16T15:29:00Z",
          headSha: "abcdef123456",
          latestSha: "abcdef123456",
          isStale: false
        }
      })
    ).toEqual({
      kind: "linked",
      title: "dorv",
      docUrl: "https://docs.google.com/document/d/doc-1",
      lastSyncedLabel: "Last synced 2026-05-16T15:29:00Z",
      syncState: "idle",
      syncNowLabel: "Sync now"
    });
  });

  it("renders stale state with short SHA warning", () => {
    expect(
      build({
        mode: "stale",
        doc: {
          repo: "ahnpolished/dorv",
          prNumber: 42,
          docId: "doc-1",
          docUrl: "https://docs.google.com/document/d/doc-1",
          createdAt: "2026-05-16T15:00:00Z",
          lastSyncedAt: "2026-05-16T15:29:00Z",
          headSha: "abcdef123456",
          latestSha: "fedcba987654",
          isStale: true
        }
      })
    ).toMatchObject({
      kind: "stale",
      staleLabel: "PR changed: abcdef1 -> fedcba9"
    });
  });

  it("renders error state", () => {
    expect(build({ error: "GitHub API failed", mode: "error" })).toEqual({
      kind: "error",
      title: "dorv",
      message: "GitHub API failed"
    });
  });
});

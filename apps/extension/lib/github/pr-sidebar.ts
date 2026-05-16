import type { DocMapping, MarkdownFileRef, SyncStatus } from "../adapters/types.js";

export type PrSidebarMode = "loading" | "no-doc" | "linked" | "stale" | "error";

export interface PrSidebarInput {
  mode?: PrSidebarMode;
  files: MarkdownFileRef[];
  doc?: DocMapping;
  status?: SyncStatus;
  error?: string;
}

export type PrSidebarModel =
  | { kind: "hidden" }
  | { kind: "loading"; title: string; message: string }
  | {
      kind: "no-doc";
      title: string;
      files: MarkdownFileRef[];
      primaryActionLabel: string;
    }
  | {
      kind: "linked";
      title: string;
      docUrl: string;
      lastSyncedLabel: string;
      syncState: SyncStatus["state"];
      syncNowLabel: string;
    }
  | {
      kind: "stale";
      title: string;
      docUrl: string;
      staleLabel: string;
      lastSyncedLabel: string;
      syncNowLabel: string;
    }
  | { kind: "error"; title: string; message: string };

function createButtonLabel(fileCount: number): string {
  return `Create Google Doc (${fileCount.toString()} ${fileCount === 1 ? "file" : "files"})`;
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export function buildPrSidebarModel(input: PrSidebarInput): PrSidebarModel {
  if (input.files.length === 0) {
    return { kind: "hidden" };
  }

  if (input.mode === "loading") {
    return { kind: "loading", title: "dorv", message: "Checking markdown files..." };
  }

  if (input.mode === "error") {
    return { kind: "error", title: "dorv", message: input.error ?? "Something went wrong" };
  }

  if (input.doc !== undefined && input.mode === "stale") {
    return {
      kind: "stale",
      title: "dorv",
      docUrl: input.doc.docUrl,
      staleLabel: `PR changed: ${shortSha(input.doc.headSha)} -> ${shortSha(input.doc.latestSha)}`,
      lastSyncedLabel: `Last synced ${input.doc.lastSyncedAt}`,
      syncNowLabel: "Sync now"
    };
  }

  if (input.doc !== undefined && input.mode === "linked") {
    return {
      kind: "linked",
      title: "dorv",
      docUrl: input.doc.docUrl,
      lastSyncedLabel: `Last synced ${input.doc.lastSyncedAt}`,
      syncState: input.status?.state ?? "idle",
      syncNowLabel: "Sync now"
    };
  }

  return {
    kind: "no-doc",
    title: "dorv",
    files: input.files,
    primaryActionLabel: createButtonLabel(input.files.length)
  };
}

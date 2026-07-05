import { describe, expect, it, vi } from "vitest";
import {
  createDocViaBackground,
  fetchPrInfoViaBackground,
  openOptionsPageViaBackground,
  syncNowViaBackground
} from "../apps/extension/lib/adapters/messages.js";
import type { CreateDocInput, CreateDocResult } from "../apps/extension/lib/adapters/types.js";

interface CreateDocMessage {
  type: "CREATE_DOC";
  payload: CreateDocInput;
}

interface MessageResponse {
  success: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any;
  error?: string;
}

const input: CreateDocInput = {
  repo: "owner/repo",
  prNumber: 12,
  title: "Docs",
  author: "sangtae",
  branch: "feature/docs",
  headSha: "abc123",
  prUrl: "https://github.com/owner/repo/pull/12",
  files: [{ filename: "README.md", rawUrl: "https://raw.example/README.md", status: "modified" }]
};

describe("extension background messages", () => {
  it("requests manual sync through the background script", async () => {
    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn(
          (message: { type: "SYNC_NOW" }, callback: (response: MessageResponse) => void) => {
            callback({ success: true });
          }
        )
      }
    } as unknown as typeof chrome;

    await expect(syncNowViaBackground()).resolves.toBeUndefined();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: "SYNC_NOW" },
      expect.any(Function)
    );
  });

  it("requests Google Doc creation through the background script", async () => {
    const result: CreateDocResult = {
      mapping: {
        repo: input.repo,
        prNumber: input.prNumber,
        docs: [
          {
            filename: "README.md",
            docId: "doc-1",
            docUrl: "https://docs.google.com/document/d/doc-1/edit"
          }
        ],
        createdAt: "2026-05-16T00:00:00.000Z",
        lastSyncedAt: "2026-05-16T00:00:00.000Z",
        headSha: input.headSha,
        latestSha: input.headSha,
        isStale: false
      }
    };

    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn(
          (message: CreateDocMessage, callback: (response: MessageResponse) => void) => {
            callback({ success: true, payload: result });
          }
        )
      }
    } as unknown as typeof chrome;

    await expect(createDocViaBackground(input)).resolves.toEqual(result);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: "CREATE_DOC", payload: input },
      expect.any(Function)
    );
  });

  it("rejects with the background error when doc creation fails", async () => {
    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn(
          (message: CreateDocMessage, callback: (response: MessageResponse) => void) => {
            callback({ success: false, error: "Google account not connected." });
          }
        )
      }
    } as unknown as typeof chrome;

    await expect(createDocViaBackground(input)).rejects.toThrow("Google account not connected.");
  });

  it("requests opening the options page through the background script", async () => {
    // chrome.runtime.openOptionsPage() is not callable from a content script —
    // this must be proxied through a background message (regression coverage
    // for the QA-reported "openOptionsPage is not a function" crash).
    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn(
          (
            message: { type: "OPEN_OPTIONS_PAGE" },
            callback: (response: MessageResponse) => void
          ) => {
            callback({ success: true });
          }
        )
      }
    } as unknown as typeof chrome;

    await expect(openOptionsPageViaBackground()).resolves.toBeUndefined();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: "OPEN_OPTIONS_PAGE" },
      expect.any(Function)
    );
  });

  it("fetches PR file info through the background service worker", async () => {
    const mockPayload = {
      files: [{ filename: "README.md", rawUrl: "https://example.com/raw", status: "modified" }],
      meta: {
        title: "Test PR",
        author: "test",
        branch: "main",
        headSha: "abc123",
        prUrl: "https://github.com/a/b/pull/1"
      }
    };

    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn(
          (
            message: {
              type: "FETCH_PR_INFO";
              payload: { ref: { repo: string; prNumber: number } };
            },
            callback: (response: MessageResponse) => void
          ) => {
            callback({ success: true, payload: mockPayload });
          }
        )
      }
    } as unknown as typeof chrome;

    const result = await fetchPrInfoViaBackground({ repo: "a/b", prNumber: 1 });
    expect(result).toEqual(mockPayload);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: "FETCH_PR_INFO", payload: { ref: { repo: "a/b", prNumber: 1 } } },
      expect.any(Function)
    );
  });

  it("rejects when FETCH_PR_INFO returns an error from the background", async () => {
    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn(
          (
            message: {
              type: "FETCH_PR_INFO";
              payload: { ref: { repo: string; prNumber: number } };
            },
            callback: (response: MessageResponse) => void
          ) => {
            callback({ success: false, error: "Missing GitHub token" });
          }
        )
      }
    } as unknown as typeof chrome;

    await expect(fetchPrInfoViaBackground({ repo: "a/b", prNumber: 1 })).rejects.toThrow(
      "Missing GitHub token"
    );
  });

  it("HUM-1409: rejects bare repo names (must be owner/name format)", async () => {
    // Regression: handleCreate() in github-buttons originally passed a
    // raw { owner, repo, prNumber } object, discarding the already-computed
    // "owner/repo" string. The background handler splits on "/" and throws
    // "Invalid repo format" for bare names like "dorv".
    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn(
          (
            message: {
              type: "FETCH_PR_INFO";
              payload: { ref: { repo: string; prNumber: number } };
            },
            callback: (response: MessageResponse) => void
          ) => {
            // Simulate background handler validation — bare repo name fails
            const passedRepo = message.payload.ref.repo;
            const parts = passedRepo.split("/");
            if (parts.length !== 2 || !parts[0] || !parts[1]) {
              callback({
                success: false,
                error: `Invalid repo format: ${passedRepo}`
              });
            } else {
              callback({ success: true, payload: {} });
            }
          }
        )
      }
    } as unknown as typeof chrome;

    // Bare repo name (the original bug: handleCreate passed just "dorv")
    await expect(fetchPrInfoViaBackground({ repo: "dorv", prNumber: 1 })).rejects.toThrow(
      "Invalid repo format: dorv"
    );

    // Valid owner/name format should succeed
    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn((_message: unknown, callback: (response: MessageResponse) => void) => {
          callback({ success: true, payload: { files: [], meta: {} } });
        })
      }
    } as unknown as typeof chrome;

    await expect(
      fetchPrInfoViaBackground({ repo: "ahnpolished/dorv", prNumber: 1 })
    ).resolves.toBeDefined();
  });
});

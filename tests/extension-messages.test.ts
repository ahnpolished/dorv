import { describe, expect, it, vi } from "vitest";
import { createDocViaBackground } from "../apps/extension/lib/adapters/messages.js";
import type { CreateDocInput, CreateDocResult } from "../apps/extension/lib/adapters/types.js";

interface CreateDocMessage {
  type: "CREATE_DOC";
  payload: CreateDocInput;
}

interface CreateDocResponse {
  success: boolean;
  payload?: CreateDocResult;
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
  it("requests Google Doc creation through the background script", async () => {
    const result: CreateDocResult = {
      mapping: {
        repo: input.repo,
        prNumber: input.prNumber,
        docId: "doc-1",
        docUrl: "https://docs.google.com/document/d/doc-1/edit",
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
          (message: CreateDocMessage, callback: (response: CreateDocResponse) => void) => {
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
          (message: CreateDocMessage, callback: (response: CreateDocResponse) => void) => {
            callback({ success: false, error: "Google account not connected." });
          }
        )
      }
    } as unknown as typeof chrome;

    await expect(createDocViaBackground(input)).rejects.toThrow("Google account not connected.");
  });
});

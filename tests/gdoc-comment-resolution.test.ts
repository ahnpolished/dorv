import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveGDocComment } from "../apps/extension/lib/gdoc/comments.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("resolveGDocComment", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("resolves a comment by posting a resolve reply", async () => {
    const calls: { url: string; method: string; body?: unknown }[] = [];
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({
        url,
        method,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined
      });

      if (method === "POST") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ id: "reply-1", comment: { id: "comment-1", resolved: true } })
        });
      }

      throw new Error(`Unexpected method: ${method}`);
    });

    await resolveGDocComment("g-token", "doc-1", "comment-1");

    expect(calls).toEqual([
      {
        url: "https://www.googleapis.com/drive/v3/files/doc-1/comments/comment-1/replies?fields=id,comment",
        method: "POST",
        body: { action: "resolve", content: "Resolved in GitHub." }
      }
    ]);
  });
});

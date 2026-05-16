import { describe, expect, it, vi } from "vitest";
import { fetchPullRequestFiles } from "../apps/extension/lib/github/pr-files.js";
import type { GitHubFileClientOptions } from "../apps/extension/lib/github/pr-files.js";

describe("fetchPullRequestFiles", () => {
  it("should fail if fetch loses its context (simulating window.fetch)", async () => {
    const context = { name: "window" };
    const mockFetch = vi.fn().mockImplementation(function (this: unknown) {
      if (this !== context) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([])
      } as Response);
    });

    const ref = { owner: "own", repo: "rep", prNumber: 1 };
    const options: GitHubFileClientOptions = {
      fetch: mockFetch
    };

    // This reproduces the bug: calling options.fetch() sets 'this' to 'options'
    await expect(fetchPullRequestFiles(ref, options)).rejects.toThrow(
      "Failed to execute 'fetch' on 'Window': Illegal invocation"
    );
  });

  it("should succeed if fetch is bound to its context", async () => {
    const context = { name: "window" };
    const mockFetch = vi.fn().mockImplementation(function (this: unknown) {
      if (this !== context) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([])
      } as Response);
    });

    const ref = { owner: "own", repo: "rep", prNumber: 1 };
    const options: GitHubFileClientOptions = {
      fetch: mockFetch.bind(context)
    };

    await expect(fetchPullRequestFiles(ref, options)).resolves.toEqual([]);
  });
});

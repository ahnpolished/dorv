import { describe, expect, it, vi } from "vitest";
import { fetchPullRequestMeta } from "../apps/extension/lib/github/fetch.js";

const ref = { owner: "owner", repo: "repo", prNumber: 42 };

const apiResponse = {
  title: "Fix the thing",
  user: { login: "dev" },
  head: { ref: "feature/fix", sha: "abc123" },
  html_url: "https://github.com/owner/repo/pull/42"
};

describe("fetchPullRequestMeta", () => {
  it("maps GitHub PR API response to PullRequestMeta", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(apiResponse)
    });

    const result = await fetchPullRequestMeta(ref, { fetch: mockFetch });

    expect(result).toEqual({
      title: "Fix the thing",
      author: "dev",
      branch: "feature/fix",
      headSha: "abc123",
      prUrl: "https://github.com/owner/repo/pull/42"
    });
  });

  it("throws on non-ok response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404
    });

    await expect(fetchPullRequestMeta(ref, { fetch: mockFetch })).rejects.toThrow(
      "Failed to fetch PR meta: 404"
    );
  });
});

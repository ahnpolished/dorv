/* eslint-disable */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchReviewThreads } from "../apps/extension/lib/github/fetch.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("fetchReviewThreads", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("normalizes a RIGHT-side GraphQL review thread into root comment + replies", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("/graphql")) {
        return {
          ok: true,
          json: async () => ({
            data: {
              repository: {
                pullRequest: {
                  reviewThreads: {
                    nodes: [
                      {
                        id: "thread-node-1",
                        isResolved: false,
                        path: "docs/rfc.md",
                        line: 42,
                        diffSide: "RIGHT",
                        comments: {
                          nodes: [
                            {
                              databaseId: 101,
                              body: "Please tighten this paragraph.",
                              path: "docs/rfc.md",
                              line: 42,
                              diffHunk:
                                "@@ -40,3 +40,3 @@\n context\n unchanged\n+target paragraph",
                              createdAt: "2026-05-25T00:00:00Z",
                              updatedAt: "2026-05-25T00:00:00Z",
                              url: "https://github.com/org/repo/pull/123#discussion_r101",
                              author: { login: "alice" },
                              replyTo: null
                            },
                            {
                              databaseId: 102,
                              body: "Agreed.",
                              path: "docs/rfc.md",
                              line: 42,
                              diffHunk: null,
                              createdAt: "2026-05-25T00:01:00Z",
                              updatedAt: "2026-05-25T00:01:00Z",
                              url: "https://github.com/org/repo/pull/123#discussion_r102",
                              author: { login: "bob" },
                              replyTo: { databaseId: 101 }
                            }
                          ]
                        }
                      }
                    ],
                    pageInfo: {
                      hasNextPage: false,
                      endCursor: null
                    }
                  }
                }
              }
            }
          })
        };
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const threads = await fetchReviewThreads("gh-token", "org/repo", 123);

    expect(threads).toEqual([
      {
        id: "thread-node-1",
        path: "docs/rfc.md",
        line: 42,
        side: "RIGHT",
        diffHunk: "@@ -40,3 +40,3 @@\n context\n unchanged\n+target paragraph",
        quotedLine: "target paragraph",
        isResolved: false,
        rootComment: {
          id: 101,
          body: "Please tighten this paragraph.",
          path: "docs/rfc.md",
          line: 42,
          side: "RIGHT",
          diffHunk: "@@ -40,3 +40,3 @@\n context\n unchanged\n+target paragraph",
          inReplyToId: undefined,
          createdAt: "2026-05-25T00:00:00Z",
          updatedAt: "2026-05-25T00:00:00Z",
          user: "alice",
          htmlUrl: "https://github.com/org/repo/pull/123#discussion_r101"
        },
        replies: [
          {
            id: 102,
            body: "Agreed.",
            path: "docs/rfc.md",
            line: 42,
            side: "RIGHT",
            diffHunk: undefined,
            inReplyToId: 101,
            createdAt: "2026-05-25T00:01:00Z",
            updatedAt: "2026-05-25T00:01:00Z",
            user: "bob",
            htmlUrl: "https://github.com/org/repo/pull/123#discussion_r102"
          }
        ]
      }
    ]);
  });

  it("skips LEFT-side GraphQL review threads", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("/graphql")) {
        return {
          ok: true,
          json: async () => ({
            data: {
              repository: {
                pullRequest: {
                  reviewThreads: {
                    nodes: [
                      {
                        id: "thread-node-left",
                        isResolved: false,
                        path: "docs/rfc.md",
                        line: 9,
                        diffSide: "LEFT",
                        comments: {
                          nodes: [
                            {
                              databaseId: 201,
                              body: "This was removed.",
                              path: "docs/rfc.md",
                              line: 9,
                              diffHunk: "@@ -9,1 +0,0 @@\n-deleted line",
                              createdAt: "2026-05-25T00:00:00Z",
                              updatedAt: "2026-05-25T00:00:00Z",
                              url: "https://github.com/org/repo/pull/123#discussion_r201",
                              author: { login: "alice" },
                              replyTo: null
                            }
                          ]
                        }
                      }
                    ],
                    pageInfo: {
                      hasNextPage: false,
                      endCursor: null
                    }
                  }
                }
              }
            }
          })
        };
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(fetchReviewThreads("gh-token", "org/repo", 123)).resolves.toEqual([]);
  });

  it("falls back to REST normalization when GraphQL is unavailable", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("/graphql")) {
        return {
          ok: false,
          status: 500,
          text: async () => "boom"
        };
      }

      if (url.includes("/pulls/123/comments")) {
        return {
          ok: true,
          json: async () => [
            {
              id: 301,
              body: "root",
              path: "README.md",
              line: 7,
              side: "RIGHT",
              diff_hunk: "@@ -7,1 +7,1 @@\n+line 7",
              in_reply_to_id: null,
              user: { login: "alice" },
              html_url: "https://github.com/org/repo/pull/123#discussion_r301",
              created_at: "t1",
              updated_at: "t1"
            },
            {
              id: 302,
              body: "reply",
              path: "README.md",
              line: 7,
              side: "RIGHT",
              diff_hunk: null,
              in_reply_to_id: 301,
              user: { login: "bob" },
              html_url: "https://github.com/org/repo/pull/123#discussion_r302",
              created_at: "t2",
              updated_at: "t2"
            }
          ]
        };
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const threads = await fetchReviewThreads("gh-token", "org/repo", 123);

    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({
      id: "rest-301",
      path: "README.md",
      line: 7,
      side: "RIGHT",
      quotedLine: "line 7",
      rootComment: { id: 301 },
      replies: [{ id: 302, inReplyToId: 301 }]
    });
  });

  it("does not fall back to REST when GraphQL is rate limited", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("/graphql")) {
        return {
          ok: false,
          status: 403,
          text: async () => "API rate limit exceeded"
        };
      }

      throw new Error(`REST fallback should not run for rate limits: ${url}`);
    });

    await expect(fetchReviewThreads("gh-token", "org/repo", 123)).rejects.toThrow(/rate limit/i);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

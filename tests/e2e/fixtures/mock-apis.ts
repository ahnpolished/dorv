import type { BrowserContext, Route } from "@playwright/test";
import { TEST_PR } from "./extension.js";

/** Minimal fake GitHub PR page with the sidebar anchor the content script expects */
export function fakePrHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Test PR #${TEST_PR.prNumber.toString()} · ${TEST_PR.ref}</title></head>
<body>
  <div class="Layout-sidebar">
    <div id="partial-discussion-sidebar"></div>
  </div>
</body>
</html>`;
}

export const FAKE_MD_FILES = [
  {
    filename: "docs/rfc.md",
    status: "modified",
    raw_url: `https://raw.githubusercontent.com/${TEST_PR.ref}/main/docs/rfc.md`
  }
];

export const FAKE_NON_MD_FILES = [
  {
    filename: "src/index.ts",
    status: "modified",
    raw_url: `https://raw.githubusercontent.com/${TEST_PR.ref}/main/src/index.ts`
  }
];

export const FAKE_PR_META = {
  title: "Test PR",
  user: { login: "author" },
  head: { ref: "feature/test", sha: "abc123def456" },
  html_url: TEST_PR.url
};

export const FAKE_GH_REVIEW_COMMENTS = [
  {
    id: 1001,
    body: "Looks good, but consider caching.",
    path: "docs/rfc.md",
    line: 10,
    side: "RIGHT",
    in_reply_to_id: null,
    created_at: "2026-05-17T12:00:00Z",
    updated_at: "2026-05-17T12:00:00Z",
    user: { login: "reviewer" },
    html_url: `${TEST_PR.url}#review-1001`
  }
];

export const FAKE_GDOC_COMMENTS = {
  comments: [
    {
      id: "doc-comment-101",
      content: "Needs clarification on section 2.",
      quotedFileContent: { value: "some quoted text" },
      author: { displayName: "DocReviewer" },
      createdTime: "2026-05-17T13:00:00Z",
      replies: []
    }
  ]
};

/**
 * Build a minimal GraphQL reviewThreads response matching the shape expected by
 * `fetchReviewThreads` in the extension (data.repository.pullRequest.reviewThreads).
 */
export function fakeGraphQLThreads(
  threads: {
    id: string;
    isResolved: boolean;
    path: string;
    line: number;
    diffSide?: "LEFT" | "RIGHT";
    comments: {
      databaseId: number;
      body: string;
      path: string;
      line: number;
      diffHunk?: string;
      createdAt: string;
      updatedAt: string;
      url: string;
      authorLogin: string;
      replyToDatabaseId?: number | null;
    }[];
  }[]
): object {
  return {
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: threads.map((t) => ({
              id: t.id,
              isResolved: t.isResolved,
              path: t.path,
              line: t.line,
              diffSide: t.diffSide ?? "RIGHT",
              comments: {
                nodes: t.comments.map((c) => ({
                  databaseId: c.databaseId,
                  body: c.body,
                  path: c.path,
                  line: c.line,
                  diffHunk: c.diffHunk ?? null,
                  createdAt: c.createdAt,
                  updatedAt: c.updatedAt,
                  url: c.url,
                  author: { login: c.authorLogin },
                  replyTo: c.replyToDatabaseId != null ? { databaseId: c.replyToDatabaseId } : null
                }))
              }
            })),
            pageInfo: { hasNextPage: false, endCursor: null }
          }
        }
      }
    }
  };
}

/** Single unresolved thread with one root comment and no diffHunk */
export const FAKE_THREAD_SIMPLE = fakeGraphQLThreads([
  {
    id: "thread-001",
    isResolved: false,
    path: "docs/rfc.md",
    line: 10,
    comments: [
      {
        databaseId: 1001,
        body: "Looks good, but consider caching.",
        path: "docs/rfc.md",
        line: 10,
        createdAt: "2026-05-17T12:00:00Z",
        updatedAt: "2026-05-17T12:00:00Z",
        url: `${TEST_PR.url}#review-1001`,
        authorLogin: "reviewer"
      }
    ]
  }
]);

/** Thread with a root comment and one reply */
export const FAKE_THREAD_WITH_REPLY = fakeGraphQLThreads([
  {
    id: "thread-001",
    isResolved: false,
    path: "docs/rfc.md",
    line: 10,
    comments: [
      {
        databaseId: 1001,
        body: "Looks good, but consider caching.",
        path: "docs/rfc.md",
        line: 10,
        createdAt: "2026-05-17T12:00:00Z",
        updatedAt: "2026-05-17T12:00:00Z",
        url: `${TEST_PR.url}#review-1001`,
        authorLogin: "reviewer"
      },
      {
        databaseId: 1002,
        body: "Will add caching in the next commit.",
        path: "docs/rfc.md",
        line: 10,
        createdAt: "2026-05-17T12:30:00Z",
        updatedAt: "2026-05-17T12:30:00Z",
        url: `${TEST_PR.url}#review-1002`,
        authorLogin: "author",
        replyToDatabaseId: 1001
      }
    ]
  }
]);

/** Thread with a diffHunk so the anchor carries line metadata */
export const FAKE_THREAD_WITH_DIFFHUNK = fakeGraphQLThreads([
  {
    id: "thread-002",
    isResolved: false,
    path: "docs/rfc.md",
    line: 5,
    comments: [
      {
        databaseId: 2001,
        body: "This code block needs a comment.",
        path: "docs/rfc.md",
        line: 5,
        diffHunk:
          "@@ -1,4 +1,10 @@\n # RFC\n \n ## Section 2\n \n+```typescript\n+const x = 1;\n+```",
        createdAt: "2026-05-17T12:00:00Z",
        updatedAt: "2026-05-17T12:00:00Z",
        url: `${TEST_PR.url}#review-2001`,
        authorLogin: "reviewer"
      }
    ]
  }
]);

/** Resolved thread */
export const FAKE_THREAD_RESOLVED = fakeGraphQLThreads([
  {
    id: "thread-003",
    isResolved: true,
    path: "docs/rfc.md",
    line: 10,
    comments: [
      {
        databaseId: 3001,
        body: "Fixed.",
        path: "docs/rfc.md",
        line: 10,
        createdAt: "2026-05-17T12:00:00Z",
        updatedAt: "2026-05-17T12:00:00Z",
        url: `${TEST_PR.url}#review-3001`,
        authorLogin: "reviewer"
      }
    ]
  }
]);

export interface SetupPageRoutesOptions {
  /** Files returned for the PR files endpoint (defaults to MD files) */
  files?: unknown[];
  /** GDoc comments returned for the Drive comments endpoint */
  gdocComments?: unknown;
  /** GH review comments returned for the pulls comments endpoint (REST fallback) */
  ghReviewComments?: unknown[];
  /** Response body for Drive upload (POST) */
  driveUploadResponse?: unknown;
  /** GraphQL reviewThreads response body; overrides default empty-threads response */
  graphqlThreads?: unknown;
}

/**
 * Set up context.route() interceptors for all API calls made by both the
 * content script (page fetch) and the service worker (SW fetch).
 *
 * Playwright v1.36+ intercepts service worker fetch via context.route().
 */
export async function setupPageRoutes(
  context: BrowserContext,
  opts: SetupPageRoutesOptions = {}
): Promise<void> {
  const {
    files = FAKE_MD_FILES,
    gdocComments = FAKE_GDOC_COMMENTS,
    ghReviewComments = FAKE_GH_REVIEW_COMMENTS,
    driveUploadResponse = {
      id: "fake-doc-id-123",
      webViewLink: "https://docs.google.com/document/d/fake-doc-id-123/edit"
    },
    graphqlThreads
  } = opts;

  const { owner, repo, prNumber } = TEST_PR;

  // Fake GitHub PR page HTML (matched by URL so the content script runs)
  await context.route(
    `https://github.com/${owner}/${repo}/pull/${prNumber.toString()}`,
    (route: Route) => {
      void route.fulfill({ status: 200, contentType: "text/html", body: fakePrHtml() });
    }
  );

  // PR files list (content script + service worker)
  await context.route(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber.toString()}/files*`,
    (route: Route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(files)
      });
    }
  );

  // PR metadata (content script during doc creation)
  await context.route(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber.toString()}`,
    (route: Route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FAKE_PR_META)
      });
    }
  );

  // GitHub GraphQL — fetchReviewThreads tries this first before falling back to REST.
  // When no graphqlThreads fixture is provided, return 500 so the extension falls back
  // to the REST pulls/comments endpoint (preserves pre-existing mock-only tests).
  await context.route("https://api.github.com/graphql", (route: Route) => {
    if (graphqlThreads !== undefined) {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(graphqlThreads)
      });
    } else {
      void route.fulfill({ status: 500, body: "GraphQL not mocked" });
    }
  });

  // PR review comments (GET: sync read; POST: reply push via createReviewCommentReply)
  // Note: createReviewCommentReply posts to pulls/{prNumber}/comments with in_reply_to field
  await context.route(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber.toString()}/comments*`,
    (route: Route) => {
      if (route.request().method() === "POST") {
        void route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ id: 3001 })
        });
      } else {
        void route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(ghReviewComments)
        });
      }
    }
  );

  // Issue comments — bot comment (service worker during doc creation)
  await context.route(
    `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber.toString()}/comments*`,
    (route: Route) => {
      void route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ id: 9001 })
      });
    }
  );

  // PAT validation (options page)
  await context.route("https://api.github.com/user", (route: Route) => {
    void route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ login: "test-user" })
    });
  });

  // Raw file content (service worker during doc creation)
  await context.route("https://raw.githubusercontent.com/**", (route: Route) => {
    void route.fulfill({
      status: 200,
      contentType: "text/plain",
      body: "# RFC\n\nThis is a test markdown file.\n\n## Section 2\n\nContent here."
    });
  });

  // Drive upload — create Google Doc (service worker during doc creation)
  await context.route("https://www.googleapis.com/upload/drive/v3/files*", (route: Route) => {
    void route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(driveUploadResponse)
    });
  });

  // Drive permissions — set anyone-with-link commenter access (service worker during doc creation)
  await context.route(
    "https://www.googleapis.com/drive/v3/files/*/permissions*",
    (route: Route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: "perm-1" })
      });
    }
  );

  // Drive comments — GET list + POST new comment (service worker during sync)
  await context.route("https://www.googleapis.com/drive/v3/files/*/comments*", (route: Route) => {
    if (route.request().method() === "POST") {
      // POST new comment or reply
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: "doc-comment-new-1" })
      });
    } else {
      // GET comments list
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(gdocComments)
      });
    }
  });
}

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

export interface SetupPageRoutesOptions {
  /** Files returned for the PR files endpoint (defaults to MD files) */
  files?: unknown[];
  /** GDoc comments returned for the Drive comments endpoint */
  gdocComments?: unknown;
  /** GH review comments returned for the pulls comments endpoint */
  ghReviewComments?: unknown[];
  /** Response body for Drive upload (POST) */
  driveUploadResponse?: unknown;
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
    }
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

  // Remove the placeholder — createReviewCommentReply uses pulls/{prNumber}/comments POST (covered above)

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

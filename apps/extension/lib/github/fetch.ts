/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { GitHubReviewComment, GitHubReviewThread } from "../adapters/types.js";
import type { GitHubFileClientOptions, GitHubPullRequestRef } from "./pr-files.js";

export interface PullRequestMeta {
  title: string;
  author: string;
  branch: string;
  headSha: string;
  prUrl: string;
}

const REVIEW_THREADS_QUERY = `
  query ReviewThreads($owner: String!, $name: String!, $prNumber: Int!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $prNumber) {
        reviewThreads(first: 100, after: $cursor) {
          nodes {
            id
            isResolved
            path
            line
            diffSide
            comments(first: 100) {
              nodes {
                databaseId
                body
                path
                line
                diffHunk
                createdAt
                updatedAt
                url
                author {
                  login
                }
                replyTo {
                  databaseId
                }
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`;

export async function fetchPullRequestMeta(
  ref: GitHubPullRequestRef,
  options: GitHubFileClientOptions
): Promise<PullRequestMeta> {
  const resp = await options.fetch(
    `https://api.github.com/repos/${ref.owner}/${ref.repo}/pulls/${ref.prNumber.toString()}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
      }
    }
  );
  if (!resp.ok) {
    throw new Error(`Failed to fetch PR meta: ${resp.status.toString()}`);
  }
  const data = (await resp.json()) as Record<string, any>;
  return {
    title: data.title,
    author: data.user.login,
    branch: data.head.ref,
    headSha: data.head.sha,
    prUrl: data.html_url
  };
}

export async function fetchReviewComments(
  token: string,
  repo: string,
  prNumber: number
): Promise<GitHubReviewComment[]> {
  const { owner, name } = parseRepo(repo);
  const base = `https://api.github.com/repos/${owner}/${name}/pulls/${prNumber.toString()}/comments?per_page=100`;
  const all: any[] = [];
  let page = 1;

  for (;;) {
    const resp = await fetch(`${base}&page=${page.toString()}`, {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json"
      }
    });

    if (!resp.ok) {
      throw new Error(`GitHub fetch failed: ${resp.status.toString()} ${await resp.text()}`);
    }

    const data = await resp.json();
    if (!Array.isArray(data)) break;
    for (const c of data) all.push(c);
    if (data.length < 100) break;
    // GitHub signals more pages via Link header; no header means this is the last page
    const link: string =
      (resp.headers as { get?(k: string): string | null } | undefined)?.get?.("link") ?? "";
    if (!link.includes('rel="next"')) break;
    page++;
  }

  return all.map(normalizeRestComment);
}

export async function fetchReviewThreads(
  token: string,
  repo: string,
  prNumber: number
): Promise<GitHubReviewThread[]> {
  const { owner, name } = parseRepo(repo);

  try {
    const threads: GitHubReviewThread[] = [];
    let cursor: string | null = null;

    for (;;) {
      const resp = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          query: REVIEW_THREADS_QUERY,
          variables: {
            owner,
            name,
            prNumber,
            cursor
          }
        })
      });

      if (!resp.ok) {
        throw new Error(
          `GitHub GraphQL fetch failed: ${resp.status.toString()} ${await resp.text()}`
        );
      }

      const payload = await resp.json();
      const connection = payload?.data?.repository?.pullRequest?.reviewThreads;
      if (!connection || !Array.isArray(connection.nodes) || !connection.pageInfo) {
        throw new Error("GitHub GraphQL reviewThreads response missing expected shape");
      }

      for (const node of connection.nodes as any[]) {
        const normalized = normalizeGraphQLThread(node);
        if (normalized) {
          threads.push(normalized);
        }
      }

      if (!connection.pageInfo.hasNextPage) {
        break;
      }

      cursor = connection.pageInfo.endCursor as string | null;
      if (!cursor) {
        break;
      }
    }

    return threads;
  } catch (error) {
    if (isGitHubRateLimitError(error)) {
      throw error;
    }

    const comments = await fetchReviewComments(token, repo, prNumber);
    return normalizeRestThreads(comments);
  }
}

function isGitHubRateLimitError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("rate limit") ||
    message.includes("secondary rate limit") ||
    message.includes("abuse detection")
  );
}

function parseRepo(repo: string): { owner: string; name: string } {
  const parts = repo.split("/");
  const owner = parts[0];
  const name = parts[1];

  if (!owner || !name) {
    throw new Error(`Invalid repo format: ${repo}`);
  }

  return { owner, name };
}

function normalizeRestComment(comment: any): GitHubReviewComment {
  return {
    id: comment.id,
    body: comment.body,
    path: comment.path,
    line: comment.line,
    side: comment.side,
    diffHunk: comment.diff_hunk,
    inReplyToId: comment.in_reply_to_id,
    createdAt: comment.created_at,
    updatedAt: comment.updated_at,
    user: comment.user.login,
    htmlUrl: comment.html_url
  };
}

function normalizeGraphQLThread(node: any): GitHubReviewThread | undefined {
  if (node?.diffSide !== "RIGHT") {
    return undefined;
  }

  if (typeof node.path !== "string") {
    return undefined;
  }

  const commentNodes = Array.isArray(node.comments?.nodes) ? (node.comments.nodes as any[]) : [];
  const comments: GitHubReviewComment[] = commentNodes
    .map(normalizeGraphQLComment)
    .filter(
      (comment: GitHubReviewComment | undefined): comment is GitHubReviewComment =>
        comment !== undefined
    );

  const rootComment = comments.find(
    (comment: GitHubReviewComment): boolean => comment.inReplyToId == null
  );
  if (!rootComment) {
    return undefined;
  }

  const replies = comments.filter(
    (comment: GitHubReviewComment): boolean => comment.inReplyToId != null
  );
  const line = typeof node.line === "number" ? node.line : rootComment.line;
  if (typeof line !== "number") {
    return undefined;
  }
  const quotedLine = buildQuotedLine(rootComment.diffHunk, line);

  return buildReviewThread({
    id: String(node.id),
    path: node.path,
    line,
    diffHunk: rootComment.diffHunk,
    quotedLine,
    isResolved: Boolean(node.isResolved),
    rootComment,
    replies
  });
}

function normalizeGraphQLComment(node: any): GitHubReviewComment | undefined {
  if (typeof node?.databaseId !== "number") {
    return undefined;
  }

  const comment: GitHubReviewComment = {
    id: node.databaseId,
    body: typeof node.body === "string" ? node.body : "",
    path: typeof node.path === "string" ? node.path : "",
    createdAt: typeof node.createdAt === "string" ? node.createdAt : "",
    updatedAt: typeof node.updatedAt === "string" ? node.updatedAt : "",
    user: typeof node.author?.login === "string" ? node.author.login : "ghost",
    htmlUrl: typeof node.url === "string" ? node.url : ""
  };

  if (typeof node.line === "number") {
    comment.line = node.line;
  }
  comment.side = "RIGHT";
  if (typeof node.diffHunk === "string") {
    comment.diffHunk = node.diffHunk;
  }
  if (typeof node.replyTo?.databaseId === "number") {
    comment.inReplyToId = node.replyTo.databaseId;
  }

  return comment;
}

function normalizeRestThreads(comments: GitHubReviewComment[]): GitHubReviewThread[] {
  const rootComments = comments.filter(
    (comment): comment is GitHubReviewComment & { line: number } =>
      comment.inReplyToId == null && (comment.side ?? "RIGHT") === "RIGHT" && comment.line != null
  );

  return rootComments.map((rootComment) =>
    buildReviewThread({
      id: `rest-${rootComment.id.toString()}`,
      path: rootComment.path,
      line: rootComment.line,
      diffHunk: rootComment.diffHunk,
      quotedLine: buildQuotedLine(rootComment.diffHunk, rootComment.line),
      isResolved: false,
      rootComment,
      replies: comments.filter((comment) => comment.inReplyToId === rootComment.id)
    })
  );
}

function buildReviewThread(input: {
  id: string;
  path: string;
  line: number;
  diffHunk: string | undefined;
  quotedLine: string | undefined;
  isResolved: boolean;
  rootComment: GitHubReviewComment;
  replies: GitHubReviewComment[];
}): GitHubReviewThread {
  return {
    id: input.id,
    path: input.path,
    line: input.line,
    side: "RIGHT",
    isResolved: input.isResolved,
    rootComment: input.rootComment,
    replies: input.replies,
    ...(input.diffHunk ? { diffHunk: input.diffHunk } : {}),
    ...(input.quotedLine ? { quotedLine: input.quotedLine } : {})
  };
}

function buildQuotedLine(
  diffHunk: string | undefined,
  line: number | undefined
): string | undefined {
  if (!diffHunk || line == null) {
    return undefined;
  }

  return findQuotedLine({ diffHunk, line, side: "RIGHT" });
}

function findQuotedLine(context: {
  diffHunk?: string;
  line?: number;
  side?: "LEFT" | "RIGHT";
}): string | undefined {
  if (!context.diffHunk || context.line == null) return undefined;

  const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(context.diffHunk);
  if (!header) return undefined;

  let oldLine = Number(header[1]);
  let newLine = Number(header[2]);
  const side = context.side ?? "RIGHT";

  for (const line of context.diffHunk.split("\n").slice(1)) {
    if (line.startsWith("\\ No newline")) continue;
    const marker = line[0];
    const text = line.slice(1);

    if (marker === " ") {
      if (context.line === (side === "LEFT" ? oldLine : newLine)) return text;
      oldLine++;
      newLine++;
      continue;
    }

    if (marker === "-") {
      if (side === "LEFT" && context.line === oldLine) return text;
      oldLine++;
      continue;
    }

    if (marker === "+") {
      if (side === "RIGHT" && context.line === newLine) return text;
      newLine++;
    }
  }

  return undefined;
}

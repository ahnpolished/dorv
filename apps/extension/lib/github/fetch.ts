/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { GitHubReviewComment } from "../adapters/types.js";
import type { GitHubFileClientOptions, GitHubPullRequestRef } from "./pr-files.js";

export interface PullRequestMeta {
  title: string;
  author: string;
  branch: string;
  headSha: string;
  prUrl: string;
}

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
  const parts = repo.split("/");
  const owner = parts[0];
  const name = parts[1];

  if (!owner || !name) {
    throw new Error(`Invalid repo format: ${repo}`);
  }

  const url = `https://api.github.com/repos/${owner}/${name}/pulls/${prNumber.toString()}/comments`;

  const resp = await fetch(url, {
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json"
    }
  });

  if (!resp.ok) {
    throw new Error(`GitHub fetch failed: ${resp.status.toString()} ${await resp.text()}`);
  }

  const data = (await resp.json()) as any[];
  return data.map((c) => ({
    id: c.id,
    body: c.body,
    path: c.path,
    line: c.line,
    side: c.side,
    inReplyToId: c.in_reply_to_id,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    user: c.user.login,
    htmlUrl: c.html_url
  }));
}

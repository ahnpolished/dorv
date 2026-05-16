import type { GitHubReviewComment } from "../adapters/types.js";

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
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
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

export async function postPRComment(
  token: string,
  repo: string,
  prNumber: number,
  body: string
): Promise<void> {
  const parts = repo.split("/");
  const owner = parts[0];
  const name = parts[1];

  if (!owner || !name) {
    throw new Error(`Invalid repo format: ${repo}`);
  }

  const url = `https://api.github.com/repos/${owner}/${name}/issues/${prNumber.toString()}/comments`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ body })
  });

  if (!resp.ok) {
    throw new Error(`GitHub API failed: ${resp.status.toString()} ${await resp.text()}`);
  }
}

export interface ReviewCommentPayload {
  body: string;
  commit_id: string;
  path: string;
  line: number;
  side: "RIGHT";
}

export async function createReviewComment(
  token: string,
  repo: string,
  prNumber: number,
  payload: ReviewCommentPayload
): Promise<{ id: number }> {
  const parts = repo.split("/");
  const owner = parts[0];
  const name = parts[1];

  if (!owner || !name) {
    throw new Error(`Invalid repo format: ${repo}`);
  }

  const url = `https://api.github.com/repos/${owner}/${name}/pulls/${prNumber.toString()}/comments`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!resp.ok) {
    throw new Error(`GitHub comment failed: ${resp.status.toString()} ${await resp.text()}`);
  }

  return (await resp.json()) as { id: number };
}

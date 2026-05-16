export async function postPRComment(
  token: string,
  repo: string,
  prNumber: number,
  body: string
): Promise<void> {
  const [owner, name] = repo.split("/");
  const url = `https://api.github.com/repos/${owner}/${name}/issues/${prNumber}/comments`;

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
    throw new Error(`GitHub API failed: ${resp.status} ${await resp.text()}`);
  }
}

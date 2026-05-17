export async function pushGDocReply(
  token: string,
  docId: string,
  parentCommentId: string,
  content: string
): Promise<{ id: string }> {
  const url = `https://www.googleapis.com/drive/v3/files/${docId}/comments/${parentCommentId}/replies?fields=id`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ content })
  });

  if (!resp.ok) {
    throw new Error(`Drive reply push failed: ${resp.status.toString()} ${await resp.text()}`);
  }

  return (await resp.json()) as { id: string };
}

export async function pushGDocComment(
  token: string,
  docId: string,
  content: string
): Promise<{ id: string }> {
  const url = `https://www.googleapis.com/drive/v3/files/${docId}/comments?fields=id`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ content })
  });

  if (!resp.ok) {
    throw new Error(`Drive comment push failed: ${resp.status.toString()} ${await resp.text()}`);
  }

  return (await resp.json()) as { id: string };
}

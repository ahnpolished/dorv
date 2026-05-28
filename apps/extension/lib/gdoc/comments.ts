const DRIVE_COMMENT_MAX_BYTES = 4096;

interface DriveCommentOptions {
  quotedFileContent?: {
    mimeType: string;
    value: string;
  };
}

export function truncateToDriveLimit(text: string): string {
  const encoded = new TextEncoder().encode(text);
  if (encoded.length <= DRIVE_COMMENT_MAX_BYTES) return text;
  // Reserve 3 bytes for the UTF-8 ellipsis (…). Walk back from the cut
  // point past any continuation bytes (0x80–0xBF) so we never split a
  // multibyte sequence.
  let end = DRIVE_COMMENT_MAX_BYTES - 3;
  while (end > 0 && ((encoded[end] ?? 0) & 0xc0) === 0x80) end--;
  return new TextDecoder().decode(encoded.slice(0, end)) + "…";
}

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
    body: JSON.stringify({ content: truncateToDriveLimit(content) })
  });

  if (!resp.ok) {
    throw new Error(`Drive reply push failed: ${resp.status.toString()} ${await resp.text()}`);
  }

  return (await resp.json()) as { id: string };
}

export async function pushGDocComment(
  token: string,
  docId: string,
  content: string,
  options: DriveCommentOptions = {}
): Promise<{ id: string }> {
  const url = `https://www.googleapis.com/drive/v3/files/${docId}/comments?fields=id`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ content: truncateToDriveLimit(content), ...options })
  });

  if (!resp.ok) {
    throw new Error(`Drive comment push failed: ${resp.status.toString()} ${await resp.text()}`);
  }

  return (await resp.json()) as { id: string };
}

export async function deleteGDocComment(
  token: string,
  docId: string,
  commentId: string
): Promise<void> {
  const url = `https://www.googleapis.com/drive/v3/files/${docId}/comments/${commentId}`;

  const resp = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!resp.ok) {
    throw new Error(`Drive comment delete failed: ${resp.status.toString()} ${await resp.text()}`);
  }
}

export async function resolveGDocComment(
  token: string,
  docId: string,
  commentId: string
): Promise<void> {
  const url = `https://www.googleapis.com/drive/v3/files/${docId}/comments/${commentId}/replies?fields=id,comment`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      action: "resolve",
      content: "Resolved in GitHub."
    })
  });

  if (!resp.ok) {
    throw new Error(`Drive comment resolve failed: ${resp.status.toString()} ${await resp.text()}`);
  }
}

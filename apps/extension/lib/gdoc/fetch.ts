/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { GoogleDocComment } from "../adapters/types.js";

export async function fetchGDocComments(token: string, docId: string): Promise<GoogleDocComment[]> {
  const url = `https://www.googleapis.com/drive/v3/files/${docId}/comments?fields=comments(id,content,quotedFileContent,author,createdTime)`;

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!resp.ok) {
    throw new Error(`Drive fetch failed: ${resp.status.toString()} ${await resp.text()}`);
  }

  const data = (await resp.json()) as { comments: any[] | undefined };
  return (data.comments ?? []).map((c: any) => ({
    id: c.id,
    content: c.content,
    quotedFileContent: c.quotedFileContent?.value,
    author: c.author?.displayName ?? "Unknown",
    createdAt: c.createdTime,
    updatedAt: c.createdTime
  }));
}

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import type { GoogleDocComment } from "../adapters/types.js";

export async function fetchGDocComments(token: string, docId: string): Promise<GoogleDocComment[]> {
  const fields =
    "nextPageToken,comments(id,content,quotedFileContent,author,createdTime,resolved,replies(id,content,author,createdTime))";
  const baseUrl = `https://www.googleapis.com/drive/v3/files/${docId}/comments?pageSize=100&fields=${fields}`;

  const all: any[] = [];
  let pageToken: string | undefined;

  do {
    const url = pageToken ? `${baseUrl}&pageToken=${pageToken}` : baseUrl;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!resp.ok) {
      throw new Error(`Drive fetch failed: ${resp.status.toString()} ${await resp.text()}`);
    }

    const data = (await resp.json()) as { comments: any[] | undefined; nextPageToken?: string };
    for (const c of data.comments ?? []) all.push(c);
    pageToken = data.nextPageToken;
  } while (pageToken);

  return all.map((c: any) => ({
    id: c.id,
    content: c.content,
    quotedFileContent: c.quotedFileContent?.value,
    author: c.author?.displayName ?? "Unknown",
    createdAt: c.createdTime,
    updatedAt: c.createdTime,
    resolved: c.resolved ?? false,
    replies: (c.replies ?? []).map((r: any) => ({
      id: r.id,
      content: r.content,
      author: r.author?.displayName ?? "Unknown",
      createdAt: r.createdTime
    }))
  }));
}

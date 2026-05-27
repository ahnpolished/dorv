export function parseDocId(url: string): string | undefined {
  const match = /\/document\/d\/([a-zA-Z0-9_-]+)/.exec(url);
  return match?.[1];
}

export function extractDocFromBotComment(
  body: string
): { docId: string; docUrl: string } | undefined {
  const markerMatch = /<!--\s*dorv-doc-id=([a-zA-Z0-9_-]+)\s*-->/.exec(body);
  if (!markerMatch && !body.includes("**dorv**")) return undefined;

  const urlMatch = /\((https:\/\/docs\.google\.com\/document\/d\/[a-zA-Z0-9_-]+[^)]*)\)/.exec(body);
  const docUrl = urlMatch?.[1];
  if (!docUrl) return undefined;

  const docId = markerMatch?.[1] ?? parseDocId(docUrl);
  if (!docId) return undefined;

  return { docId, docUrl };
}

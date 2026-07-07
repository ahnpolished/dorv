const GH_DISCUSSION_ID_PATTERN = /#discussion_r(\d+)/;
const DOC_SOURCE_MARKER_PATTERN = /<!--\s*dorv-src=doc:([\w-]+)\s*-->/;

/**
 * Recovers the GitHub review-comment id from a body previously pushed to a
 * Google Doc via `formatGitHubMirroredBody`, which embeds
 * `[View on GitHub](htmlUrl)` where htmlUrl contains `#discussion_r{id}`.
 * Used to dedup against the doc's existing comments without trusting local
 * storage having recorded the mapping.
 */
export function extractGHCommentIdFromMirroredBody(body: string): number | undefined {
  const match = GH_DISCUSSION_ID_PATTERN.exec(body);
  if (!match?.[1]) return undefined;
  const id = Number.parseInt(match[1], 10);
  return Number.isNaN(id) ? undefined : id;
}

/** Builds the invisible marker embedded in GH comment bodies pushed from a Google Doc comment. */
export function buildGHSourceMarker(docCommentId: string): string {
  return `<!-- dorv-src=doc:${docCommentId} -->`;
}

/**
 * Recovers the source Google Doc comment id from a GH comment body previously
 * pushed via `buildGHSourceMarker`. Used to dedup against GitHub's existing
 * review comments without trusting local storage.
 */
export function extractDocMarkerFromGHBody(body: string): string | undefined {
  const match = DOC_SOURCE_MARKER_PATTERN.exec(body);
  return match?.[1];
}

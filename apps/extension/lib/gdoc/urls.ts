import type { DocFileMapping } from "../adapters/types.js";

const MULTI_DOC_MARKER_PATTERN = /<!--\s*dorv-docs=(\{.*?\})\s*-->/;
const LEGACY_DOC_MARKER_PATTERN = /<!--\s*dorv-doc-id=([a-zA-Z0-9_-]+)\s*-->/;

export function parseDocId(url: string): string | undefined {
  const match = /\/document\/d\/([a-zA-Z0-9_-]+)/.exec(url);
  return match?.[1];
}

export function buildDocUrl(docId: string): string {
  return `https://docs.google.com/document/d/${docId}/edit`;
}

/** Builds the bot-comment marker encoding every markdown-file -> doc mapping for a PR. */
export function buildDocsMarker(docs: DocFileMapping[]): string {
  const record: Record<string, string> = {};
  for (const doc of docs) {
    record[doc.filename] = doc.docId;
  }
  return `<!-- dorv-docs=${JSON.stringify(record)} -->`;
}

/**
 * Recovers the PR's markdown-file -> Google Doc mapping from a dorv bot
 * comment. Understands the current multi-doc marker
 * (`<!-- dorv-docs={"file.md":"docId"} -->`) as well as the legacy
 * single-doc marker (`<!-- dorv-doc-id=X -->`) from PRs linked before the
 * v0.3.0 multi-doc rewrite, mapping the legacy form to a single-entry array
 * under a synthetic filename since the original body doesn't record it.
 */
export function extractDocsFromBotComment(body: string): DocFileMapping[] | undefined {
  const multiMatch = MULTI_DOC_MARKER_PATTERN.exec(body);
  if (multiMatch?.[1]) {
    try {
      const record = JSON.parse(multiMatch[1]) as Record<string, string>;
      const docs = Object.entries(record).map(([filename, docId]) => ({
        filename,
        docId,
        docUrl: buildDocUrl(docId)
      }));
      if (docs.length > 0) return docs;
    } catch {
      // fall through to legacy parsing below
    }
  }

  const legacyMarkerMatch = LEGACY_DOC_MARKER_PATTERN.exec(body);
  if (!legacyMarkerMatch && !body.includes("**dorv**")) return undefined;

  const urlMatch = /\((https:\/\/docs\.google\.com\/document\/d\/[a-zA-Z0-9_-]+[^)]*)\)/.exec(body);
  const docUrl = urlMatch?.[1];
  if (!docUrl) return undefined;

  const docId = legacyMarkerMatch?.[1] ?? parseDocId(docUrl);
  if (!docId) return undefined;

  return [{ filename: "__legacy__", docId, docUrl }];
}

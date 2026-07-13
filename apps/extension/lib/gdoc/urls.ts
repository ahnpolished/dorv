import type { DocFileMapping, DocFileVersion } from "../adapters/types.js";

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
  const record: Record<string, unknown> = {};
  for (const doc of docs) {
    record[doc.filename] = doc.docId;
    if (doc.versions && doc.versions.length > 0) {
      record[`__versions:${doc.filename}`] = doc.versions;
    }
  }
  return `<!-- dorv-docs=${JSON.stringify(record)} -->`;
}

/** Renders a file entry with inline version links for the bot comment body. */
export function renderFileEntry(doc: DocFileMapping): string {
  const versions = doc.versions ?? [];
  if (versions.length === 0) {
    return `- [${doc.filename}](${doc.docUrl})`;
  }
  const links = versions
    .map(
      (v, i) =>
        `[v${(i + 1).toString()} (ref: ${v.sha.slice(0, 7)})](${v.docId ? buildDocUrl(v.docId) : doc.docUrl})`
    )
    .join(", ");
  return `- [${doc.filename}](${doc.docUrl}) (${links})`;
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
      const record = JSON.parse(multiMatch[1]) as Record<string, unknown>;
      const versionsByFile: Record<string, DocFileVersion[]> = {};
      for (const [key, value] of Object.entries(record)) {
        if (key.startsWith("__versions:")) {
          const filename = key.slice("__versions:".length);
          versionsByFile[filename] = value as DocFileVersion[];
        }
      }

      const docs = Object.entries(record)
        .filter(([key]) => !key.startsWith("__"))
        .map(([filename, docId]) => {
          const doc: DocFileMapping = {
            filename,
            docId: String(docId),
            docUrl: buildDocUrl(String(docId))
          };
          const v = versionsByFile[filename];
          if (v) {
            doc.versions = v.map((ver) => ({
              sha: ver.sha,
              docId: ver.docId ?? String(docId) // backward-compat for versions without docId
            }));
          }
          return doc;
        });
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

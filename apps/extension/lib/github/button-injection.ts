/**
 * Pure, DOM-framework-agnostic injection-decision logic for GitHub PR
 * per-file action buttons.
 *
 * v0.3.0: buttons now inject inline next to each markdown file's filename in
 * the "Files Changed" tab — one button per `.md` file — rather than a single
 * panel in the PR sidebar. Each file header is an independent injection
 * target; the previous skip/inject/reinject tri-state is replaced by a simple
 * idempotent check per file header.
 *
 * Kept separate from `github-buttons.content.tsx` so it can be unit tested
 * without a live content-script context or jsdom (repo convention:
 * hand-rolled fakes implementing only the methods used here).
 */

/**
 * Cascaded selectors for diff file headers in the GitHub "Files Changed"
 * view. GitHub uses CSS modules with hashed suffixes that change across
 * deployments, so we try multiple known patterns in order of specificity
 * and pick whichever produces results on the current page.
 * Markdown files are detected by the link text inside the header, not by
 * a `data-path` attribute.
 */
export const FILE_HEADER_SELECTORS = [
  '[class*="file-header"]',
  ".file-header",
  ".js-file-header",
  '[class*="DiffFileHeader"]',
  '[data-testid="file-header"]'
];

/**
 * Returns the first selector in FILE_HEADER_SELECTORS that matches at
 * least one element in the document and also finds at least one `.md`
 * file among them.  Cached on first call per document lifetime so we
 * don't keep probing on every injection cycle.
 */
let _cachedSelector: string | null = null;
let _cachedDoc: AnchorLookupDocument | null = null;

export function resolveFileHeaderSelector(doc: AnchorLookupDocument): string | null {
  if (_cachedDoc === doc && _cachedSelector !== null) return _cachedSelector;

  for (const sel of FILE_HEADER_SELECTORS) {
    const all = Array.from(doc.querySelectorAll(sel));
    if (all.length === 0) continue;
    // Must find at least one markdown file among them
    for (const el of all) {
      if (isMarkdownFileHeader(el)) {
        _cachedDoc = doc;
        _cachedSelector = sel;
        return sel;
      }
    }
  }

  return null;
}

/** Minimal shape the injection helpers need from a document-like object. */
export interface AnchorLookupDocument {
  querySelectorAll(selector: string): NodeListOf<Element>;
}

/**
 * Finds every diff file header in the DOM whose linked filename ends with
 * `.md`.  Non-markdown headers are filtered out by scanning the anchor text.
 */
export function findInjectionAnchors(doc: AnchorLookupDocument): Element[] {
  const sel = resolveFileHeaderSelector(doc);
  if (!sel) return [];
  const all = Array.from(doc.querySelectorAll(sel));
  return all.filter((header) => header.querySelector("a") !== null && isMarkdownFileHeader(header));
}

/** Returns the filename from a DiffFileHeader element, or null. */
export function getFileHeaderFilename(header: Element): string | null {
  const link = header.querySelector("a");
  if (!link) return null;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const text = link.textContent?.trim() ?? "";
  // GitHub prepends AND appends a zero-width space (\u200e); strip both.
  const stripped = text.replace(/^\u200e/, "").replace(/\u200e$/, "");
  return stripped || null;
}

/** True when the file header represents a markdown (`.md`) file. */
export function isMarkdownFileHeader(header: Element): boolean {
  const filename = getFileHeaderFilename(header);
  return filename?.endsWith(".md") ?? false;
}

/**
 * Prefix for the `id` assigned to each injected button container.  The
 * full id is `<prefix><sanitized-filename>` so per-file buttons can be
 * located and cleaned up independently.
 */
export const BUTTON_ROOT_PREFIX = "dorv-file-btn-";

/**
 * Builds the stable DOM id that a per-file button container receives.
 * Filenames are sanitised to only contain `[a-zA-Z0-9_-]` so the id is a
 * valid HTML identifier.
 */
export function fileButtonRootId(filename: string): string {
  return BUTTON_ROOT_PREFIX + filename.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * Checks whether a file header already has a dorv button injected.
 * The per-file button is identified by the stable id computed from the
 * file's name.
 */
export function hasFileButton(header: Element): boolean {
  const filename = getFileHeaderFilename(header);
  if (!filename) return false;
  const id = fileButtonRootId(filename);
  // `CSS.escape` is unavailable in Node (tests), but fileButtonRootId
  // already sanitises to [a-zA-Z0-9_-] — no escaping needed for the
  // resulting id selector.
  return !!header.querySelector(`#${id}`);
}

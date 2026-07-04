/**
 * DOM-scanning/matching helpers for Google Docs comment sidebar cards.
 *
 * See `docs/GDOC_COMMENT_DOM_NOTES.md` for the research this is based on and
 * its confidence level. Summary: Google Docs' comment DOM is internally
 * namespaced under a `docos-*` class prefix (unofficial, unversioned, can
 * change at any time), and — per every third-party project reviewed — there
 * is no reliably stable per-comment id/data-attribute exposed on the DOM.
 * `extractCardCommentId` is therefore best-effort and expected to often
 * return `undefined`; `matchCardToComment` (author+text heuristic matching
 * against `fetchGDocComments` results, mirroring the reverse-direction
 * approach in `gdoc/matching.ts`) is the real fallback, and only returns a
 * match when it is unambiguous, to avoid mis-attributing a push to the wrong
 * comment.
 */
import type { GoogleDocComment } from "../adapters/types.js";

const SYNCED_ATTR = "data-dorv-synced";

/** Primary selector for one comment/suggestion thread card. */
const THREAD_SELECTOR = ".docos-docoview-replycontainer";

/** Candidate selectors for the author element within a card, most specific first. */
const AUTHOR_SELECTORS = [
  ".docos-anchoredreplyview-author.docos-author",
  ".docos-author",
  ".docos-replyview-author"
];

/** Candidate selectors for the comment body element within a card, most specific first. */
const BODY_SELECTORS = [
  ".docos-replyview-body.docos-anchoredreplyview-body",
  ".docos-replyview-content",
  ".docos-replyview-body"
];

/** Attribute names that might (unreliably) carry a comment id. */
const ID_ATTR_CANDIDATES = ["data-comment-id", "data-id", "data-docos-id"];

/** Matches Google Docs' internal `kix.XXXXXXX` anchor token format, if present anywhere. */
const KIX_ID_PATTERN = /kix\.[\w-]+/;

function normalize(text: string | undefined | null): string {
  return (text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Finds comment/suggestion thread cards under `root`.
 *
 * Primary: known `.docos-docoview-replycontainer` selector.
 * Fallback: a structural scan for elements that look card-shaped (contain
 * both a short "author-like" text node and a longer body text node, and
 * aren't nested inside another candidate) — used only if the primary
 * selector matches nothing, e.g. because Google rotated its class names.
 */
export function findCommentCards(root: ParentNode): Element[] {
  const primary = Array.from(root.querySelectorAll(THREAD_SELECTOR));
  if (primary.length > 0) return primary;

  return findCommentCardsByStructure(root);
}

function findCommentCardsByStructure(root: ParentNode): Element[] {
  const candidates: Element[] = [];
  const all = root.querySelectorAll("*");
  for (const el of Array.from(all)) {
    if (looksLikeCommentCard(el)) candidates.push(el);
  }
  // Drop candidates that are ancestors of another candidate, keeping the
  // innermost card-shaped element (avoids matching a large container that
  // happens to contain author/body text somewhere within it).
  return candidates.filter((el) => !candidates.some((other) => other !== el && el.contains(other)));
}

function looksLikeCommentCard(el: Element): boolean {
  if (el.children.length === 0 || el.children.length > 12) return false;
  const text = normalize(el.textContent);
  if (text.length < 3 || text.length > 2000) return false;
  const author = extractCardAuthor(el);
  const body = extractCardBody(el);
  return !!author && !!body && author !== body;
}

/** Short leaf-text candidates (e.g. author names) are expected to be in this length range. */
const AUTHOR_LIKE_MAX_LEN = 60;
/** Body-text candidates should be longer than this to avoid matching author/timestamp fragments. */
const BODY_LIKE_MIN_LEN = 3;

/** Leaf elements (no element children) with non-empty trimmed text, in document order. */
function leafTextElements(root: Element): Element[] {
  const leaves: Element[] = [];
  const walk = (el: Element) => {
    const childElements = Array.from(el.children);
    if (childElements.length === 0) {
      if (el.textContent.trim()) leaves.push(el);
      return;
    }
    for (const child of childElements) walk(child);
  };
  walk(root);
  return leaves;
}

/**
 * Extracts the visible author text from a card.
 * Primary: known `.docos-*` author selectors.
 * Fallback (selector-independent): the first short leaf-text descendant,
 * on the assumption a comment card's structure starts with an author name
 * (optionally followed by a timestamp) before the longer body text.
 */
export function extractCardAuthor(card: Element): string | undefined {
  for (const sel of AUTHOR_SELECTORS) {
    const el = card.querySelector(sel);
    const text = el?.textContent.trim();
    if (text) return text;
  }

  const leaves = leafTextElements(card);
  for (const leaf of leaves) {
    const text = leaf.textContent.trim();
    if (text.length > 0 && text.length <= AUTHOR_LIKE_MAX_LEN) return text;
  }
  return undefined;
}

/**
 * Extracts the visible comment body text from a card.
 * Primary: known `.docos-*` body selectors.
 * Fallback (selector-independent): the longest leaf-text descendant that
 * isn't the extracted author text, on the assumption the body is the
 * longest piece of text in a comment card.
 */
export function extractCardBody(card: Element): string | undefined {
  for (const sel of BODY_SELECTORS) {
    const el = card.querySelector(sel);
    const text = el?.textContent.trim();
    if (text) return text;
  }

  const authorFallback = (() => {
    for (const sel of AUTHOR_SELECTORS) {
      const el = card.querySelector(sel);
      const text = el?.textContent.trim();
      if (text) return text;
    }
    return undefined;
  })();

  const leaves = leafTextElements(card)
    .map((el) => el.textContent.trim())
    .filter((text) => text.length >= BODY_LIKE_MIN_LEN && text !== authorFallback);

  if (leaves.length === 0) return undefined;
  return leaves.reduce((longest, current) => (current.length > longest.length ? current : longest));
}

/**
 * Best-effort extraction of a comment id directly from the card's DOM.
 * Returns `undefined` when no plausible id is found — callers must fall
 * back to `matchCardToComment` in that case, which is the expected common
 * path per the DOM-structure spike.
 */
export function extractCardCommentId(card: Element): string | undefined {
  for (const attr of ID_ATTR_CANDIDATES) {
    const value = card.getAttribute(attr) ?? card.querySelector(`[${attr}]`)?.getAttribute(attr);
    if (value) return value;
  }

  const idAttr = card.id;
  if (idAttr && KIX_ID_PATTERN.test(idAttr)) {
    return KIX_ID_PATTERN.exec(idAttr)?.[0];
  }

  const withDataAttrs = card.querySelectorAll(
    "[id], [data-id], [data-comment-id], [data-docos-id]"
  );
  for (const el of Array.from(withDataAttrs)) {
    for (const attr of ["id", "data-id", "data-comment-id", "data-docos-id"]) {
      const value = el.getAttribute(attr);
      if (value && KIX_ID_PATTERN.test(value)) {
        return KIX_ID_PATTERN.exec(value)?.[0];
      }
    }
  }

  return undefined;
}

/**
 * Heuristic fallback: matches a card's visible author+text against a list of
 * `GoogleDocComment`s (e.g. from `fetchGDocComments`). Only returns a match
 * when exactly one candidate matches both fields — ambiguous cases return
 * `undefined` rather than risk pushing the wrong comment to GitHub.
 */
export function matchCardToComment(
  card: { author: string; text: string },
  comments: GoogleDocComment[]
): GoogleDocComment | undefined {
  const author = normalize(card.author);
  const text = normalize(card.text);
  if (!author || !text) return undefined;

  const matches = comments.filter(
    (c) => normalize(c.author) === author && normalize(c.content) === text
  );

  return matches.length === 1 ? matches[0] : undefined;
}

/** Marks a card as synced (idempotent, cheap to check on re-scans). */
export function markCardSynced(card: Element): void {
  card.setAttribute(SYNCED_ATTR, "true");
}

/** Reads whether a card was previously marked synced. */
export function isCardSynced(card: Element): boolean {
  return card.getAttribute(SYNCED_ATTR) === "true";
}

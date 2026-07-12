/**
 * Injects a "Push to GitHub" button onto each unsynced Google Docs comment
 * card, for docs that are linked to a dorv PR.
 *
 * DOM-structure caveat: see `docs/GDOC_COMMENT_DOM_NOTES.md`. Google Docs'
 * comment sidebar DOM is unofficial/unversioned; card detection and
 * comment-id extraction in `lib/gdoc/comment-card-injection.ts` are
 * best-effort and may need adjustment once verified against a live doc.
 */
import { defineContentScript } from "wxt/utils/define-content-script";

import animationsCss from "../lib/design/animations.css?inline";
import tokensCss from "../lib/design/tokens.css?inline";
import type { GoogleDocComment, PullRequestRef } from "../lib/adapters/types.js";
import {
  getDocCommentsViaBackground,
  pushDocCommentToGHViaBackground
} from "../lib/adapters/messages.js";
import { resolveAdapter } from "../lib/adapters/resolve.js";
import {
  extractCardAuthor,
  extractCardBody,
  extractCardCommentId,
  findBadgeContainer,
  findCommentCards,
  isCardSynced,
  markCardSynced,
  matchCardToComment
} from "../lib/gdoc/comment-card-injection.js";
import { parseDocId } from "../lib/gdoc/urls.js";
import { createAuthStore } from "../lib/storage/auth.js";
import { createChromeStorageArea } from "../lib/storage/area.js";
import { createDocStore } from "../lib/storage/stores.js";
import { captureExtensionException, initSentryForSurface } from "../lib/telemetry/sentry.js";

const SURFACE = "gdoc-buttons" as const;
const DEBOUNCE_MS = 600;
const CHECK_DISPLAY_MS = 350;
const BUTTON_ATTR = "data-dorv-button";
const STYLE_ID = "dorv-gdoc-button-style";

const ICON_GITHUB =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>';
const ICON_SPINNER =
  '<svg class="dorv-spinning" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 2 A10 10 0 0 1 22 12"/></svg>';
const ICON_CHECK =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="dorv-check-path" d="M4 12l6 6L20 6"/></svg>';

initSentryForSurface(SURFACE);

const storageArea = createChromeStorageArea(chrome.storage.local);
const authStore = createAuthStore(storageArea);
const docStore = createDocStore(storageArea);
const adapter = resolveAdapter({ authStore, storageArea });

function ensureStyleInjected(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    ${tokensCss}
    ${animationsCss}
    .dorv-push-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      margin: 4px 4px 4px 0;
      padding: 0;
      border: none;
      border-radius: 4px;
      background: none;
      color: #1a73e8;
      cursor: pointer;
    }
    .dorv-push-btn svg {
      display: block;
      flex-shrink: 0;
    }
    .dorv-push-btn:hover:not(:disabled) {
      background: rgba(26, 115, 232, 0.08);
    }
    .dorv-push-btn:disabled {
      opacity: 0.6;
      cursor: default;
    }
    .dorv-push-synced {
      font-family: "Google Sans", Roboto, Arial, sans-serif;
      font-size: 11px;
      color: #188038;
      margin: 4px 4px 4px 0;
    }
    .dorv-push-error {
      font-family: "Google Sans", Roboto, Arial, sans-serif;
      font-size: 11px;
      color: #d93025;
      margin: 4px 4px 4px 0;
      display: block;
    }
  `;
  document.head.append(style);
}

/**
 * Matches a card element to a Google Doc comment.  First tries the
 * faster ID-based lookup; falls back to the shared heuristic in
 * `matchCardToComment` (normalised author+text).  Keeps the DOM
 * extraction local — the library function is DOM-agnostic.
 */
function findMatchedComment(
  card: Element,
  comments: GoogleDocComment[]
): GoogleDocComment | undefined {
  const id = extractCardCommentId(card);
  if (id) {
    const byId = comments.find((c) => c.id === id);
    if (byId) return byId;
  }

  const author = extractCardAuthor(card);
  const text = extractCardBody(card);
  return author && text ? matchCardToComment({ author, text }, comments) : undefined;
}

/** Prefer the hover-revealed action bar (next to "Mark as resolved" / "More options"); falls back to the card itself. */
function getInjectionTarget(card: Element): Element {
  return findBadgeContainer(card) ?? card;
}

function renderErrorNear(card: Element, message: string): void {
  const existing = card.querySelector(".dorv-push-error");
  existing?.remove();
  const el = document.createElement("span");
  el.className = "dorv-push-error";
  el.textContent = `dorv: ${message}`;
  getInjectionTarget(card).append(el);
}

function renderSyncedIndicator(card: Element): void {
  card.querySelector(`[${BUTTON_ATTR}]`)?.remove();
  card.querySelector(".dorv-push-error")?.remove();
  if (card.querySelector(".dorv-push-synced")) return;
  const el = document.createElement("span");
  el.className = "dorv-push-synced";
  el.textContent = "✓ synced to GitHub";
  getInjectionTarget(card).append(el);
}

function injectButton(
  card: Element,
  ref: PullRequestRef,
  docId: string,
  comment: GoogleDocComment
): void {
  if (card.querySelector(`[${BUTTON_ATTR}]`)) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "dorv-push-btn";
  button.setAttribute(BUTTON_ATTR, "true");
  button.setAttribute("aria-label", "Push to GitHub");
  button.title = "Push to GitHub";
  button.innerHTML = ICON_GITHUB;

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    button.disabled = true;
    button.setAttribute("aria-label", "Pushing…");
    button.innerHTML = ICON_SPINNER;
    card.querySelector(".dorv-push-error")?.remove();

    pushDocCommentToGHViaBackground({ ref, docId, comment })
      .then(() => {
        button.setAttribute("aria-label", "Pushed");
        button.innerHTML = ICON_CHECK;
        markCardSynced(card);
        setTimeout(() => {
          renderSyncedIndicator(card);
        }, CHECK_DISPLAY_MS);
      })
      .catch((err: unknown) => {
        button.disabled = false;
        button.setAttribute("aria-label", "Push to GitHub");
        button.title = "Push to GitHub";
        button.innerHTML = ICON_GITHUB;
        renderErrorNear(card, "push failed, try again");
        captureExtensionException(err, {
          surface: SURFACE,
          tags: { operation: "push_doc_comment_to_gh" },
          extra: { docId, commentId: comment.id }
        });
      });
  });

  getInjectionTarget(card).prepend(button);
}

async function scanAndInject(ref: PullRequestRef, docId: string): Promise<void> {
  const cards = findCommentCards(document.body).filter((card) => !isCardSynced(card));
  if (cards.length === 0) return;

  // Fetching Google Doc comments requires a Google OAuth token via
  // chrome.identity, which is not accessible from a content script's
  // execution context — proxied through the background service worker
  // instead (see docs/GDOC_COMMENT_DOM_NOTES.md).
  // getDocCommentsViaBackground returns comments across every doc in the PR's
  // mapping (GoogleDocComment doesn't carry a docId — same shape the rest of
  // the adapter uses), so cards are matched against the full set; safe since
  // matchCardToComment only returns a match when it's unambiguous.
  const [comments, mappings] = await Promise.all([
    getDocCommentsViaBackground(ref),
    adapter.getCommentMappings(ref)
  ]);

  const syncedDocCommentIds = new Set(
    mappings.filter((m) => m.source === "gdoc").map((m) => m.docCommentId)
  );

  for (const card of cards) {
    const comment = findMatchedComment(card, comments);
    if (!comment) continue;

    if (syncedDocCommentIds.has(comment.id)) {
      markCardSynced(card);
      renderSyncedIndicator(card);
      continue;
    }

    injectButton(card, ref, docId, comment);
  }
}

export default defineContentScript({
  matches: ["https://docs.google.com/*"],
  runAt: "document_idle",
  async main(ctx) {
    const docId = parseDocId(window.location.href);
    if (!docId) return;

    let mapping;
    try {
      mapping = await docStore.getByDocId(docId);
    } catch (err) {
      captureExtensionException(err, {
        surface: SURFACE,
        tags: { operation: "lookup_doc_mapping" },
        extra: { docId }
      });
      return;
    }
    if (!mapping) return;

    const ref: PullRequestRef = { repo: mapping.repo, prNumber: mapping.prNumber };
    ensureStyleInjected();

    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = false;
    const scheduleScan = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (running) return;
        running = true;
        void scanAndInject(ref, docId)
          .catch((err: unknown) => {
            captureExtensionException(err, {
              surface: SURFACE,
              tags: { operation: "scan_and_inject" },
              extra: { docId }
            });
          })
          .finally(() => {
            running = false;
          });
      }, DEBOUNCE_MS);
    };

    scheduleScan();

    const observer = new MutationObserver(() => {
      scheduleScan();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    ctx.onInvalidated(() => {
      observer.disconnect();
      if (timer !== null) clearTimeout(timer);
    });
  }
});

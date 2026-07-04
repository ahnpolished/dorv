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
const BUTTON_ATTR = "data-dorv-button";
const STYLE_ID = "dorv-gdoc-button-style";

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
    .dorv-push-btn {
      font-family: "Google Sans", Roboto, Arial, sans-serif;
      font-size: 11px;
      font-weight: 500;
      color: #1a73e8;
      background: #ffffff;
      border: 1px solid #1a73e8;
      border-radius: 4px;
      padding: 2px 8px;
      margin: 4px 4px 4px 0;
      cursor: pointer;
      line-height: 1.6;
    }
    .dorv-push-btn:hover {
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

function renderErrorNear(card: Element, message: string): void {
  const existing = card.querySelector(".dorv-push-error");
  existing?.remove();
  const el = document.createElement("span");
  el.className = "dorv-push-error";
  el.textContent = `dorv: ${message}`;
  card.append(el);
}

function renderSyncedIndicator(card: Element): void {
  card.querySelector(`[${BUTTON_ATTR}]`)?.remove();
  card.querySelector(".dorv-push-error")?.remove();
  if (card.querySelector(".dorv-push-synced")) return;
  const el = document.createElement("span");
  el.className = "dorv-push-synced";
  el.textContent = "✓ synced to GitHub";
  card.append(el);
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
  button.textContent = "Push to GitHub";

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    button.disabled = true;
    button.textContent = "Pushing…";
    card.querySelector(".dorv-push-error")?.remove();

    pushDocCommentToGHViaBackground({ ref, docId, comment })
      .then(() => {
        markCardSynced(card);
        renderSyncedIndicator(card);
      })
      .catch((err: unknown) => {
        button.disabled = false;
        button.textContent = "Push to GitHub";
        renderErrorNear(card, "push failed, try again");
        captureExtensionException(err, {
          surface: SURFACE,
          tags: { operation: "push_doc_comment_to_gh" },
          extra: { docId, commentId: comment.id }
        });
      });
  });

  card.append(button);
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

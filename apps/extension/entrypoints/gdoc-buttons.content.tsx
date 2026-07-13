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
import type { GoogleDocComment, GoogleDocReply, PullRequestRef } from "../lib/adapters/types.js";
import {
  getDocCommentsViaBackground,
  pushDocCommentToGHViaBackground,
  pushDocReplyToGHViaBackground
} from "../lib/adapters/messages.js";
import { resolveAdapter } from "../lib/adapters/resolve.js";
import {
  extractCardAuthor,
  extractCardBody,
  extractCardCommentId,
  findBadgeContainer,
  findCommentCards,
  findReplyById,
  findReplyElements,
  isCardSynced,
  markCardSynced,
  matchCardToComment,
  matchCardToReply
} from "../lib/gdoc/comment-card-injection.js";
import { parseDocId } from "../lib/gdoc/urls.js";
import { createAuthStore } from "../lib/storage/auth.js";
import { createChromeStorageArea } from "../lib/storage/area.js";
import { createDocStore } from "../lib/storage/stores.js";
import { captureExtensionException, initSentryForSurface } from "../lib/telemetry/sentry.js";

const SURFACE = "gdoc-buttons" as const;
const DEBOUNCE_MS = 600;
const MAX_DEBOUNCE_MS = 3000;
const CHECK_DISPLAY_MS = 350;
const BUTTON_ATTR = "data-dorv-button";
const STYLE_ID = "dorv-gdoc-button-style";

const ICON_GITHUB =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="#f97316" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>';
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
      margin: 0 2px;
      padding: 0;
      border: none;
      border-radius: 4px;
      background: none;
      color: #1a73e8;
      cursor: pointer;
      align-self: center;
      vertical-align: middle;
    }
    /* When injected directly into the card (no action bar found), float right
       so it sits near the header instead of top-left. */
    .docos-docoview-replycontainer > .dorv-push-btn {
      float: right;
      margin: 8px 8px 0 0;
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
 * Matches a card element to a Google Doc comment or reply.
 * First tries the faster ID-based lookup against root comments and replies;
 * falls back to the shared heuristic in `matchCardToComment` /
 * `matchCardToReply` (normalised author+text). Keeps the DOM extraction
 * local — the library functions are DOM-agnostic.
 *
 * Returns the matched root comment and, if the card is a reply card, the
 * specific reply within it.
 */
function findMatchedComment(
  card: Element,
  comments: GoogleDocComment[]
): { comment: GoogleDocComment; reply?: GoogleDocReply } | undefined {
  const id = extractCardCommentId(card);
  const author = extractCardAuthor(card);
  const text = extractCardBody(card);
  console.log(
    "[dorv-gdoc:findMatchedComment] card id=",
    id,
    "author=",
    author,
    "text=",
    text?.slice(0, 50)
  );

  if (id) {
    const byId = comments.find((c) => c.id === id);
    if (byId) {
      console.log("[dorv-gdoc:findMatchedComment] matched root comment by id", id);
      return { comment: byId };
    }

    const byReplyId = findReplyById(id, comments);
    if (byReplyId) {
      const reply = byReplyId.comment.replies?.[byReplyId.replyIndex];
      if (reply) {
        console.log(
          "[dorv-gdoc:findMatchedComment] matched reply by id",
          id,
          "reply author=",
          reply.author
        );
        return { comment: byReplyId.comment, reply };
      }
    }
  }

  if (!author || !text) {
    console.log("[dorv-gdoc:findMatchedComment] missing author or text, skipping heuristic match");
    return undefined;
  }

  const byComment = matchCardToComment({ author, text }, comments);
  if (byComment) {
    console.log("[dorv-gdoc:findMatchedComment] matched root comment by author+text");
    return { comment: byComment };
  }

  const byReply = matchCardToReply({ author, text }, comments);
  if (byReply) {
    const reply = byReply.comment.replies?.[byReply.replyIndex];
    if (reply) {
      console.log("[dorv-gdoc:findMatchedComment] matched reply by author+text");
      return { comment: byReply.comment, reply };
    }
  }

  console.log("[dorv-gdoc:findMatchedComment] no match found for card");
  return undefined;
}

/** Prefer the visible action bar (next to "Mark as resolved" / "More options"); falls back to the card itself so the button is never trapped inside a hidden hover-only container. */
function getInjectionTarget(card: Element): Element {
  const badge = findBadgeContainer(card);
  if (badge && (badge as HTMLElement).offsetHeight > 0) {
    return badge;
  }
  return card;
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
  comment: GoogleDocComment,
  reply?: GoogleDocReply
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

    console.log(
      "[dorv-gdoc:button-click] pushing",
      reply ? "reply" : "root comment",
      "replyId=",
      reply?.id,
      "commentId=",
      comment.id
    );
    const pushPromise = reply
      ? pushDocReplyToGHViaBackground({ ref, docId, comment, reply })
      : pushDocCommentToGHViaBackground({ ref, docId, comment });

    pushPromise
      .then(() => {
        button.setAttribute("aria-label", "Pushed");
        button.innerHTML = ICON_CHECK;
        markCardSynced(card);
        setTimeout(() => {
          renderSyncedIndicator(card);
        }, CHECK_DISPLAY_MS);
      })
      .catch((err: unknown) => {
        console.error("[dorv-gdoc:button-click] push FAILED:", err);
        button.disabled = false;
        button.setAttribute("aria-label", "Push to GitHub");
        button.title = "Push to GitHub";
        button.innerHTML = ICON_GITHUB;
        const msg = err instanceof Error ? err.message : String(err);
        renderErrorNear(card, `push failed — ${msg}`);
        captureExtensionException(err, {
          surface: SURFACE,
          tags: { operation: reply ? "push_doc_reply_to_gh" : "push_doc_comment_to_gh" },
          extra: { docId, commentId: comment.id, replyId: reply?.id }
        });
      });
  });

  getInjectionTarget(card).append(button);
}

async function scanAndInject(ref: PullRequestRef, docId: string): Promise<void> {
  const cards = findCommentCards(document.body);
  console.log("[dorv-gdoc] scanAndInject: thread cards found =", cards.length);
  if (cards.length === 0) return;

  const [comments, mappings] = await Promise.all([
    getDocCommentsViaBackground(ref),
    adapter.getCommentMappings(ref)
  ]);
  console.log(
    "[dorv-gdoc] comments fetched =",
    comments.length,
    "root mappings =",
    mappings.length
  );

  const totalReplies = comments.reduce((sum, c) => sum + (c.replies?.length ?? 0), 0);
  console.log("[dorv-gdoc] total replies across all comments =", totalReplies);

  const syncedDocCommentIds = new Set(
    mappings.filter((m) => m.source === "gdoc").map((m) => m.docCommentId)
  );

  const replyMappings = await adapter.getReplyMappings(ref);
  const syncedDocReplyIds = new Set(
    replyMappings.filter((m) => m.source === "gdoc").map((m) => m.docReplyId)
  );

  for (const card of cards) {
    const elements = findReplyElements(card);
    console.log(
      "[dorv-gdoc] processing thread card, elements=",
      elements.length,
      "card already synced=",
      isCardSynced(card)
    );

    for (const el of elements) {
      if (isCardSynced(el)) {
        console.log("[dorv-gdoc] element already synced, skipping");
        continue;
      }

      const matched = findMatchedComment(el, comments);
      if (!matched) {
        console.log(
          "[dorv-gdoc] no matched comment for element",
          extractCardAuthor(el),
          "|",
          extractCardBody(el)?.slice(0, 40)
        );
        continue;
      }

      const { comment, reply } = matched;

      if (reply) {
        const isSynced = syncedDocReplyIds.has(reply.id);
        console.log("[dorv-gdoc] element matched as reply", reply.id, "synced=", isSynced);
        if (isSynced) {
          markCardSynced(el);
          renderSyncedIndicator(el);
          continue;
        }
      } else {
        const isSynced = syncedDocCommentIds.has(comment.id);
        console.log("[dorv-gdoc] element matched as root comment", comment.id, "synced=", isSynced);
        if (isSynced) {
          markCardSynced(el);
          renderSyncedIndicator(el);
          continue;
        }
      }

      console.log(
        "[dorv-gdoc] injecting button for",
        reply ? `reply ${reply.id} on comment ${comment.id}` : `comment ${comment.id}`
      );
      injectButton(el, ref, docId, comment, reply);
    }

    // If every sub-element is synced, mark the whole card so re-scans skip it
    const allSynced = elements.every((el) => isCardSynced(el));
    if (allSynced && !isCardSynced(card)) {
      markCardSynced(card);
    }
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
    let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
    let running = false;
    const scheduleScan = () => {
      if (timer !== null) clearTimeout(timer);
      maxWaitTimer ??= setTimeout(() => {
        maxWaitTimer = null;
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
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
      }, MAX_DEBOUNCE_MS);
      timer = setTimeout(() => {
        timer = null;
        if (maxWaitTimer !== null) {
          clearTimeout(maxWaitTimer);
          maxWaitTimer = null;
        }
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
      if (maxWaitTimer !== null) clearTimeout(maxWaitTimer);
    });
  }
});

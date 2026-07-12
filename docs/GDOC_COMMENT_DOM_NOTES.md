# Google Docs comment sidebar DOM — spike notes (v0.3.0 Phase 2)

No live-browser access was available while writing `gdoc-buttons.content.tsx`, so this
is desk research only. **A human must validate this against a real, currently-loaded
Google Doc before shipping** — Google's internal class names are unversioned and can
change at any time without notice.

## What was found

Google Docs' comment system is internally namespaced under the `docos` prefix (short
for "document + OS"/discussion service — this convention shows up across every
third-party project that has reverse-engineered the sidebar). No official docs exist;
everything below comes from inspecting third-party open-source projects that scrape
the live DOM, most usefully
[`ptgott/comment-navigator`](https://github.com/ptgott/comment-navigator)
(`src/lib/constants/selectors.ts`), a Tampermonkey userscript last updated in
Nov 2020 (i.e. potentially 5+ years stale relative to today):

| Purpose | Selector |
| --- | --- |
| One comment/suggestion thread (root + all replies) | `.docos-docoview-replycontainer` |
| Scrollable container holding all threads | `.kix-appview-editor` |
| Author name within a reply | `.docos-anchoredreplyview-author.docos-author` |
| Comment/reply body text | `.docos-replyview-body.docos-anchoredreplyview-body` |
| A comment (not suggestion) within a thread | `.docos-replyview-comment` |
| First comment distinguishing a comment-thread from a suggestion-thread | `.docos-replyview-first.docos-replyview-comment` |
| First/root reply in a thread | `.docos-docoview-rootreply` |
| Currently-selected/open thread | `.docos-docoview-active` |
| Outer wrapper for one thread card | `.docos-docoview-tesla-conflict` |

**Critically: no project found (including the one above) relies on a stable
per-comment DOM id/data-attribute.** `comment-navigator` derives an ordinal
`pagePosition` from array index in `querySelectorAll(thread)`, not an id. Google Docs'
internal anchor tokens (`kix.XXXXXXX`, visible in some URL fragments like
`#cmnt<n>` or discussion permalinks) are not consistently exposed as DOM attributes
on the comment card itself in any of the sources reviewed. Treat any observed
`id`/`data-*` attribute as an implementation accident, not a contract.

## Implementation strategy adopted

Given the above, `apps/extension/lib/gdoc/comment-card-injection.ts` treats DOM-id
extraction as best-effort only, and leans on heuristic author+text matching as the
primary correctness mechanism:

1. `findCommentCards(root)` — primary: `root.querySelectorAll(".docos-docoview-replycontainer")`.
   Fallback (if that returns nothing, e.g. class names have rotated): a structural
   scan for elements that look like a comment card — has a plausible author-like
   short text node, a longer body text node, and no nested comment cards of its own
   — sufficient to unblock button injection even against a completely different
   class scheme, at the cost of possibly matching a few extra/wrong elements (the
   heuristic matcher below is the real safety net against misattribution, not this
   scan).
2. `extractCardCommentId(card)` — primary: look for a handful of plausible
   attributes (`data-comment-id`, `data-id`, `data-docos-id`, or an `id`/`data-*`
   value matching a `kix\.[\w-]+` pattern) anywhere on the card or its descendants.
   Returns `undefined` if none found — expected to be the common case per the
   research above, so callers must not assume this succeeds.
3. `matchCardToComment(card, comments)` — fallback used whenever (2) returns
   `undefined`: normalizes whitespace/case on the card's extracted author + text and
   the candidate `GoogleDocComment[]` (from `fetchGDocComments`), and returns a match
   **only if exactly one candidate matches** both fields — ambiguous matches (e.g.
   two comments with identical author + text) intentionally return `undefined` rather
   than guess, to avoid pushing the wrong comment to GitHub.
4. `markCardSynced`/`isCardSynced` — sets/reads `data-dorv-synced="true"` directly on
   the card element; independent of whichever id strategy resolved the comment, so
   re-scans by the `MutationObserver` are idempotent regardless of (2) vs (3).

## Known limitations / follow-ups for a human with a live doc

- Confirm the `.docos-*` class names above still exist by opening DevTools on a real
  Google Doc with an open comment, and update `comment-card-injection.ts`'s selector
  list if not.
- Confirm whether `commentBody`/`author` selectors reliably separate the *root*
  comment from *replies* within the same thread container — the injected button
  should attach once per top-level comment card, not once per reply, and the current
  implementation assumes each `.docos-docoview-replycontainer` maps 1:1 to the
  top-level `GoogleDocComment` (replies are handled separately via
  `GoogleDocComment.replies`, not pushed individually).
- If Google adds a real per-comment id attribute in the future, prefer wiring it into
  `extractCardCommentId` over the heuristic matcher — the heuristic is a fallback of
  last resort, not the preferred path.

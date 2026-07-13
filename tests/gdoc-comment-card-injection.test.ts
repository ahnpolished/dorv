// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  extractCardAuthor,
  extractCardBody,
  extractCardCommentId,
  findCommentCards,
  findReplyById,
  findReplyElements,
  isCardSynced,
  markCardSynced,
  matchCardToComment,
  matchCardToReply
} from "../apps/extension/lib/gdoc/comment-card-injection.js";
import type { GoogleDocComment } from "../apps/extension/lib/adapters/types.js";

function makeCard(html: string): Element {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html;
  const card = wrapper.firstElementChild;
  if (!card) throw new Error("test setup: makeCard html produced no element");
  return card;
}

function makeComment(overrides: Partial<GoogleDocComment> = {}): GoogleDocComment {
  return {
    id: "comment-1",
    content: "Please fix this typo",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    author: "Jane Doe",
    resolved: false,
    ...overrides
  };
}

describe("findCommentCards", () => {
  it("finds cards via the primary docos selector", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="docos-docoview-replycontainer">
        <div class="docos-anchoredreplyview-author docos-author">Jane Doe</div>
        <div class="docos-replyview-body docos-anchoredreplyview-body">Please fix this typo</div>
      </div>
      <div class="docos-docoview-replycontainer">
        <div class="docos-anchoredreplyview-author docos-author">John Smith</div>
        <div class="docos-replyview-body docos-anchoredreplyview-body">Nice work here</div>
      </div>
    `;
    const cards = findCommentCards(root);
    expect(cards).toHaveLength(2);
  });

  it("falls back to structural scan when the primary selector matches nothing", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="some-unknown-comment-card">
        <span class="unknown-author">Jane Doe</span>
        <p class="unknown-body">Please fix this typo somewhere in the document</p>
      </div>
    `;
    const cards = findCommentCards(root);
    // The structural fallback identifies author/body purely by text shape
    // (short leaf text = author, longest leaf text = body), independent of
    // any known "docos-*" class names, so it should still find the card.
    expect(cards).toHaveLength(1);
  });

  it("returns an empty array for a root with no cards", () => {
    const root = document.createElement("div");
    expect(findCommentCards(root)).toEqual([]);
  });
});

describe("extractCardAuthor / extractCardBody", () => {
  it("extracts author and body text from known selectors", () => {
    const card = makeCard(`
      <div class="docos-docoview-replycontainer">
        <div class="docos-anchoredreplyview-author docos-author">  Jane Doe  </div>
        <div class="docos-replyview-body docos-anchoredreplyview-body">Please fix this typo</div>
      </div>
    `);
    expect(extractCardAuthor(card)).toBe("Jane Doe");
    expect(extractCardBody(card)).toBe("Please fix this typo");
  });

  it("falls back to text-shape heuristics when no known selector matches", () => {
    const card = makeCard(`
      <div class="mystery-card">
        <span>Jane Doe</span>
        <p>Please fix this typo somewhere in the document</p>
      </div>
    `);
    expect(extractCardAuthor(card)).toBe("Jane Doe");
    expect(extractCardBody(card)).toBe("Please fix this typo somewhere in the document");
  });

  it("returns undefined for both when the card has no text at all", () => {
    const card = makeCard(`<div class="mystery-card"></div>`);
    expect(extractCardAuthor(card)).toBeUndefined();
    expect(extractCardBody(card)).toBeUndefined();
  });
});

describe("extractCardCommentId", () => {
  it("extracts an id from a data-comment-id attribute", () => {
    const card = makeCard(
      `<div class="docos-docoview-replycontainer" data-comment-id="abc123"></div>`
    );
    expect(extractCardCommentId(card)).toBe("abc123");
  });

  it("extracts an id from a descendant with data-id", () => {
    const card = makeCard(`
      <div class="docos-docoview-replycontainer">
        <div data-id="xyz789"></div>
      </div>
    `);
    expect(extractCardCommentId(card)).toBe("xyz789");
  });

  it("extracts a kix-style id embedded in an element id attribute", () => {
    const card = makeCard(`
      <div class="docos-docoview-replycontainer">
        <div id="something-kix.abc_123-more"></div>
      </div>
    `);
    expect(extractCardCommentId(card)).toBe("kix.abc_123-more");
  });

  it("returns undefined when no id-like attribute is present", () => {
    const card = makeCard(`
      <div class="docos-docoview-replycontainer">
        <div class="docos-author">Jane Doe</div>
      </div>
    `);
    expect(extractCardCommentId(card)).toBeUndefined();
  });
});

describe("matchCardToComment", () => {
  const comments = [
    makeComment({ id: "c1", author: "Jane Doe", content: "Please fix this typo" }),
    makeComment({ id: "c2", author: "John Smith", content: "Nice work here" })
  ];

  it("matches unambiguously on normalized author + text", () => {
    const match = matchCardToComment(
      { author: "  Jane Doe  ", text: "please   fix this typo" },
      comments
    );
    expect(match?.id).toBe("c1");
  });

  it("is case-insensitive and whitespace-normalizing", () => {
    const match = matchCardToComment(
      { author: "JANE DOE", text: "PLEASE FIX THIS TYPO" },
      comments
    );
    expect(match?.id).toBe("c1");
  });

  it("returns undefined when no candidate matches", () => {
    const match = matchCardToComment({ author: "Nobody", text: "nothing" }, comments);
    expect(match).toBeUndefined();
  });

  it("returns undefined when author+text is ambiguous across multiple comments", () => {
    const dup = [
      makeComment({ id: "c1", author: "Jane Doe", content: "same text" }),
      makeComment({ id: "c2", author: "Jane Doe", content: "same text" })
    ];
    const match = matchCardToComment({ author: "Jane Doe", text: "same text" }, dup);
    expect(match).toBeUndefined();
  });

  it("returns undefined for empty author or text", () => {
    expect(matchCardToComment({ author: "", text: "x" }, comments)).toBeUndefined();
    expect(matchCardToComment({ author: "x", text: "" }, comments)).toBeUndefined();
  });
});

describe("findReplyById", () => {
  const comments: GoogleDocComment[] = [
    makeComment({
      id: "c1",
      author: "Alice",
      content: "Root one",
      replies: [
        { id: "r1", content: "Reply one", author: "Bob", createdAt: "t" },
        { id: "r2", content: "Reply two", author: "Carol", createdAt: "t" }
      ]
    }),
    makeComment({
      id: "c2",
      author: "Dave",
      content: "Root two",
      replies: [{ id: "r3", content: "Reply three", author: "Eve", createdAt: "t" }]
    })
  ];

  it("finds a reply by id and returns its parent comment + index", () => {
    const found = findReplyById("r2", comments);
    expect(found).toBeDefined();
    expect(found?.comment.id).toBe("c1");
    expect(found?.replyIndex).toBe(1);
  });

  it("returns undefined when the reply id does not exist", () => {
    expect(findReplyById("r99", comments)).toBeUndefined();
  });
});

describe("matchCardToReply", () => {
  const comments: GoogleDocComment[] = [
    makeComment({
      id: "c1",
      author: "Alice",
      content: "Root",
      replies: [
        { id: "r1", content: "First reply", author: "Bob", createdAt: "t" },
        { id: "r2", content: "Second reply", author: "Carol", createdAt: "t" }
      ]
    }),
    makeComment({
      id: "c2",
      author: "Dave",
      content: "Other root",
      replies: [{ id: "r3", content: "Third reply", author: "Eve", createdAt: "t" }]
    })
  ];

  it("matches a reply card unambiguously by author + text", () => {
    const match = matchCardToReply({ author: "Carol", text: "Second reply" }, comments);
    expect(match).toBeDefined();
    expect(match?.comment.id).toBe("c1");
    expect(match?.replyIndex).toBe(1);
  });

  it("is case-insensitive and whitespace-normalizing", () => {
    const match = matchCardToReply({ author: "BOB", text: "FIRST   reply" }, comments);
    expect(match?.comment.id).toBe("c1");
    expect(match?.replyIndex).toBe(0);
  });

  it("returns undefined when no reply matches", () => {
    expect(matchCardToReply({ author: "Ghost", text: "nothing" }, comments)).toBeUndefined();
  });

  it("returns undefined when the match is ambiguous", () => {
    const dup = [
      makeComment({
        id: "c1",
        author: "Alice",
        content: "Root",
        replies: [{ id: "r1", content: "same text", author: "Bob", createdAt: "t" }]
      }),
      makeComment({
        id: "c2",
        author: "Alice",
        content: "Other root",
        replies: [{ id: "r2", content: "same text", author: "Bob", createdAt: "t" }]
      })
    ];
    expect(matchCardToReply({ author: "Bob", text: "same text" }, dup)).toBeUndefined();
  });
});

describe("markCardSynced / isCardSynced", () => {
  it("round-trips the synced marker", () => {
    const card = makeCard(`<div class="docos-docoview-replycontainer"></div>`);
    expect(isCardSynced(card)).toBe(false);
    markCardSynced(card);
    expect(isCardSynced(card)).toBe(true);
  });

  it("is idempotent to call markCardSynced twice", () => {
    const card = makeCard(`<div class="docos-docoview-replycontainer"></div>`);
    markCardSynced(card);
    markCardSynced(card);
    expect(isCardSynced(card)).toBe(true);
  });
});

describe("findReplyElements", () => {
  it("returns individual .docos-replyview-comment children when present", () => {
    const card = makeCard(`
      <div class="docos-docoview-replycontainer">
        <div class="docos-replyview-comment">
          <span class="docos-author">Alice</span>
          <span class="docos-body">Root comment</span>
        </div>
        <div class="docos-replyview-comment">
          <span class="docos-author">Bob</span>
          <span class="docos-body">Reply one</span>
        </div>
        <div class="docos-replyview-comment">
          <span class="docos-author">Carol</span>
          <span class="docos-body">Reply two</span>
        </div>
      </div>
    `);
    const elements = findReplyElements(card);
    expect(elements).toHaveLength(3);
    const [e0, e1, e2] = elements;
    expect(e0).toBeDefined();
    expect(e1).toBeDefined();
    expect(e2).toBeDefined();
    if (e0) expect(extractCardAuthor(e0)).toBe("Alice");
    if (e1) expect(extractCardAuthor(e1)).toBe("Bob");
    if (e2) expect(extractCardAuthor(e2)).toBe("Carol");
  });

  it("falls back to the card itself when no reply elements exist", () => {
    const card = makeCard(`
      <div class="docos-docoview-replycontainer">
        <div class="docos-author">Jane Doe</div>
        <div class="docos-replyview-body">Single comment</div>
      </div>
    `);
    const elements = findReplyElements(card);
    expect(elements).toHaveLength(1);
    expect(elements[0]).toBe(card);
  });
});

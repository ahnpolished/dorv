import { describe, expect, it } from "vitest";
import {
  buildDocUrl,
  buildDocsMarker,
  extractDocsFromBotComment,
  parseDocId
} from "../apps/extension/lib/gdoc/urls.js";

describe("buildDocsMarker / extractDocsFromBotComment", () => {
  it("round-trips a multi-file mapping", () => {
    const docs = [
      { filename: "docs/a.md", docId: "docA123", docUrl: buildDocUrl("docA123") },
      { filename: "docs/b.md", docId: "docB456", docUrl: buildDocUrl("docB456") }
    ];
    const marker = buildDocsMarker(docs);
    const body = `🤖 **dorv** has created linked Google Docs:\n\n${marker}`;
    expect(extractDocsFromBotComment(body)).toEqual(docs);
  });

  it("round-trips a single-file mapping", () => {
    const docs = [{ filename: "README.md", docId: "abc", docUrl: buildDocUrl("abc") }];
    const body = buildDocsMarker(docs);
    expect(extractDocsFromBotComment(body)).toEqual(docs);
  });

  it("parses the legacy single-doc marker into a one-entry array", () => {
    const body =
      "<!-- dorv-doc-id=legacyDocId -->\n🤖 **dorv** has created a linked Google Doc for review:\n\n[PR #1](https://docs.google.com/document/d/legacyDocId/edit)";
    expect(extractDocsFromBotComment(body)).toEqual([
      {
        filename: "__legacy__",
        docId: "legacyDocId",
        docUrl: "https://docs.google.com/document/d/legacyDocId/edit"
      }
    ]);
  });

  it("returns undefined when no marker is present", () => {
    expect(extractDocsFromBotComment("just a regular PR comment")).toBeUndefined();
  });

  it("returns undefined for malformed multi-doc JSON with no legacy fallback", () => {
    const body = "<!-- dorv-docs={not valid json} -->";
    expect(extractDocsFromBotComment(body)).toBeUndefined();
  });
});

describe("parseDocId", () => {
  it("extracts the doc id from a docs.google.com URL", () => {
    expect(parseDocId("https://docs.google.com/document/d/xyz789/edit")).toBe("xyz789");
  });
});

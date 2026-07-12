import { describe, expect, it } from "vitest";
import {
  buildGHSourceMarker,
  extractDocMarkerFromGHBody,
  extractGHCommentIdFromMirroredBody
} from "../apps/extension/lib/adapters/dedup.js";

describe("extractGHCommentIdFromMirroredBody", () => {
  it("recovers the GH comment id from a mirrored body", () => {
    const body =
      "[GitHub: @alice] Please fix this\n\n[View on GitHub](https://github.com/o/r/pull/1#discussion_r123456)";
    expect(extractGHCommentIdFromMirroredBody(body)).toBe(123456);
  });

  it("returns undefined when no GitHub link is present", () => {
    expect(extractGHCommentIdFromMirroredBody("just a plain doc comment")).toBeUndefined();
  });

  it("returns undefined for a malformed discussion id", () => {
    expect(
      extractGHCommentIdFromMirroredBody("[View on GitHub](https://github.com/o/r#discussion_r)")
    ).toBeUndefined();
  });
});

describe("buildGHSourceMarker / extractDocMarkerFromGHBody", () => {
  it("round-trips a doc comment id through the marker", () => {
    const marker = buildGHSourceMarker("AAAA1234-doc-comment-id");
    expect(marker).toBe("<!-- dorv-src=doc:AAAA1234-doc-comment-id -->");
    expect(extractDocMarkerFromGHBody(`> quoted text\n\n${marker}`)).toBe(
      "AAAA1234-doc-comment-id"
    );
  });

  it("returns undefined when no marker is present", () => {
    expect(extractDocMarkerFromGHBody("no marker here")).toBeUndefined();
  });

  it("extracts marker from a body containing other HTML comments", () => {
    const body = "<!-- unrelated --> body text <!-- dorv-src=doc:xyz123 -->";
    expect(extractDocMarkerFromGHBody(body)).toBe("xyz123");
  });
});

import { describe, expect, it } from "vitest";
import { generateGDocHtml } from "../apps/extension/lib/gdoc/template.js";

describe("generateGDocHtml", () => {
  it("renders PR metadata and markdown content", () => {
    const input = {
      title: "Test PR",
      author: "alice",
      prUrl: "https://github.com/org/repo/pull/1",
      files: [{ filename: "README.md", html: "<p>Hello</p>" }]
    };
    const html = generateGDocHtml(input);
    expect(html).toContain("Test PR");
    expect(html).toContain("alice");
    expect(html).toContain("README.md");
    expect(html).toContain("<p>Hello</p>");
  });
});

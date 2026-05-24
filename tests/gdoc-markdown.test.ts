import { describe, expect, it } from "vitest";
import {
  buildMermaidImageUrl,
  renderMarkdownToGDocHtml
} from "../apps/extension/lib/gdoc/markdown.js";

describe("renderMarkdownToGDocHtml", () => {
  it("renders plain markdown with standard HTML", async () => {
    const html = await renderMarkdownToGDocHtml("# RFC\n\nHello world");

    expect(html).toContain("<h1>RFC</h1>");
    expect(html).toContain("<p>Hello world</p>");
  });

  it("replaces mermaid fenced code blocks with mermaid.ink images", async () => {
    const markdown = [
      "# Architecture",
      "",
      "```mermaid",
      "flowchart TD",
      "  A[GitHub] --> B[Google Docs]",
      "```"
    ].join("\n");

    const html = await renderMarkdownToGDocHtml(markdown);
    const expectedUrl = buildMermaidImageUrl("flowchart TD\n  A[GitHub] --> B[Google Docs]");

    expect(html).toContain('<img src="' + expectedUrl + '"');
    expect(html).toContain('alt="Mermaid diagram for Architecture"');
    expect(html).not.toContain("language-mermaid");
    expect(html).not.toContain("<code>flowchart TD");
  });
});

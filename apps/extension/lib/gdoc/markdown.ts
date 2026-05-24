import { marked } from "marked";

interface MermaidBlock {
  placeholder: string;
  title: string;
  code: string;
}

export async function renderMarkdownToGDocHtml(markdown: string): Promise<string> {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const blocks: MermaidBlock[] = [];
  const processedLines: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim().startsWith("```mermaid")) {
      const codeLines: string[] = [];
      let cursor = index + 1;
      while (cursor < lines.length && (lines[cursor] ?? "").trim() !== "```") {
        codeLines.push(lines[cursor] ?? "");
        cursor += 1;
      }

      if (cursor >= lines.length) {
        processedLines.push(line);
        continue;
      }

      const placeholder = `DORV_MERMAID_${blocks.length.toString()}__`;
      blocks.push({
        placeholder,
        title: findNearestHeading(lines, index),
        code: codeLines.join("\n").trim()
      });
      processedLines.push(placeholder);
      index = cursor;
      continue;
    }

    processedLines.push(line);
  }

  let html = await marked.parse(processedLines.join("\n"));

  for (const block of blocks) {
    const rendered = renderMermaidBlock(block.code, block.title);
    html = html
      .replace(`<p>${block.placeholder}</p>`, rendered)
      .replace(block.placeholder, rendered);
  }

  return html;
}

export function buildMermaidImageUrl(diagram: string): string {
  return `https://mermaid.ink/img/${encodeBase64Utf8(diagram.trim())}`;
}

function renderMermaidBlock(diagram: string, title: string): string {
  const alt = escapeHtml(`Mermaid diagram for ${title}`);
  const src = escapeHtml(buildMermaidImageUrl(diagram));
  return `<figure class="dorv-mermaid"><img src="${src}" alt="${alt}" /></figure>`;
}

function findNearestHeading(lines: string[], beforeIndex: number): string {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const line = (lines[index] ?? "").trim();
    const match = /^(#+)\s+(.+)$/.exec(line);
    if (match?.[2]) {
      return match[2].trim();
    }
  }

  return "diagram";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  if (typeof btoa === "function") {
    return btoa(binary);
  }

  return Buffer.from(bytes).toString("base64");
}

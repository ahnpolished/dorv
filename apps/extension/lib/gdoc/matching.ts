export interface LineMatch {
  path: string;
  line: number;
}

export function findLineMatch(
  quotedText: string,
  files: { filename: string; content: string }[]
): LineMatch[] {
  const matches: LineMatch[] = [];
  const cleanQuote = quotedText.trim();
  if (!cleanQuote) return [];
  const normalizedQuote = normalizeMarkdownText(cleanQuote);

  for (const file of files) {
    const lines = file.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]?.includes(cleanQuote)) {
        matches.push({ path: file.filename, line: i + 1 });
        continue;
      }

      if (normalizedQuote && normalizeMarkdownText(lines[i] ?? "").includes(normalizedQuote)) {
        addMatch(matches, file.filename, i + 1);
      }
    }

    const normalizedFile = normalizeFileForMatch(lines);
    for (const startLine of findNormalizedMatches(normalizedQuote, normalizedFile)) {
      addMatch(matches, file.filename, startLine);
    }
  }
  return matches;
}

function addMatch(matches: LineMatch[], path: string, line: number): void {
  if (!matches.some((match) => match.path === path && match.line === line)) {
    matches.push({ path, line });
  }
}

function findNormalizedMatches(
  normalizedQuote: string,
  normalizedFile: { text: string; lineByChar: number[] }
): number[] {
  if (!normalizedQuote) return [];

  const lines: number[] = [];
  let fromIndex = 0;
  while (fromIndex < normalizedFile.text.length) {
    const matchIndex = normalizedFile.text.indexOf(normalizedQuote, fromIndex);
    if (matchIndex === -1) break;
    const line = normalizedFile.lineByChar[matchIndex];
    if (line !== undefined && !lines.includes(line)) {
      lines.push(line);
    }
    fromIndex = matchIndex + normalizedQuote.length;
  }
  return lines;
}

function normalizeFileForMatch(lines: string[]): { text: string; lineByChar: number[] } {
  let text = "";
  const lineByChar: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const normalizedLine = normalizeMarkdownText(lines[i] ?? "");
    if (!normalizedLine) continue;

    if (text) {
      text += " ";
      lineByChar.push(i + 1);
    }

    text += normalizedLine;
    lineByChar.push(...Array.from<number>({ length: normalizedLine.length }).map(() => i + 1));
  }

  return { text, lineByChar };
}

function normalizeMarkdownText(value: string): string {
  return normalizeText(stripMarkdownSyntax(value));
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripMarkdownSyntax(value: string): string {
  return value
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/u, "")
        .replace(/^\s{0,3}>\s?/u, "")
        .replace(/^\s{0,3}(?:[-*+]|\d+\.)\s+/u, "")
        .replace(/!\[([^\]]*)\]\([^)]+\)/gu, "$1")
        .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
        .replace(/[`*_~]/gu, "")
    )
    .join("\n");
}

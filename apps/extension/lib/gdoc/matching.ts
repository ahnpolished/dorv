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
  const normalizedQuote = normalizeText(cleanQuote);

  for (const file of files) {
    const lines = file.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]?.includes(cleanQuote)) {
        matches.push({ path: file.filename, line: i + 1 });
        continue;
      }

      if (normalizedQuote && normalizeText(lines[i] ?? "").includes(normalizedQuote)) {
        matches.push({ path: file.filename, line: i + 1 });
      }
    }
  }
  return matches;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

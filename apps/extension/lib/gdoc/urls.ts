export function parseDocId(url: string): string | undefined {
  const match = /\/document\/d\/([a-zA-Z0-9_-]+)/.exec(url);
  return match?.[1];
}

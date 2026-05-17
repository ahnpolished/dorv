export function parseDocId(url: string): string | undefined {
  const match = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  return match?.[1];
}

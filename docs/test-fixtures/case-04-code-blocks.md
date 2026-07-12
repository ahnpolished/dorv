# Code Block Fixture

Inline code: `syncOnce(docId, prNumber)` should be preserved verbatim.

Fenced block with a language tag:

```ts
async function syncOnce(docId: string, prNumber: number): Promise<void> {
  const doc = await fetchGDoc(docId);
  await writeToBranch(prNumber, doc);
}
```

Fenced block with no language tag:

```
plain text inside a fence, no syntax highlighting
```

Indented code block (4-space, not fenced):

    const legacy = true;

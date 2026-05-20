const DEBOUNCE_MS = 500;

interface ElementLike {
  id?: string;
  hasAttribute?: (attr: string) => boolean;
  classList?: { contains: (cls: string) => boolean };
}

// GitHub assigns these id patterns to comment elements.
export function isCommentNode(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const el = node as ElementLike;
  const id = el.id ?? "";
  return (
    id.startsWith("issuecomment-") ||
    /^r\d+$/.test(id) ||
    (typeof el.hasAttribute === "function" && el.hasAttribute("data-gid")) ||
    (typeof el.classList?.contains === "function" && el.classList.contains("js-comment"))
  );
}

export interface ObserverDeps {
  document: Pick<Document, "addEventListener" | "removeEventListener">;
  MutationObserver: typeof MutationObserver;
  body: Node;
}

/**
 * Watches the GitHub PR page for newly posted comments and fires `onNewComment`
 * (debounced) when one is detected. Returns a cleanup function.
 *
 * Two signals are combined:
 *   1. `turbo:before-stream-render` — GitHub fires this when a Turbo Stream
 *      response updates the DOM (e.g. after submitting a review comment).
 *   2. MutationObserver — catches any DOM-level comment additions that Turbo
 *      didn't announce (e.g. via React or direct XHR).
 */
export function watchForNewGHComments(
  onNewComment: () => void,
  {
    debounceMs = DEBOUNCE_MS,
    deps = {
      document,
      MutationObserver,
      body: document.body
    }
  }: { debounceMs?: number; deps?: ObserverDeps } = {}
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onNewComment();
    }, debounceMs);
  };

  const onTurbo = () => {
    schedule();
  };
  deps.document.addEventListener("turbo:before-stream-render", onTurbo);

  const observer = new deps.MutationObserver((mutations: MutationRecord[]) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (isCommentNode(node)) {
          schedule();
          return;
        }
      }
    }
  });

  observer.observe(deps.body, { childList: true, subtree: true });

  return () => {
    deps.document.removeEventListener("turbo:before-stream-render", onTurbo);
    observer.disconnect();
    if (timer !== null) clearTimeout(timer);
  };
}

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  watchForNewGHComments,
  isCommentNode,
  type ObserverDeps
} from "../apps/extension/lib/github/comment-observer.js";

// ─── minimal fakes ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener = (...args: any[]) => void;

function makeFakeDocument() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    addEventListener(type: string, fn: Listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      const set = listeners.get(type);
      if (set) set.add(fn);
    },
    removeEventListener(type: string, fn: Listener) {
      listeners.get(type)?.delete(fn);
    },
    dispatch(type: string) {
      listeners.get(type)?.forEach((fn) => {
        fn();
      });
    }
  };
}

type MutationCb = (mutations: MutationRecord[]) => void;

function makeFakeMutationObserver() {
  let cb: MutationCb | null = null;
  let disconnected = false;

  const Ctor = vi.fn((fn: MutationCb) => {
    cb = fn;
    return {
      observe: vi.fn(),
      disconnect: vi.fn(() => {
        disconnected = true;
      })
    };
  });

  return {
    Ctor: Ctor as unknown as typeof MutationObserver,
    fireAddedNodes(nodes: Node[]) {
      cb?.([{ addedNodes: nodes, type: "childList" } as unknown as MutationRecord]);
    },
    get disconnected() {
      return disconnected;
    }
  };
}

function makeElement(id: string) {
  return { id, hasAttribute: () => false, classList: { contains: () => false } } as unknown as Node;
}

function makeDeps(
  doc: ReturnType<typeof makeFakeDocument>,
  mo: ReturnType<typeof makeFakeMutationObserver>
): ObserverDeps {
  return { document: doc, MutationObserver: mo.Ctor, body: {} as Node };
}

// ─── isCommentNode ────────────────────────────────────────────────────────────

describe("isCommentNode", () => {
  it("accepts issuecomment- elements", () => {
    expect(isCommentNode(makeElement("issuecomment-123"))).toBe(true);
  });

  it("accepts r<digits> review elements", () => {
    expect(isCommentNode(makeElement("r987654321"))).toBe(true);
  });

  it("rejects unrelated elements", () => {
    expect(isCommentNode(makeElement("some-other-id"))).toBe(false);
  });

  it("rejects null / primitive nodes", () => {
    expect(isCommentNode(null)).toBe(false);
    expect(isCommentNode("issuecomment-1")).toBe(false);
  });
});

// ─── watchForNewGHComments ───────────────────────────────────────────────────

describe("watchForNewGHComments", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires after debounce when turbo event fires", () => {
    const cb = vi.fn();
    const doc = makeFakeDocument();
    const mo = makeFakeMutationObserver();
    const stop = watchForNewGHComments(cb, { debounceMs: 100, deps: makeDeps(doc, mo) });

    doc.dispatch("turbo:before-stream-render");
    expect(cb).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(cb).toHaveBeenCalledOnce();

    stop();
  });

  it("debounces rapid turbo events into a single call", () => {
    const cb = vi.fn();
    const doc = makeFakeDocument();
    const mo = makeFakeMutationObserver();
    const stop = watchForNewGHComments(cb, { debounceMs: 100, deps: makeDeps(doc, mo) });

    doc.dispatch("turbo:before-stream-render");
    vi.advanceTimersByTime(50);
    doc.dispatch("turbo:before-stream-render");
    vi.advanceTimersByTime(50);
    doc.dispatch("turbo:before-stream-render");
    vi.advanceTimersByTime(100);

    expect(cb).toHaveBeenCalledOnce();
    stop();
  });

  it("fires when an issuecomment- node is added via MutationObserver", () => {
    const cb = vi.fn();
    const doc = makeFakeDocument();
    const mo = makeFakeMutationObserver();
    const stop = watchForNewGHComments(cb, { debounceMs: 100, deps: makeDeps(doc, mo) });

    mo.fireAddedNodes([makeElement("issuecomment-999")]);
    vi.advanceTimersByTime(100);
    expect(cb).toHaveBeenCalledOnce();

    stop();
  });

  it("does not fire for unrelated DOM mutations", () => {
    const cb = vi.fn();
    const doc = makeFakeDocument();
    const mo = makeFakeMutationObserver();
    const stop = watchForNewGHComments(cb, { debounceMs: 100, deps: makeDeps(doc, mo) });

    mo.fireAddedNodes([makeElement("unrelated-div")]);
    vi.advanceTimersByTime(100);
    expect(cb).not.toHaveBeenCalled();

    stop();
  });

  it("stops firing after cleanup", () => {
    const cb = vi.fn();
    const doc = makeFakeDocument();
    const mo = makeFakeMutationObserver();
    const stop = watchForNewGHComments(cb, { debounceMs: 100, deps: makeDeps(doc, mo) });

    stop();
    doc.dispatch("turbo:before-stream-render");
    vi.advanceTimersByTime(200);
    expect(cb).not.toHaveBeenCalled();
  });

  it("cancels a pending debounce on cleanup", () => {
    const cb = vi.fn();
    const doc = makeFakeDocument();
    const mo = makeFakeMutationObserver();
    const stop = watchForNewGHComments(cb, { debounceMs: 100, deps: makeDeps(doc, mo) });

    doc.dispatch("turbo:before-stream-render");
    vi.advanceTimersByTime(50);
    stop();
    vi.advanceTimersByTime(200);
    expect(cb).not.toHaveBeenCalled();
  });

  it("disconnects the MutationObserver on cleanup", () => {
    const cb = vi.fn();
    const doc = makeFakeDocument();
    const mo = makeFakeMutationObserver();
    const stop = watchForNewGHComments(cb, { debounceMs: 100, deps: makeDeps(doc, mo) });

    expect(mo.disconnected).toBe(false);
    stop();
    expect(mo.disconnected).toBe(true);
  });
});

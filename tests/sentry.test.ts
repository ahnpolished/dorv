import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  const initMock = vi.fn();
  const browserClientOptions: Record<string, unknown>[] = [];
  const captureExceptionMock = vi.fn(() => "event-id");
  const scopeInstances: MockScope[] = [];

  class MockScope {
    public readonly captureException = captureExceptionMock;
    public readonly setClient = vi.fn();
    public readonly setExtras = vi.fn();
    public readonly setTag = vi.fn();
    public readonly setTags = vi.fn();

    public constructor() {
      scopeInstances.push(this);
    }

    public clone(): MockScope {
      return new MockScope();
    }
  }

  class MockBrowserClient {
    public constructor(options: Record<string, unknown>) {
      browserClientOptions.push(options);
    }

    public init = initMock;
  }

  return {
    BrowserClient: MockBrowserClient,
    Scope: MockScope,
    browserClientOptions,
    captureExceptionMock,
    defaultStackParser: "stack-parser",
    getDefaultIntegrations: vi.fn(() => [
      { name: "Breadcrumbs" },
      { name: "GlobalHandlers" },
      { name: "HttpContext" }
    ]),
    initMock,
    makeFetchTransport: "fetch-transport",
    scopeInstances
  };
});

vi.mock("@sentry/browser", () => ({
  BrowserClient: hoisted.BrowserClient,
  Scope: hoisted.Scope,
  defaultStackParser: hoisted.defaultStackParser,
  getDefaultIntegrations: hoisted.getDefaultIntegrations,
  makeFetchTransport: hoisted.makeFetchTransport
}));

import {
  captureExtensionException,
  initSentryForSurface,
  resetSentryForTests,
  resolveSentryRuntimeConfig
} from "../apps/extension/lib/telemetry/sentry.js";

describe("Sentry telemetry", () => {
  beforeEach(() => {
    hoisted.initMock.mockClear();
    hoisted.captureExceptionMock.mockClear();
    hoisted.getDefaultIntegrations.mockClear();
    hoisted.browserClientOptions.length = 0;
    hoisted.scopeInstances.length = 0;
    resetSentryForTests();
    globalThis.chrome = {
      runtime: {
        getManifest: () => ({ version: "0.1.1" })
      }
    } as unknown as typeof chrome;
  });

  it("skips runtime configuration when no DSN is provided", () => {
    expect(
      resolveSentryRuntimeConfig({
        env: { MODE: "test", WXT_SENTRY_DSN: "" },
        manifestVersion: "0.1.1",
        surface: "background"
      })
    ).toBeUndefined();
  });

  it("builds runtime configuration from extension env", () => {
    const config = resolveSentryRuntimeConfig({
      env: {
        MODE: "production",
        WXT_SENTRY_DSN: "https://examplePublicKey@o0.ingest.sentry.io/0",
        WXT_SENTRY_ENVIRONMENT: "staging"
      },
      manifestVersion: "0.1.1",
      surface: "gdoc-buttons"
    });

    expect(config).toEqual({
      dsn: "https://examplePublicKey@o0.ingest.sentry.io/0",
      environment: "staging",
      manifestVersion: "0.1.1",
      release: "dorv-extension@0.1.1",
      surface: "gdoc-buttons"
    });
  });

  it("initializes each surface at most once with extension-safe defaults", () => {
    const initializedFirst = initSentryForSurface("background", {
      env: {
        MODE: "production",
        WXT_SENTRY_DSN: "https://examplePublicKey@o0.ingest.sentry.io/0"
      }
    });
    const initializedSecond = initSentryForSurface("background", {
      env: {
        MODE: "production",
        WXT_SENTRY_DSN: "https://examplePublicKey@o0.ingest.sentry.io/0"
      }
    });

    expect(initializedFirst).toBe(true);
    expect(initializedSecond).toBe(false);
    expect(hoisted.initMock).toHaveBeenCalledTimes(1);
    expect(hoisted.getDefaultIntegrations).toHaveBeenCalledWith({});
    expect(hoisted.browserClientOptions[0]).toMatchObject({
      dsn: "https://examplePublicKey@o0.ingest.sentry.io/0",
      environment: "production",
      release: "dorv-extension@0.1.1",
      stackParser: "stack-parser",
      transport: "fetch-transport"
    });
    expect(hoisted.browserClientOptions[0]?.integrations).toEqual([{ name: "HttpContext" }]);

    const baseScope = hoisted.scopeInstances[0];
    expect(baseScope?.setTag).toHaveBeenCalledWith("surface", "background");
    expect(baseScope?.setTag).toHaveBeenCalledWith("extension_version", "0.1.1");
  });

  it("does not require browser manifest support when runtime telemetry is disabled", () => {
    globalThis.chrome = {
      runtime: {
        getManifest: () => {
          throw new Error("not implemented");
        }
      }
    } as unknown as typeof chrome;

    expect(
      initSentryForSurface("options", {
        env: {
          MODE: "test",
          WXT_SENTRY_DSN: ""
        }
      })
    ).toBe(false);
    expect(hoisted.initMock).not.toHaveBeenCalled();
  });

  it("captures handled exceptions with extension metadata", () => {
    const error = new Error("sync failed");

    initSentryForSurface("github-buttons", {
      env: {
        MODE: "production",
        WXT_SENTRY_DSN: "https://examplePublicKey@o0.ingest.sentry.io/0"
      },
      manifestVersion: "0.1.1"
    });

    captureExtensionException(error, {
      extra: { repo: "ahnpolished/dorv" },
      surface: "github-buttons",
      tags: { operation: "sync_now" }
    });

    const captureScope = hoisted.scopeInstances[1];
    expect(captureScope?.setTag).toHaveBeenCalledWith("surface", "github-buttons");
    expect(captureScope?.setTags).toHaveBeenCalledWith({ operation: "sync_now" });
    expect(captureScope?.setExtras).toHaveBeenCalledWith({ repo: "ahnpolished/dorv" });
    expect(hoisted.captureExceptionMock).toHaveBeenCalledWith(error);
  });

  it("throttles duplicate errors within the window", () => {
    const error = new Error("rate limited error");

    initSentryForSurface("background", {
      env: {
        MODE: "production",
        WXT_SENTRY_DSN: "https://examplePublicKey@o0.ingest.sentry.io/0"
      }
    });

    captureExtensionException(error, { surface: "background", tags: { operation: "poll" } });
    captureExtensionException(error, { surface: "background", tags: { operation: "poll" } });
    captureExtensionException(error, { surface: "background", tags: { operation: "poll" } });

    expect(hoisted.captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it("does not throttle the same error from different surfaces or operations", () => {
    const error = new Error("multi-surface error");
    const dsn = "https://examplePublicKey@o0.ingest.sentry.io/0";

    initSentryForSurface("background", { env: { MODE: "production", WXT_SENTRY_DSN: dsn } });
    initSentryForSurface("gdoc-buttons", { env: { MODE: "production", WXT_SENTRY_DSN: dsn } });

    captureExtensionException(error, { surface: "background", tags: { operation: "a" } });
    captureExtensionException(error, { surface: "gdoc-buttons", tags: { operation: "a" } });
    captureExtensionException(error, { surface: "background", tags: { operation: "b" } });

    expect(hoisted.captureExceptionMock).toHaveBeenCalledTimes(3);
  });
});

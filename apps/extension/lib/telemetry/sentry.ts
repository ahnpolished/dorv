import {
  BrowserClient,
  Scope,
  defaultStackParser,
  getDefaultIntegrations,
  makeFetchTransport
} from "@sentry/browser";

export type SentrySurface = "background" | "github-buttons" | "gdoc-buttons" | "options";

interface SentryEnv {
  MODE?: string;
  WXT_SENTRY_DSN?: string;
  WXT_SENTRY_ENVIRONMENT?: string;
}

interface ResolveSentryRuntimeConfigInput {
  env?: SentryEnv;
  manifestVersion: string;
  surface: SentrySurface;
}

interface CaptureExtensionExceptionInput {
  extra?: Record<string, unknown>;
  surface: SentrySurface;
  tags?: Record<string, string>;
}

interface SentryRuntimeConfig {
  dsn: string;
  environment: string;
  manifestVersion: string;
  release: string;
  surface: SentrySurface;
}

const disabledDefaultIntegrations = new Set([
  "BrowserApiErrors",
  "BrowserSession",
  "Breadcrumbs",
  "ConversationId",
  "FunctionToString",
  "GlobalHandlers"
]);

const initializedSurfaces = new Set<SentrySurface>();
const surfaceScopes = new Map<SentrySurface, Scope>();

const THROTTLE_WINDOW_MS = 60_000;
const THROTTLE_MAP_MAX = 200;
// fingerprint → timestamp of last sent event
const errorThrottle = new Map<string, number>();

function buildFingerprint(
  error: unknown,
  surface: SentrySurface,
  tags?: Record<string, string>
): string {
  const name = error instanceof Error ? error.name : "UnknownError";
  const message =
    error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200);
  const operation = tags?.operation ?? "";
  return `${surface}::${name}::${message}::${operation}`;
}

function isThrottled(fingerprint: string, now: number): boolean {
  const last = errorThrottle.get(fingerprint);
  if (last !== undefined && now - last < THROTTLE_WINDOW_MS) {
    return true;
  }

  // Sweep stale entries when map is at capacity
  if (errorThrottle.size >= THROTTLE_MAP_MAX) {
    for (const [key, ts] of errorThrottle) {
      if (now - ts >= THROTTLE_WINDOW_MS) {
        errorThrottle.delete(key);
      }
    }
    // Evict oldest if still at capacity
    if (errorThrottle.size >= THROTTLE_MAP_MAX) {
      const oldest = [...errorThrottle.entries()].sort((a, b) => a[1] - b[1])[0];
      if (oldest) errorThrottle.delete(oldest[0]);
    }
  }

  errorThrottle.set(fingerprint, now);
  return false;
}

function resolveManifestVersion(explicitManifestVersion?: string): string {
  if (explicitManifestVersion) {
    return explicitManifestVersion;
  }

  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return "unknown";
  }
}

function createSurfaceScope({
  dsn,
  environment,
  manifestVersion,
  release,
  surface
}: SentryRuntimeConfig): Scope {
  const integrations = getDefaultIntegrations({}).filter(
    (integration) => !disabledDefaultIntegrations.has(integration.name)
  );

  const client = new BrowserClient({
    dsn,
    environment,
    integrations,
    release,
    stackParser: defaultStackParser,
    transport: makeFetchTransport
  });
  const scope = new Scope();

  scope.setClient(client);
  scope.setTag("surface", surface);
  scope.setTag("extension_version", manifestVersion);
  client.init();

  return scope;
}

export function resolveSentryRuntimeConfig({
  env,
  manifestVersion,
  surface
}: ResolveSentryRuntimeConfigInput): SentryRuntimeConfig | undefined {
  const resolvedEnv = env ?? (import.meta as unknown as { env?: SentryEnv }).env;
  const dsn = resolvedEnv?.WXT_SENTRY_DSN?.trim();

  if (!dsn) {
    return undefined;
  }

  const environment =
    resolvedEnv?.WXT_SENTRY_ENVIRONMENT?.trim() ?? resolvedEnv?.MODE ?? "development";

  return {
    dsn,
    environment,
    manifestVersion,
    release: `dorv-extension@${manifestVersion}`,
    surface
  };
}

export function initSentryForSurface(
  surface: SentrySurface,
  options?: { env?: SentryEnv; manifestVersion?: string }
): boolean {
  if (initializedSurfaces.has(surface)) {
    return false;
  }

  const resolvedManifestVersion = resolveManifestVersion(options?.manifestVersion);
  const config = resolveSentryRuntimeConfig(
    options?.env
      ? {
          env: options.env,
          manifestVersion: resolvedManifestVersion,
          surface
        }
      : {
          manifestVersion: resolvedManifestVersion,
          surface
        }
  );

  if (!config) {
    return false;
  }

  const scope = createSurfaceScope(config);
  initializedSurfaces.add(surface);
  surfaceScopes.set(surface, scope);
  return true;
}

export function captureExtensionException(
  error: unknown,
  { extra, surface, tags }: CaptureExtensionExceptionInput
): void {
  const baseScope = surfaceScopes.get(surface);

  if (!baseScope) {
    return;
  }

  const fingerprint = buildFingerprint(error, surface, tags);
  if (isThrottled(fingerprint, Date.now())) {
    return;
  }

  const captureScope = baseScope.clone();
  captureScope.setTag("surface", surface);

  if (tags) {
    captureScope.setTags(tags);
  }

  if (extra) {
    captureScope.setExtras(extra);
  }

  captureScope.captureException(error);
}

export function resetSentryForTests(): void {
  initializedSurfaces.clear();
  surfaceScopes.clear();
  errorThrottle.clear();
}

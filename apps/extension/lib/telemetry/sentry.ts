import {
  BrowserClient,
  Scope,
  defaultStackParser,
  getDefaultIntegrations,
  makeFetchTransport
} from "@sentry/browser";

export type SentrySurface = "background" | "github-sidebar" | "options" | "sidepanel";

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
}

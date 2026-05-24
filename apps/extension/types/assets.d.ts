/// <reference types="vite/client" />

declare module "*.css?inline" {
  const content: string;
  export default content;
}

interface ImportMetaEnv {
  readonly WXT_SENTRY_DSN?: string;
  readonly WXT_SENTRY_ENVIRONMENT?: string;
}

export const bootstrapChecks = [
  "workspace",
  "lint",
  "typecheck",
  "test",
  "pre-commit",
  "ci"
] as const;

export type BootstrapCheck = (typeof bootstrapChecks)[number];

export function hasBootstrapCheck(check: string): check is BootstrapCheck {
  return bootstrapChecks.includes(check as BootstrapCheck);
}

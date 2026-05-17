export type OnboardingStep = { step: "github" } | { step: "google" } | null;

export function buildOnboardingStep(
  hasGithubPat: boolean,
  hasGoogleToken: boolean
): OnboardingStep {
  if (!hasGithubPat) return { step: "github" };
  if (!hasGoogleToken) return { step: "google" };
  return null;
}

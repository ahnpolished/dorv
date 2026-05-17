import { describe, expect, it } from "vitest";
import { buildOnboardingStep } from "../apps/extension/lib/onboarding/model.js";

describe("HUM-1207 onboarding step", () => {
  it("returns github step when no PAT is set", () => {
    expect(buildOnboardingStep(false, false)).toEqual({ step: "github" });
  });

  it("returns google step when PAT is set but no Google token", () => {
    expect(buildOnboardingStep(true, false)).toEqual({ step: "google" });
  });

  it("returns null when both credentials are present", () => {
    expect(buildOnboardingStep(true, true)).toEqual(null);
  });

  it("returns github step even when Google token is somehow present but PAT is not", () => {
    expect(buildOnboardingStep(false, true)).toEqual({ step: "github" });
  });
});

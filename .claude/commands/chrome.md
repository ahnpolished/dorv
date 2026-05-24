---
description: Build the extension and run E2E tests, then report pass/fail inline
argument-hint: Optional spec file or grep pattern (e.g. smoke, sidebar-detection)
---

# Chrome Extension E2E Test Runner

Run the dorv Chrome extension E2E suite and summarize results.

## Steps

1. **Build the extension** — run `pnpm e2e:build` from the repo root. If the build fails, stop and report the error; do not continue to the test step.

2. **Run E2E tests** — run `pnpm run e2e $ARGUMENTS` from the repo root.
   - If `$ARGUMENTS` is provided, pass it as `--grep "$ARGUMENTS"` to filter specs.
   - Capture stdout and stderr.

3. **Report results** inline:
   - If all tests pass: one line — "All N tests passed (Xs)."
   - If any tests fail:
     - List each failing test: spec file + test title + failure message (first 5 lines of the error).
     - End with: "N/M tests passed."
   - If the build failed, show the last 20 lines of build output.

Keep the report concise. Do not repeat passing test names.

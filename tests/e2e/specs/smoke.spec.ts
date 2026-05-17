/**
 * AC #1: Extension installs; service worker starts without errors.
 */
import { expect, test } from "../fixtures/extension.js";

test("extension loads and service worker registers", ({ extensionWorker }) => {
  expect(extensionWorker.url()).toContain("chrome-extension://");
  expect(extensionWorker.url()).toContain("background");
});

test("extension ID is a valid 32-char ID", ({ extensionId }) => {
  expect(extensionId).toMatch(/^[a-z]{32}$/);
});

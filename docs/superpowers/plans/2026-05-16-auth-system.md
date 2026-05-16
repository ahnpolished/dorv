# Auth System (HUM-1204) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a secure and reliable authentication layer with a centralized `AuthStore` and an options page UI.

**Architecture:** A storage-first approach where `AuthStore` abstracts `chrome.storage.local` and `chrome.identity`. React-based options page for configuration.

**Tech Stack:** TypeScript, React, WXT, Vitest, chrome.storage API, chrome.identity API.

---

### Task 1: AuthStore - GitHub implementation

**Files:**
- Create: `apps/extension/lib/storage/auth.ts`
- Create: `tests/storage-auth.test.ts`

- [ ] **Step 1: Write the failing test for GitHub token storage**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement minimal AuthStore with GitHub support**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

---

### Task 2: AuthStore - Backend URL support

**Files:**
- Modify: `apps/extension/lib/storage/auth.ts`
- Modify: `tests/storage-auth.test.ts`

- [ ] **Step 1: Write the failing test for Backend URL**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement Backend URL methods**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

---

### Task 3: AuthStore - Google OAuth (chrome.identity)

**Files:**
- Modify: `apps/extension/lib/storage/auth.ts`
- Modify: `tests/storage-auth.test.ts`

- [ ] **Step 1: Write the failing test for Google OAuth**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement Google OAuth methods**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

---

### Task 4: Options Page Scaffolding

**Files:**
- Create: `apps/extension/entrypoints/options.html`
- Create: `apps/extension/src/options.tsx`
- Create: `apps/extension/src/options.css`

- [ ] **Step 1: Create the HTML entrypoint**
- [ ] **Step 2: Create the React entrypoint**
- [ ] **Step 3: Create basic styles**
- [ ] **Step 4: Verify build detects new entrypoint**
- [ ] **Step 5: Commit**

---

### Task 5: GitHub PAT Validation

**Files:**
- Modify: `apps/extension/src/options.tsx`

- [ ] **Step 1: Implement validation logic via GitHub API**
- [ ] **Step 2: Verify in browser (manual test)**
- [ ] **Step 3: Commit**


# Background Service Worker (HUM-1202) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement recurring sync polling, a unified message bus, and automated side panel management.

**Architecture:** WXT background entrypoint utilizing `chrome.alarms` for scheduling and `chrome.runtime.onMessage` for communication.

**Tech Stack:** TypeScript, WXT, chrome.alarms API, chrome.runtime API, chrome.sidePanel API.

---

### Task 1: DirectAdapter baseline syncAll

**Files:**
- Modify: `apps/extension/lib/adapters/direct.ts`
- Modify: `tests/sync-storage.test.ts`

- [ ] **Step 1: Write test for syncAll baseline**
- [ ] **Step 2: Implement syncAll in DirectAdapter**
    - Should update `lastSyncedAt` in `DocStore`.
    - Should update `StatusStore` to `idle`.
- [ ] **Step 3: Verify tests pass**
- [ ] **Step 4: Commit**

---

### Task 2: Background Alarms & Polling

**Files:**
- Modify: `apps/extension/entrypoints/background.ts`

- [ ] **Step 1: Implement alarm registration**
    - `chrome.alarms.create('sync_poll', { periodInMinutes: 2 })` on `onInstalled` and `onStartup`.
- [ ] **Step 2: Implement alarm handler**
    - Fetch active PRs from `DocStore.listActive()`.
    - Loop through and call `adapter.syncAll()`.
- [ ] **Step 3: Commit**

---

### Task 3: Unified Message Bus

**Files:**
- Modify: `apps/extension/entrypoints/background.ts`

- [ ] **Step 1: Implement runtime.onMessage listener**
    - Handle `CREATE_DOC` (calls `adapter.createDoc`).
    - Handle `SYNC_NOW` (calls `adapter.syncAll`).
    - Handle `GET_SYNC_STATUS` (calls `statusStore.get`).
- [ ] **Step 2: Commit**

---

### Task 4: Automated Side Panel

**Files:**
- Modify: `apps/extension/entrypoints/background.ts`

- [ ] **Step 1: Implement tabs.onUpdated listener**
    - Filter for Google Doc URLs.
    - Call `chrome.sidePanel.setOptions({ enabled: true })`.
- [ ] **Step 2: Commit**

---

### Task 5: Final Validation

- [ ] **Step 1: Run lint and typecheck**
- [ ] **Step 2: Verify build**
- [ ] **Step 3: Commit and Push**


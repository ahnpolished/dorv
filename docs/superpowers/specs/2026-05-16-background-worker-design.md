# Design Spec: Background Service Worker (HUM-1202)

**Status:** Draft
**Date:** 2026-05-16
**Issue:** [HUM-1202](https://linear.app/humphreyahn/issue/HUM-1202/background-service-worker-alarm-polling-and-message-bus)

## 1. Goal
Implement the core background infrastructure for the `dorv` extension, including recurring sync polling, a unified message bus for UI components, and automated side panel management.

## 2. Architecture

### 2.1 Alarms & Polling
- **Registration:** Create a persistent alarm named `sync_poll` with a 2-minute interval. Register this in both `runtime.onInstalled` and `runtime.onStartup`.
- **Handler:** `alarms.onAlarm` will:
    1. Fetch the list of active PRs from `DocStore.listActive()`.
    2. For each PR, instantiate the appropriate adapter via `resolveAdapter`.
    3. Call `adapter.syncAll()`.
    4. Handle errors per PR to ensure one failure doesn't block the entire queue.

### 2.2 Message Bus
A single `runtime.onMessage` listener will handle standard actions:
- `CREATE_DOC`: Call `adapter.createDoc(input)` and return the result.
- `SYNC_NOW`: Manually trigger `adapter.syncAll()` for a specific PR.
- `GET_SYNC_STATUS`: Fetch the latest entry from `StatusStore`.

### 2.3 Side Panel Control
- **Logic:** `tabs.onUpdated` listener checks for URLs matching `*://docs.google.com/document/d/*`.
- **Action:** If matched, call `sidePanel.setOptions({ tabId, enabled: true, path: 'sidepanel.html' })`.

## 3. Implementation Details

### 3.1 DirectAdapter Update
Implement a baseline `syncAll()` in `DirectAdapter`:
- Update `lastSyncedAt` in the `DocMapping`.
- Update the `StatusStore` with `state: "idle"` and current timestamp.

### 3.2 Error Handling
- Use `try/catch` blocks inside the polling loop.
- Errors are logged to `console.error` and persisted to `StatusStore` so the UI can display them.

## 4. Testing Plan
- **Alarm Unit Tests:** Verify alarm creation and interval configuration.
- **Message Bus Mocking:** Simulate messages from content scripts and verify the background worker's response logic.
- **Polling Loop:** Mock `DocStore.listActive` and verify `adapter.syncAll` is called for every active item.

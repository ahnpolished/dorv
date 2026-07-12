# Nested List Fixture

Ordered list with nested unordered sublist:

1. Fetch the GDoc content
   - via the Drive API
   - falling back to export-as-markdown
2. Diff against the last synced snapshot
3. Open or update the PR

Unordered list with a nested ordered sublist and a task list:

- Sync targets
  1. `main`
  2. `feature/*`
- Task checklist
  - [x] Parse GDoc
  - [ ] Resolve conflicts
  - [ ] Push commit

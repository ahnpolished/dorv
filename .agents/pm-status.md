# PM status — v0.3.0 swarm

Last updated 2026-07-04 (superseded an earlier "essentially done" read — **user corrected this: v0.3.0 is not done, has real QA problems, and the core Create Doc flow was not confirmed working**). Source of truth for task state is Linear (project `dorv`); this file is a coordination log, not a duplicate tracker.

## Verdict: v0.3.0 is NOT done

Prior QA findings existed only as chat transcript, not as tracked issues — that's exactly why they kept resurfacing across "fixed" commits without closure. They are now filed in Linear. **Open-issue count is growing (4→6) as verification digs deeper — that's expected and correct, not a sign of regressing process.**

| Issue | Priority | Problem | Status |
| --- | --- | --- | --- |
| [HUM-1409](https://linear.app/humphreyahn/issue/HUM-1409) | Urgent | Create Doc button — core PR→GDoc flow. Ref-shape bug fixed; QA confirmed a real docUrl gets created, but found a **new** hang bug (→ HUM-1414) before finalizing. | In Progress — QA (p3), blocked on HUM-1414 for full pass |
| [HUM-1410](https://linear.app/humphreyahn/issue/HUM-1410) | Urgent | Google OAuth 400 error. p2 shipped a docs-only fix + UX warning (PR #79), **self-marked Done without artifact** — reopened by PM: PR #79 e2e is still red, and the "complete a real sign-in" AC can't be executed by an autonomous agent (needs human or explicit deferral). | Reopened — awaiting CI link + sign-in-verification plan |
| [HUM-1411](https://linear.app/humphreyahn/issue/HUM-1411) | High | `FETCH_PR_INFO` regression + test coverage. p4 shipped PR #80 (new handler contract tests + console.log removal). | In Progress — PR #80 open, blocked on HUM-1413 for green e2e |
| [HUM-1412](https://linear.app/humphreyahn/issue/HUM-1412) | Urgent | `docStore.upsert` overwrite bug (found by QA mid-HUM-1409 verification) — breaks multi-doc PRs. | In Progress — p3 implementing merge fix, coordinated with p4 on file overlap (clean, no conflict) |
| [HUM-1413](https://linear.app/humphreyahn/issue/HUM-1413) | Urgent | CI infra: e2e options-page navigation broken by a Chrome redirect (`chrome-extension://.../options.html` → `chrome://extensions/?options=...`). Blocks **all 4 open PRs**' e2e checks (#70, #78, #79, #80). Found by p4 via peer alert, independently confirmed against CI logs. | Assigned to p4 — confirm actively implementing, not just monitoring |
| [HUM-1414](https://linear.app/humphreyahn/issue/HUM-1414) | Urgent | Create Doc button hangs indefinitely for some files even after HUM-1412's fix. New finding, root cause not yet identified. | p3 investigating |
| [HUM-1264](https://linear.app/humphreyahn/issue/HUM-1264) | — | "Control PR review" — batch-push comments, one-click re-request-review/approve. Never built. | Backlog, unassigned |

**PR #78 merge is held** until HUM-1409/1410/1411/1412/1413/1414 close with independent verification (not agent self-report).

## Sequencing (agreed with p2/p3/p4)

Land HUM-1413 (CI infra fix, unblocks all e2e) → HUM-1411 (#80) → HUM-1412 (docStore fix) → HUM-1409's regression test → resolve HUM-1414 → re-verify HUM-1410's sign-in gap.

## Swarm roster (herdr workspace `w1`)

| Pane | Agent | Role | Status |
| --- | --- | --- | --- |
| `w1:p2` | pi | main-worker | Alive (idle → assigned HUM-1410, awaiting ack). Was reported dead earlier by p4 but resumed/reconnected — always re-check liveness with `pane run` + wait rather than trusting a stale read. |
| `w1:p3` | claude | QA | Alive, working — re-verifying HUM-1409 live via CDP against a fresh `dev:loop` Chrome instance. |
| `w1:p4` | pi (opencode-go) | gatekeeper | Declared its own `goal_complete` under the old (incorrect) "done" premise — that verdict is now superseded. Not currently under PM direction; would need a fresh `/goal` to re-engage. |
| `w1:p5` | claude | watcher | Own independent `/goal` loop, not under this PM's direction. |
| `w1:p7` | claude (this session) | PM | Active. |

## Lesson for the playbook

An agent's "done"/self-verified fix is not evidence of a fix — see `pm-playbook.md`'s verification rule. The gatekeeper (p4) and main-worker (p2) both declared success based on tests passing + no visible error, not on driving the actual feature and observing the real-world side effect (a Doc appearing in Drive). Every QA issue filed above requires evidence (a doc URL, a screenshot, a passing regression test), not a status message.

## Live conversation log (2026-07-04, this PM session)

- **p2 (HUM-1410)**: ack'd explicit ("Confirmed — I'm taking HUM-1410"). Found root cause (missing `.env` → `GOOGLE_CLIENT_ID` placeholder fallback → Google 400). Verdict: docs-only root cause + adding a code UX fix (clear warning in `options.tsx` when placeholder client_id detected). PM approved; awaiting real-.env OAuth success confirmation + PR.
- **p3 (HUM-1409/1412)**: ack'd explicit ("On track — confirmed a real GDoc gets created, have a live docUrl"). Found and is now fixing HUM-1412 (`docStore.upsert` overwrite bug) in the same session — merging into `docs[]` instead of overwriting. Awaiting fix completion + regression tests for both issues.
- **p4 (HUM-1411)**: no one-line ack yet, but is doing real work matching the issue's acceptance criteria — found the actual coverage gap (background.ts `FETCH_PR_INFO` handler + `handleCreate` integration path untested, not "stale" per se). PM approved the gap-fill approach; awaiting live verification + new tests.

Note on process: these agents (opencode-go / claude-code driven) narrate reasoning through tool-call traces rather than always sending discrete chat replies. PM is treating that narration as the primary communication channel — reading it, responding with explicit approval/correction, rather than requiring a stop-everything chat reply for each checkpoint. Explicit one-liners are still requested and used when given.

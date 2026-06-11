---
title: "feat(jetbrains): trust gate UI and project rule scoping (part 5/7)"
type: feat
date: 2026-06-11
parent: docs/plan/2026-06-11-feat-jetbrains-ide-plugin-port-plan.md
---

## feat(jetbrains): trust gate UI and project rule scoping - Standard

## Overview

Implement the IDE side of the trust gate — the only security boundary against arbitrary user-supplied DSL execution. Personal (`~/.ai-engineer-coach/`) and project (`<project>/.ai-engineer-coach/`) rules/metrics stay blocked until approved through an IntelliJ-native review dialog, with approvals persisted host-side and project rules scoped per-request.

## Problem Statement / Motivation

Upstream's approval flow is a VS Code QuickPick over `globalState` (`src/extension.ts:59-98`). The port keeps the unmodified `rule-trust.ts` logic in the sidecar (it depends only on a 2-method `TrustMemento`) but needs a Kotlin trust store, a real review UI, and a scoping design safe for multiple open projects sharing one sidecar.

## Proposed Solution

- `trust/TrustStoreService.kt`: app-level `PersistentStateComponent<ApprovalMap>` (`RoamingType.DISABLED`), answering the sidecar's `trust/get`–`trust/update` host methods (decision D5). Approvals are per-host-app: a rule approved in VS Code is pending again in IntelliJ — documented behavior.
- `trust/TrustApprovalDialog.kt`: pending notification ("N local rules pending review") → dialog table (file path / layer / kind), View Source (opens the md file in the IDE editor), Approve / Approve All / Reject. **Approve records the hash of the source as displayed**, not a re-read at approve time (TOCTOU guard). Pending rules are never executed and appear in no page or MCP output.
- Wire the `reviewLocalRules` bridge interception (stubbed in part 3) to the dialog.
- `saveRule` auto-approval (sidecar side, part 2) verified end-to-end: dashboard-authored personal rules are immediately trusted.
- Edit-revokes-trust: file watcher on the rule/metric dirs re-checks hashes, excludes changed files from the next run, re-surfaces the pending notification.
- Project scoping: per-request project-ID stamping end-to-end (bridge → sidecar rule-layer resolution); rules from one project never execute against another's dashboard. Projects in IntelliJ safe mode get the project layer hard-blocked regardless of approval.

## Tasks

- [ ] `TrustStoreService.kt` + host-method handlers in the bridge
- [ ] `TrustApprovalDialog.kt` + pending notification + View Source + TOCTOU hash semantics
- [ ] `reviewLocalRules` interception → dialog
- [ ] File watcher → edit-revokes-trust re-prompt
- [ ] Per-request project scoping verified with two projects open; safe-mode hard block
- [ ] Tests land with the code: approve / revoke-on-edit / pending-never-executes / TOCTOU hash / cross-project leakage (two projects open)

## Technical Considerations

- The trust store must stay host-mediated — never a file in the same directory tree as the untrusted rules.
- Reject behavior matches upstream: pending entries are in-memory and re-surface next load.

## Acceptance Criteria

- [ ] A pending rule's detections never appear in any dashboard page or MCP tool output
- [ ] Full rule source is at most one click from the Approve action
- [ ] Editing an approved rule on disk excludes it from the next analysis run and re-lists it as pending
- [ ] An edit between View Source and Approve does not get silently trusted (TOCTOU test)
- [ ] With two projects open, project-layer rules never leak across projects; safe-mode projects load no project layer

## Success Metrics

Security-path test suite (pending-exclusion, revoke-on-edit, TOCTOU, cross-project) green in CI.

## Dependencies

- **Part 3** must merge first (bridge host methods, sidecar supervisor). Independent of part 4.

## Dependencies & Risks

- Headless MCP path (part 6) inherits this gate: untrusted rules stay pending silently there; approval requires the IDE — documented.

## References & Research

- Parent plan: `docs/plan/2026-06-11-feat-jetbrains-ide-plugin-port-plan.md` (trust gate flow, D5)
- Trust logic: `src/core/rule-trust.ts:31-34,44,56-78,92-149` · loaders: `src/core/rule-loader.ts:45-164,216-294`
- Auto-approval parity: `src/webview/panel-rpc.ts:846-878` · upstream UI: `src/extension.ts:59-98`

# ADR 0005: Keep the rule trust store on the Kotlin host

- **Status:** Accepted
- **Date:** 2026-06-11
- **Decision ID:** D5

## Context

Local rules and metrics (markdown files in user/project directories) are
untrusted input — they drive analysis and must be explicitly approved before
execution. Upstream stores approvals in the VS Code extension host's
`globalState`. The sidecar runs upstream's `src/core/rule-trust.ts`, which
expects a `TrustMemento` (a `get`/`update` key-value store).

Where should approval authority live: in the sidecar (e.g. a file next to the
rules) or in the IDE host?

## Decision

Keep the trust store **on the Kotlin side**, as a
`PersistentStateComponent<ApprovalMap>` (`TrustStoreService.kt`), exposed to the
sidecar through a `TrustMemento`-shaped RPC adapter (`trust/get`, `trust/update`
host methods). `rule-trust.ts` ports unmodified.

## Consequences

- Mirrors upstream's host-`globalState` design; minimizes divergence.
- Approval authority stays in the IDE host, not in a user-writable file sitting
  next to the untrusted rules it governs.
- Approvals are intentionally **per-host-app**: a rule approved in VS Code is
  pending again in IntelliJ. This is documented expected behavior.
- The headless MCP path ([ADR 0002](0002-stdio-mcp.md)) cannot approve rules;
  untrusted rules stay pending silently until approved from the IDE.

## Alternatives considered

- **Sidecar-side trust file** — rejected: puts approval state in a
  user-writable file adjacent to the untrusted rules, weakening the trust
  boundary, and diverges from upstream's design.

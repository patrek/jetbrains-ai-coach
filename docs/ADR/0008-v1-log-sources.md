# ADR 0008: v1 log sources are CLI harnesses only

- **Status:** Accepted
- **Date:** 2026-06-11
- **Decision ID:** D8

## Context

The coach discovers and parses AI assistant session logs. Upstream's
`findLogsDirs` includes VS Code `workspaceStorage` and Xcode sources. On
JetBrains, the natural additions would be the JetBrains-native AI tools (Copilot
for JetBrains, AI Assistant, Junie). We must decide which sources v1 ships.

External research found the JetBrains-native session formats are not safely
shippable without hands-on spikes:

- **Copilot for JetBrains** stores sessions in a binary Nitrite/H2-MVStore DB
  (`copilot-agent-sessions-nitrite.db`) — undocumented, and has broken across
  plugin versions.
- **AI Assistant** uses undocumented workspace XML (`ChatSessionStateTemp`),
  lost on IDE major upgrades.
- **Junie** has no confirmed public session format.

## Decision

v1 parses **CLI harnesses only**: Claude Code, Codex CLI, OpenCode, and Copilot
CLI (`~/.copilot/session-state`). JetBrains-native parsers are deferred to
post-v1 spikes.

VS Code `workspaceStorage` and Xcode discovery are dropped from the discovery
path via a patch in `tools/patches/` that disables them in `findLogsDirs`. The
parser code stays vendored (no deletion), just not wired into discovery.

## Consequences

- v1 ships only sources we can parse reliably and document.
- The drop is a small, reviewable patch; re-enabling a source later is a patch
  change, not a code rewrite.
- Dropping `workspaceStorage` is also part of why the cache must be isolated from
  the VS Code extension ([ADR 0001](0001-cache-isolation.md)): the two hosts see
  different source sets.

## Alternatives considered

- **Ship JetBrains-native parsers in v1** — rejected: undocumented, unstable
  formats with no safe parsing path absent dedicated spikes.

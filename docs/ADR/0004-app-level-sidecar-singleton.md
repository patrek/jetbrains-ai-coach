# ADR 0004: One application-level sidecar singleton

- **Status:** Accepted
- **Date:** 2026-06-11
- **Decision ID:** D4

## Context

A JetBrains user can have several IDE windows (projects) open at once. We must
decide whether the Node sidecar is per-project or shared.

The parsed dataset is **global** — it comes from user-level log directories, not
from any one project. The only project-scoped state is the project rule layer
and per-window webview UI state.

## Decision

Run **one application-level sidecar singleton**, implemented as an IntelliJ
`@Service(APP)` (`SidecarService.kt`) shared by all IDE windows. Per-request
project scope is carried in the RPC envelope: the Kotlin bridge stamps every
forwarded request with the owning window's project ID, and the sidecar resolves
the project rule layer per request.

## Consequences

- Memory is not multiplied by the number of open windows for identical data.
- Project rule resolution is per-request, so a request from window A is never
  evaluated under window B's rules even if focus changes mid-flight (a
  focus-based mutable global would have that bug).
- The singleton's lifecycle (spawn, supervise, restart with backoff, dispose on
  app shutdown) is centralized; cache writes are atomic so the hard kill on
  shutdown is safe (see [ADR 0001](0001-cache-isolation.md)).

## Alternatives considered

- **Per-project sidecar** — rejected: multiplies memory by open-window count for
  a dataset that is identical across windows.

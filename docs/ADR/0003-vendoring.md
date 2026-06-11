# ADR 0003: Share upstream code via a vendored snapshot + sync script

- **Status:** Accepted
- **Date:** 2026-06-11
- **Decision ID:** D3

## Context

The port's premise is ~90% code reuse with lockstep upstream fixes. We need a
mechanism to consume `src/core` and `src/webview` from the upstream repo that
keeps drift small, explicit, and auditable — and that requires no publishing
infrastructure on the upstream side.

## Decision

**Vendor a pinned snapshot via a sync script.** `tools/sync-upstream.mjs`:

1. records the upstream commit SHA in `tools/upstream.lock`,
2. copies `src/core/**` and `src/webview/**` (including `rules/*.md`,
   `metrics/*.metric.md`, and colocated tests) into `sidecar/vendor/`,
3. applies the reviewed patch set in `tools/patches/`,
4. runs the vendored test suite.

Vendored files are **never hand-edited**. Every divergence is a patch. A patch
that no longer applies fails the sync and CI, so drift surfaces immediately
rather than rotting silently. Target: fewer than 10 small patches.

## Consequences

- Drift is explicit and reviewable; re-syncing is mechanical (target: < 1 hour
  including test verification).
- No npm package or other publishing infrastructure is required from upstream.
- The vendored tree is generated, so it is `.gitignore`d; a clean clone runs the
  sync script to populate it.
- Upstream restructuring of `src/core`/`src/webview` can break the sync —
  intentional, since syncs are deliberate and conflicts surface in CI.

## Alternatives considered

- **Publish upstream core as an npm package** — rejected: requires ongoing
  publishing work upstream and a versioning contract we don't control.
- **Git submodule / subtree** — rejected: harder to carry a small patch set
  cleanly and to gate on a vendored test run.

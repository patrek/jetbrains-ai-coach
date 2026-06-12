# ADR 0006: Degrade LLM features via a `getCapabilities` RPC

- **Status:** Accepted
- **Date:** 2026-06-11
- **Decision ID:** D6

## Context

A handful of upstream features depend on the VS Code Language Model API
(`generateRule`, `compileNlRule`, `explainOccurrence`, and several extension
methods). The JetBrains host has no equivalent LLM API in v1. The vendored
webview bundle must stay byte-identical to upstream output to preserve the reuse
premise — so it cannot be forked per host.

## Decision

Introduce a **`getCapabilities` RPC** answered by the Kotlin bridge with
`{llm: false, host: 'jetbrains'}`. The webview gates every LLM entry point on
`getCapabilities().llm === false`. LLM-dependent core methods that still reach
the sidecar answer with a typed `{error: 'llm-unavailable'}`.

The method is designed to be **upstreamable**: a VS Code host would answer
`{llm: true}`. Until upstream adopts it, the small webview gating change lives in
the fork's patch set — the one sanctioned webview divergence.

> Note: `getCapabilities` is introduced by this port. It does not exist in
> upstream `rpc-types.ts` and is answered locally by the bridge.

## Consequences

- The webview bundle stays shared; only a small, upstreamable patch diverges.
- LLM features degrade gracefully with messaging pointing users to the MCP tools
  in Claude Code, rather than erroring opaquely.
- If/when upstream adopts `getCapabilities`, the fork's webview patch disappears.

## Alternatives considered

- **Fork the webview bundle per host** — rejected: destroys the ~90% reuse
  premise ([ADR 0003](0003-vendoring.md)).
- **Silently no-op LLM methods** — rejected: a typed error + capability gate
  gives the UI a clean, testable contract.

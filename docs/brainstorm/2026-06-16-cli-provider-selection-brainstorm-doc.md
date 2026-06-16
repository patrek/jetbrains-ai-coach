---
date: 2026-06-16
topic: cli-provider-selection
---

# Selectable CLI Provider for AI-Backed Features

## What We're Building

A mechanism that lets the user choose which installed CLI agent (Claude Code or
GitHub Copilot CLI) acts as the inference backend for the plugin's AI-backed
features. Today those features — `generateRule`, `compileNlRule`, and
`explainOccurrence` — are stubbed in the sidecar to return `{ error: 'llm-unavailable' }`
(see `sidecar/src/rpc-handlers.ts:83-96`). This feature wires them to a real
backend by shelling out to the selected CLI in non-interactive mode and parsing
its output.

The plugin remains a log-parsing analytics engine; this adds a distinct,
opt-in inference capability layered on top. The chosen CLI is configurable
globally with a per-project override, mirroring the existing trust / project-rule
scoping. When the selected CLI is missing, unauthenticated, or fails, the feature
degrades to the current `llm-unavailable` behavior rather than failing loudly.

## Why This Approach

**Chosen: Approach A — Provider interface in the sidecar (Node/TS).**

A `CliProvider` interface lives in the sidecar with two implementations
(`ClaudeProvider`, `CopilotProvider`). Each shells out via `child_process` using
its own non-interactive flags and parses its own output format. The three stubbed
handlers call `provider.run(prompt)` instead of returning the degradation error.
The Kotlin host detects the CLI binaries (reusing the existing `NodeDetector`-style
PATH cascade) and resolves the effective per-project selection, then stamps the
chosen provider id + binary path onto each RPC envelope — exactly how `projectRoot`
and `safeMode` are already stamped today (`WebviewBridge.kt`).

Approaches considered:

- **A — Provider in sidecar (chosen):** Invocation lives next to the handlers that
  need it; reuses the per-RPC stamping seam; Node already spawns child processes.
  One clean interface to extend with a third CLI later. Cost: binary detection is
  split (host finds, sidecar runs) and there are two output parsers to maintain.
- **B — Invoke from the Kotlin host:** Host owns spawning; sidecar requests
  inference via the existing `host-request` bridge (the trust-callback channel).
  Centralizes process control in Kotlin but adds protocol round-trips on every AI
  call and pushes output parsing into Kotlin. Heavier than needed.
- **C — MCP / pluggable strategy layer:** Full capability negotiation, streaming,
  registry. Over-engineered (YAGNI) for two CLIs and three handlers today.

## Key Decisions

- **Backend role:** The selected CLI *powers* the AI features (generateRule,
  compileNlRule, explainOccurrence) — it is the missing inference backend, not a
  log-source filter. Rationale: this is the gap that actually blocks those features.
- **Initial CLI support:** Claude Code (`claude -p`, JSON output) and GitHub
  Copilot CLI, both behind a common `CliProvider` interface. Rationale: makes the
  selector meaningful on day one while keeping the surface to two adapters.
- **Architecture:** Approach A — provider interface in the sidecar; host handles
  binary detection + selection resolution and passes the choice per-RPC. Rationale:
  best fit for the codebase's existing seams (per-RPC stamping, child-process
  spawning in Node).
- **Selection scope:** Global default in `CoachSettings` (aiCoach.xml) with an
  optional per-project override, consistent with existing trust / project-rule
  scoping. Rationale: flexibility without a runtime-switcher UI burden.
- **Failure handling:** Degrade gracefully. If the chosen CLI is absent,
  unauthenticated, or errors, the feature stays disabled with a clear reason
  surfaced in the UI — no auto-fallback to the other CLI. Rationale: keeps which
  backend ran reproducible and matches the existing LLM-degradation design.

## Open Questions

- **Per-RPC vs. startup configuration:** Should the provider id + binary path be
  stamped per-RPC (matches `projectRoot`/`safeMode`) or passed once at sidecar
  startup via an env var (like `AI_COACH_EXCLUDED_DIRS`)? Per-RPC is more flexible
  for the per-project override; startup is simpler. Lean per-RPC.
- **Copilot CLI non-interactive contract:** Confirm Copilot CLI's exact
  non-interactive invocation flags and output format (and whether a stable JSON
  output mode exists) before locking the adapter shape.
- **Auth / availability detection:** How does the host determine "authenticated"
  vs. merely "installed" for each CLI without running a full inference? (e.g. a
  cheap status/whoami probe per provider.) Needed for the "clear reason in UI"
  degradation path.
- **Prompt construction ownership:** Do the three handlers build provider-agnostic
  prompts that the adapter wraps, or does each adapter own prompt shaping? Lean
  provider-agnostic prompt, adapter owns only invocation + parsing.
- **Capability surfacing:** Should the `hello` handshake `capabilities` object
  (`rpc-server.ts:49`, currently `{ llm: false, github: false }`) advertise the
  resolved provider so the webview can reflect active backend + degradation state?
- **Output normalization:** Define the common return shape `CliProvider.run()`
  yields so the three handlers don't branch on provider — including how errors,
  timeouts, and non-zero exits map to the `llm-unavailable` degradation.
- **Settings UI:** Confirm placement of the global dropdown in
  `CoachSettingsConfigurable` and where the per-project override is set/displayed.
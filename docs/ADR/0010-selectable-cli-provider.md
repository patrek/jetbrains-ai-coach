# ADR 0010: Selectable CLI inference provider for the AI-backed methods

- **Status:** Accepted
- **Date:** 2026-06-16
- **Decision ID:** cli-provider plan (`docs/plan/2026-06-16-feat-selectable-cli-provider-plan.md`)

## Context

Two otherwise-complete dashboard actions — `generateRule` and `explainOccurrence`
— were dead because their inference ran through the VS Code host language model,
which the JetBrains port lacks ([ADR 0006](0006-getcapabilities-degradation.md)
degraded all LLM methods to `llm-unavailable`). Users already have a CLI agent
installed — the very tool whose logs this plugin analyzes — so the cheapest honest
backend is to shell out, non-interactively, to the CLI they already authenticated
(**Claude Code** or **GitHub Copilot CLI**). The plugin is otherwise a local-only
log-analytics tool, so adding network egress must be a deliberate, opt-in choice,
not a surprise.

## Decision

1. **Opt-in, explicit, consented.** The feature is off until the user selects a
   provider **and** acknowledges a one-time egress disclosure. It never
   auto-enables, even when exactly one CLI is detected. No prompt leaves the
   machine otherwise.

2. **Sidecar stays provider-agnostic; the host stamps the choice per-RPC.** A
   `CliProvider` interface in the sidecar (`cli-provider.ts` + `providers/`) gains
   two adapters that spawn the CLI (argv only, never a shell), impose a 60 s
   deadline, kill the child on timeout, and normalize output to a typed
   `ProviderResult`. The Kotlin host resolves which provider is active and stamps
   `provider: { id, binaryPath }` onto the request envelope — exactly how
   `projectRoot`/`safeMode` are stamped. The stamps are now bundled into one
   `RequestScope` value object so the forwarding chain does not grow a positional
   argument per stamp.

3. **Capabilities are per-window, not per-sidecar.** The app-level sidecar
   singleton ([ADR 0004](0004-app-level-sidecar-singleton.md)) fires one `hello`
   with one `capabilities` object and therefore **cannot** represent a
   per-project provider selection. The resolved provider + availability is
   computed host-side, per window, in `WebviewBridge.capabilitiesReply()` — the
   same seam that already synthesizes the `github`/`host` fields. Two windows with
   different overrides each stamp their own provider on the one shared sidecar.

4. **Detection is machine-global; selection is per-window.** Binary detection
   (`claude --version` / `copilot --version`; Claude `auth status` exit code;
   Copilot env-token presence) is a property of the machine/PATH, so it is owned
   app-level by a memoized `CliProviderDetector` (mirroring `NodeDetector`),
   invalidated on a settings change and on "Restart sidecar", and probed off the
   CEF/EDT thread. Only selection resolution (`override.ifBlank(global)`) is
   per-window. The global default lives on `CoachSettings`; the per-project
   override is a single `PropertiesComponent(project)` string — no new
   `PersistentStateComponent`.

5. **No auto-fallback.** A missing, unauthenticated, timed-out, or erroring CLI
   degrades the action to `llm-unavailable` augmented with a distinguishable
   `reason` (`not-installed` / `unauthenticated` / `timeout` / `cli-error` /
   `bad-output`). The webview gate (an expansion of patch 0006) renders a specific
   message per reason for the two wired methods and re-polls `getCapabilities` per
   call so a settings change takes effect without a host→webview push. The other
   ten LLM methods keep the single-flag degraded UX.

6. **`compileNlRule` is descoped.** Unlike the other two, its LLM call is buried
   in a private `compileLlm()` inside `vendor/core/rule-compiler.ts` (with an
   existing non-LLM heuristic fallback), not in a handler. Routing it through a
   provider would require patching a `vendor/core/` file — a heavy,
   non-upstreamable divergence against the minimal-divergence rule. It keeps its
   heuristic fallback and is wired in a follow-up.

## Consequences

- One new vendored export patch (`0008`) exposes the reusable `generateRule`
  prompt/validators; the `explainOccurrence` prompts are re-derived in the
  override (they are inline literals, not symbols). Patch `0006` grows to gate the
  two wired methods on `provider.status` — a deliberate, risk-flagged expansion of
  the most sensitive divergence, logged in `tools/patches/README.md`.
- Copilot has no stable JSON, no documented exit codes, and undocumented stdin
  ([github/copilot-cli#3397](https://github.com/github/copilot-cli/issues/3397)),
  so its adapter parses plain text only, caps the argv-borne prompt at 96 KiB,
  and maps any non-zero exit to `cli-error`. Claude reads only the stable
  `.result` JSON field.
- The egress decision is the privacy boundary: safe-mode/excluded-dirs remain
  about the project rule layer and log scanning, not inference.

## Alternatives considered

- **Invoke from the Kotlin host** over the `host-request` bridge — rejected: an
  extra protocol round-trip and output parsing in Kotlin, heavier than needed.
- **MCP / pluggable strategy layer** — rejected: over-engineered (YAGNI) for two
  CLIs; a third provider slots in behind `CliProvider` + one `resolveProvider`
  case.
- **Capabilities in the sidecar `hello`** — rejected: incompatible with the single
  shared-singleton handshake serving N per-project selections (ADR 0004).
- **Auto-enable / default-to-Claude** — rejected: surprise egress on a local-only
  tool.
- **A full `ProjectProviderSettings` service / `ProviderResolver` class /
  per-window detection cache** — rejected as over-engineering; replaced with
  `PropertiesComponent`, an inline resolution expression, and app-level memoized
  detection.

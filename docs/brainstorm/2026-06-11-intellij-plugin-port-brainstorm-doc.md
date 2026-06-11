---
date: 2026-06-11
topic: intellij-plugin-port
---

# AI Engineer Coach for JetBrains IDEs

## What We're Building

A JetBrains IDE plugin (independent new repo, MIT-licensed with attribution to the upstream microsoft/MS-AI-Engineering-Coach project) that brings AI Engineer Coach to the entire JetBrains family (IDEA, PyCharm, WebStorm, GoLand, Rider, etc.). Like the VS Code original, it parses local AI coding session logs — Claude Code, Codex CLI, OpenCode, plus new parsers for JetBrains-native AI sources (GitHub Copilot for JetBrains, JetBrains AI Assistant/Junie where logs are accessible) — and renders analytics in a dashboard: usage patterns, anti-pattern detection via the markdown rules/metrics DSL, flow analysis, config health. Strictly read-only and local: never modifies session files, never phones home.

Target is full feature parity with the VS Code extension, with two platform adaptations: the VS Code Copilot log parser is replaced by JetBrains-native log sources, and the `@aicoach` chat participant is replaced by a local MCP server exposing the same 12 analytics tools to any MCP client (Claude Code, JetBrains AI, etc.).

## Why This Approach

**Chosen architecture: thin Kotlin shell + JCEF webview + Node sidecar core (maximum reuse).**

The codebase analysis showed the port surface is far smaller than the project's ~55k LOC suggests:

- `src/core/` (~35.7k LOC: parsers, analyzers, rules/metrics DSL engine, trust gate, cache) has **zero `vscode` imports** (verified) and already runs in plain Node child processes (parse-worker, warm-up-worker, cache-write-worker).
- The Preact + htm webview (~18.2k LOC, 24 dashboard pages) talks to the host exclusively through a typed JSON RPC layer (`src/core/types/rpc-types.ts`, ~50 methods), and the Playwright e2e harness already runs it in a plain browser with a mocked `acquireVsCodeApi()` — proof it works in any embedded browser, including JCEF.
- VS Code-specific glue is only ~1,250 LOC.

Architecture:

```
IntelliJ plugin (Kotlin, thin — ~2-4k LOC glue)
├── ToolWindow → JCEF browser
│     └── existing Preact webview bundle
│         (RPC bridge: JBCefJSQuery ↔ sidecar, replacing acquireVsCodeApi/postMessage)
├── Node sidecar process
│     └── existing src/core bundle: parsers, Analyzer, rules/metrics DSL,
│         trust gate, cache (~/.copilot-analytics-cache/ shared with VS Code)
└── Local MCP server exposing the 12 aiEngineerCoach_* analytics tools
```

Alternatives considered and rejected:

- **JCEF UI + Kotlin core rewrite**: no Node dependency, but rewriting ~35k LOC of parsers/analyzers/DSL delays parity by months and the parsers permanently drift from upstream log-format fixes.
- **Full native Kotlin (Swing/Compose UI + Kotlin core)**: most idiomatic, but ~50k+ LOC rewrite for a UI that already works in an embedded browser. Rejected as effort without proportional benefit.

The accepted trade-off: the plugin requires Node ≥18 on the user's machine (detected on PATH, with a graceful install prompt if missing). For a developer-tool audience this is acceptable friction in exchange for ~90% code reuse and staying in lockstep with upstream parsers and rules.

## Key Decisions

- **Scope: full parity** — dashboard (all 24 pages), 45 detection rules + 10 metrics, rules DSL with three-layer loading (built-in / personal / project), trust gate, caching, export. Not a trimmed v1.
- **Target: all JetBrains IDEs** — build on the IntelliJ Platform with no IDEA-specific dependencies; the feature set is IDE-agnostic (reads logs, shows a dashboard).
- **Ownership: independent new repo** — upstream is MIT (Microsoft Corporation copyright), so reuse with attribution is permitted. Reused core/webview code should be consumed in a way that allows pulling upstream fixes (vendored snapshot or shared package — to settle during planning).
- **Log sources: CLI harnesses + JetBrains-native AI** — port `parser-claude.ts`, `parser-codex.ts`, `parser-opencode.ts` (and `parser-vscode-cli.ts` for Copilot CLI) as-is; research and add parsers for GitHub Copilot for JetBrains and JetBrains AI Assistant/Junie log formats. Drop the VS Code workspaceStorage and Xcode parsers from the default path.
- **Architecture: Kotlin shell + JCEF + Node sidecar** — rationale above. RPC over `JBCefJSQuery` reuses the existing request/response message contract.
- **LLM features: MCP server only for v1** — replaces both the chat participant and the VS Code Language Model API. In-dashboard LLM generation (rule generation, quiz, learning resources, did-you-know) is deferred; the dashboard itself needs no LLM. BYO-API-key generation features can be revisited later.
- **Trust gate ports directly** — `rule-trust.ts` depends only on a two-method `TrustMemento` interface; the Kotlin side provides an adapter backed by `PropertiesComponent`/`PersistentStateComponent`, or the sidecar persists trust state itself (to settle during planning).
- **Cache is shared with the VS Code extension** — `~/.copilot-analytics-cache/` is IDE-independent state; keeping the same path and `CACHE_VERSION` means users running both IDEs parse once.

## Open Questions

- **Code-sharing mechanism with upstream**: vendored copy with a sync script, git subtree, or publishing `src/core` + webview as npm packages from a fork? Affects how easily upstream parser fixes flow in.
- **JetBrains-native log formats**: where do GitHub Copilot for JetBrains and JetBrains AI Assistant/Junie store session logs, and are they parseable (plain JSON/SQLite) and stable across versions? Needs a research spike before committing to those parsers.
- **Node sidecar distribution details**: minimum supported Node version, PATH detection strategy across OSes, behavior when Node is absent (block with guidance vs. offer a runtime download), sidecar lifecycle (start on tool-window open vs. project open).
- **MCP server transport**: stdio child process registered for clients vs. local HTTP/SSE port — and how users wire it into Claude Code / JetBrains AI.
- **Workers**: keep the three-process model (parse / warm-up / cache-write) inside the single sidecar with Node worker_threads, or fork as today? Probably an implementation detail for planning.
- **Theme integration**: the webview CSS uses `--vscode-*` variables; the JCEF host must inject equivalents derived from the IntelliJ theme (the e2e harness shows exactly which variables are needed).
- **Plugin naming/branding**: independent repo needs its own name distinct from the upstream "AI Engineer Coach" or explicit permission to reuse it.

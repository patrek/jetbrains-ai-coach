---
title: "feat(jetbrains): MCP stdio server, host-method completion, and LLM degradation (part 6/7)"
type: feat
date: 2026-06-11
parent: docs/plan/2026-06-11-feat-jetbrains-ide-plugin-port-plan.md
---

## feat(jetbrains): MCP stdio server + host-method completion - Standard

## Overview

Close the RPC disposition table and ship the LLM replacement story: a standalone stdio MCP server exposing the 12 `aiEngineerCoach_*` analytics tools (works with the IDE closed), the export-summary save flow, the graceful-degradation pass for every LLM-dependent method, and the unknown-method safety net. After this PR, every method in the disposition table has an implemented disposition and no page can hang.

## Problem Statement / Motivation

The port replaces the VS Code chat participant and Language Model API with MCP (decision D2). Meanwhile 9 LLM-dependent methods (8 extension + `explainOccurrence`, plus core `generateRule`/`compileNlRule` handled in part 2) must degrade visibly — a dead button with no feedback, or worse a hung spinner, reads as "broken plugin".

## Proposed Solution

- `sidecar/src/mcp-main.ts`: `@modelcontextprotocol/sdk` stdio transport; the 12 tools from `src/mcp/tools.ts:70-185` with names **pinned `aiEngineerCoach_*`** regardless of final branding; formatters (`src/mcp/formatters.ts`) unmodified. Freshness contract: serve from cache when dirMetas are fresh; on stale/missing cache, parse with a "parsing N sessions, partial data" note in the first response to stay inside client timeouts. Trust gate honored headless (pending rules excluded; approval requires the IDE).
- Setup UX is docs, not a dialog (KISS): README/docs page with `claude mcp add aicoach -- node ~/.ai-coach-jetbrains/runtime/current/mcp-main.js` + generic JSON — the stable `runtime/current` path survives plugin updates. One-time discovery notification balloon in the IDE.
- `export/ExportSummaryHandler.kt`: webview → bridge → sidecar content → IntelliJ directory chooser (multi-file export), date-stamped defaults, preserves the dashboard's date-filter context, success notification with "Show in Files", error balloons; disabled-with-tooltip during parse.
- LLM degradation: typed `{error:'llm-unavailable'}` for all generate methods; webview gating on `getCapabilities().llm === false` (the single allowed webview patch, decision D6); per-page audit deciding hide vs. disable (Learning page sections, Rules-editor NL features, Skills generation); messaging points to the MCP tools in Claude Code.
- Unknown-method safety net in the bridge: any unmapped method gets a typed error immediately (webview timeout is 120s, `src/webview/shared.ts:23-37` — silence is unacceptable).
- Link-out audit: every dashboard action that opened something in VS Code maps to an IntelliJ idiom (`OpenFileDescriptor` for rule files) or is gated.

## Tasks

- [ ] `mcp-main.ts` (12 tools, cache-first contract, headless trust)
- [ ] IDE-closed end-to-end test: `claude mcp add` → tool call → correct analytics with no IDE running
- [ ] Setup docs + stable-path snippets + discovery notification
- [ ] `ExportSummaryHandler.kt` + error/success UX
- [ ] LLM degradation pass + per-page hide-vs-disable audit table (committed to the repo)
- [ ] Unknown-method safety net + full-table verification sweep
- [ ] Link-out audit across the dashboard

## Technical Considerations

- The MCP server and the IDE sidecar may run concurrently against the same fork cache — atomic writes (part 2) make this safe; both read each other's fresh cache.
- Tool input schemas are date-range filters plus `sessions` paging — port unchanged.

## Acceptance Criteria

- [ ] All 12 MCP tools callable from Claude Code with the IDE closed **and** open
- [ ] MCP client config survives a plugin update (stable `runtime/current` path)
- [ ] Untrusted rules excluded from MCP output on the headless path
- [ ] Export writes date-stamped files via an IntelliJ chooser, preserves the date filter, reports success/failure visibly
- [ ] Exercising every nav-registry page with LLM disabled produces zero hung spinners; every degraded entry point shows the "available via MCP" messaging
- [ ] The disposition table (parent plan) is fully implemented — no method unmapped

## Success Metrics

Disposition-table verification sweep automated (per-method bridge test asserting answer-or-typed-error for all methods).

## Dependencies

- **Part 2** (sidecar + audited dispositions), **Part 3** (bridge, export plumbing), **Part 5** (trust honored headless) must merge first.

## Dependencies & Risks

- MCP client timeout on a cold parse is the main UX risk — the partial-data first response is the mitigation; verify against real Claude Code timeouts.

## References & Research

- Parent plan: `docs/plan/2026-06-11-feat-jetbrains-ide-plugin-port-plan.md` (D2, D6, disposition table)
- Tools: `src/mcp/tools.ts:70-207` · formatters: `src/mcp/formatters.ts`
- Replaced participant: `src/chat/participant.ts`
- MCP SDK: https://github.com/modelcontextprotocol/typescript-sdk

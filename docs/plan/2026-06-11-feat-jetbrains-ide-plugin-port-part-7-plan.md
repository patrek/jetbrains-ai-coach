---
title: "feat(jetbrains): hardening, packaging, and Marketplace submission (part 7/7)"
type: feat
date: 2026-06-11
parent: docs/plan/2026-06-11-feat-jetbrains-ide-plugin-port-plan.md
---

## feat(jetbrains): hardening, packaging, and Marketplace submission - Standard

## Overview

The shipping PR: multi-window and lifecycle hardening, cross-product verification, first-run data-access disclosure, signing, Marketplace listing, and complete user-facing documentation. The test harnesses built in parts 2–5 run here across the full product matrix.

## Problem Statement / Motivation

Process leaks, EDT violations, and undeclared data access are the classic JetBrains-plugin review rejections — and multi-window/multi-IDE concurrency is where the app-level-singleton design (D4) and cache isolation (D1) get proven for real.

## Proposed Solution & Tasks

- [ ] Multi-window tests: two projects in one IDE (broadcast correctness, per-request project scoping); two different JetBrains products simultaneously (two app-level sidecars, separate plugin instances, no port usage to conflict — D2 made MCP stdio)
- [ ] Lifecycle tests: IDE kill (orphan check), crash mid-parse (cache-resume via dirMetas), plugin update (runtime re-extraction + MCP config still works via `runtime/current`), uninstall (kills processes, leaves user cache and `~/.ai-engineer-coach/` content)
- [ ] Cross-product run of the Playwright harness and platform-test suites from parts 2–5 (harnesses land with their code, not here)
- [ ] First-run data-access disclosure: read-only/local statement listing directories read (`~/.claude`, `~/.codex`, OpenCode, `~/.copilot`), plus a directory-exclusion setting
- [ ] Plugin signing; `verifyPlugin` green for current IDEA, PyCharm, WebStorm, GoLand, Rider
- [ ] Final naming/branding decision (name distinct from upstream's "AI Engineer Coach" or explicit permission) — blocks listing only
- [ ] Marketplace listing (screenshots, description, privacy statement)
- [ ] Docs: README (setup incl. Node ≥ 20 requirement), MCP setup guide, rules-authoring pointer (upstream `docs/AUTHORING_RULES.md` semantics apply), troubleshooting guide + "Collect troubleshooting info" action (bundles sidecar log + detection results)

## Technical Considerations

- Plugin must remain platform-only (`com.intellij.modules.platform`) — `verifyPlugin` compatibility report is the gate.
- `com.intellij.toolWindow` is a non-dynamic extension point: install/uninstall requires IDE restart — expected and accepted on Marketplace; do not fight it.

## Acceptance Criteria

- [ ] All parent-plan acceptance criteria pass (functional, non-functional, quality gates)
- [ ] `verifyPlugin` green across the 5-product matrix; signed artifact within Marketplace limits
- [ ] No orphaned Node processes across the lifecycle test matrix
- [ ] Disclosure shown on first run; exclusion setting works
- [ ] Docs complete: README, MCP setup, troubleshooting

## Success Metrics

Marketplace approval without rejections for process leaks, EDT violations, or undeclared data access.

## Dependencies

- **All previous parts (1–6)** must merge first.

## Dependencies & Risks

- Branding/permission is the only external blocker — start the conversation early; it gates listing, not development.
- Remote development (Gateway) is explicitly unsupported in v1 — state it in the listing to pre-empt reviews.

## References & Research

- Parent plan: `docs/plan/2026-06-11-feat-jetbrains-ide-plugin-port-plan.md` (acceptance criteria, risk table, post-v1 spikes)
- Signing: https://plugins.jetbrains.com/docs/intellij/plugin-signing.html
- Dynamic plugins: https://plugins.jetbrains.com/docs/intellij/dynamic-plugins.html
- Marketplace guidelines: https://plugins.jetbrains.com/docs/marketplace/jetbrains-marketplace-approval-guidelines.html

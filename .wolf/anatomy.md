# anatomy.md

> Auto-maintained by OpenWolf. Last scanned: 2026-06-15T19:38:13.812Z
> Files: 330 tracked | Anatomy hits: 0 | Misses: 0

## ../../../../../tmp/p2gen/sidecar/vendor/core/

- `parser-main.test.ts` — API routes: GET (2 endpoints) (~4201 tok)
- `parser.ts` — Running total of AI-generated lines of code discovered so far. (~8321 tok)

## ./

- `.gitignore` — Git ignore rules (~106 tok)
- `AGENTS.md` — Agent instructions for Codex/Jules/OpenCode: build, test, architecture, conventions (~320 tok)
- `build.gradle.kts` — Gradle Kotlin build configuration (~72 tok)
- `CLAUDE.md` — OpenWolf (~57 tok)
- `gradle.properties` (~105 tok)
- `gradlew` — you may not use this file except in compliance with the License. (~2331 tok)
- `gradlew.bat` (~766 tok)
- `LICENSE` — Project license (~291 tok)
- `NOTICE` (~486 tok)
- `README.md` — Project documentation (~615 tok)
- `settings.gradle.kts` — Gradle Kotlin settings (~66 tok)

## .claude/

- `settings.json` (~441 tok)
- `settings.local.json` — Declares p (~645 tok)

## .claude/rules/

- `openwolf.md` (~313 tok)

## .code-review-graph/

- `.gitignore` — Git ignore rules (~38 tok)

## .github/

- `copilot-instructions.md` — Copilot session instructions: build/test commands, architecture, conventions (~350 tok)

## .github/workflows/

- `ci.yml` — CI: CI (~812 tok)

## .gradle/

- `file-system.probe` (~3 tok)

## .gradle/8.11.1/

- `gc.properties` (~0 tok)

## .gradle/9.1.0/

- `gc.properties` (~0 tok)

## .gradle/buildOutputCleanup/

- `cache.properties` — Thu Jun 11 14:11:40 EDT 2026 (~14 tok)

## .gradle/vcs-1/

- `gc.properties` (~0 tok)

## .intellijPlatform/sandbox/plugin/IU-2024.2.5/config/

- `disabled_plugins.txt` (~0 tok)

## .intellijPlatform/sandbox/plugin/IU-2024.2.5/config/options/

- `updates.xml` (~40 tok)

## .intellijPlatform/sandbox/plugin/IU-2024.2.5/plugins/plugin/lib/

- `plugin-0.1.0.jar` (~265 tok)

## docs/ADR/

- `0000-template.md` — ADR NNNN: Title (~95 tok)
- `0001-cache-isolation.md` — ADR 0001: Isolate the cache from the VS Code extension (~473 tok)
- `0002-stdio-mcp.md` — ADR 0002: MCP server as a standalone stdio entry point (~392 tok)
- `0003-vendoring.md` — ADR 0003: Share upstream code via a vendored snapshot + sync script (~447 tok)
- `0004-app-level-sidecar-singleton.md` — ADR 0004: One application-level sidecar singleton (~374 tok)
- `0005-kotlin-side-trust-store.md` — ADR 0005: Keep the rule trust store on the Kotlin host (~399 tok)
- `0006-getcapabilities-degradation.md` — ADR 0006: Degrade LLM features via a `getCapabilities` RPC (~434 tok)
- `0007-custom-scheme-handler.md` — ADR 0007: Embed the webview via a custom scheme handler (~384 tok)
- `0008-v1-log-sources.md` — ADR 0008: v1 log sources are CLI harnesses only (~459 tok)
- `0009-extension-method-disposition.md` — ADR 0009: Disposition of the extension RPC methods in the sidecar (~1145 tok)
- `README.md` — Project documentation (~254 tok)

## docs/brainstorm/

- `2026-06-11-intellij-plugin-port-brainstorm-doc.md` — AI Engineer Coach for JetBrains IDEs (~1638 tok)

## docs/plan/

- `2026-06-11-feat-jetbrains-ide-plugin-port-part-1-plan.md` — feat(jetbrains): repo scaffold and upstream sync pipeline - Standard (~1011 tok)
- `2026-06-11-feat-jetbrains-ide-plugin-port-part-2-plan.md` — feat(jetbrains): Node sidecar stdio RPC server - Standard (~1303 tok)
- `2026-06-11-feat-jetbrains-ide-plugin-port-part-3-plan.md` — feat(jetbrains): Kotlin shell (tool window + JCEF + bridge + supervisor) - Standard (~5552 tok)
- `2026-06-11-feat-jetbrains-ide-plugin-port-part-4-plan.md` — feat(jetbrains): theme integration and webview state persistence - Standard (~930 tok)
- `2026-06-11-feat-jetbrains-ide-plugin-port-part-5-plan.md` — feat(jetbrains): trust gate UI and project rule scoping - Standard (~1069 tok)
- `2026-06-11-feat-jetbrains-ide-plugin-port-part-6-plan.md` — feat(jetbrains): MCP stdio server + host-method completion - Standard (~1257 tok)
- `2026-06-11-feat-jetbrains-ide-plugin-port-part-7-plan.md` — feat(jetbrains): hardening, packaging, and Marketplace submission - Standard (~955 tok)
- `2026-06-11-feat-jetbrains-ide-plugin-port-plan.md` — feat: port AI Engineer Coach to JetBrains IDEs - Extensive (~11413 tok)

## docs/reviews/

- `architecture-review.md` — Architecture Review — Part 5 Trust Gate (~2706 tok)
- `code-simplicity-review.md` — Code Simplicity Review — Part 5 (Trust Gate UI & Project Rule Scoping) (~2573 tok)
- `pr-readiness-review-part5.md` — PR Readiness Review: Part-5 Trust Gate UI and Project Rule Scoping (~1716 tok)
- `pr-readiness-review.md` — PR Readiness Review: Part-4 JetBrains Plugin — Theme Integration & State Persistence (~2638 tok)
- `security-review.md` — Security Review — Part 5: Trust Gate (Rule/Metric DSL) (~3836 tok)
- `test-quality-review-trust-gate.md` — Test Quality Review — Trust-Gate Feature (~3745 tok)
- `test-quality-review.md` — Test Quality Review — Part 4: Theme Integration & State Persistence (~2780 tok)
- `vgv-review.md` — VGV Code Review — Part 4: Theme Integration & Webview State Persistence (~2448 tok)

## gradle/

- `libs.versions.toml` (~193 tok)

## gradle/wrapper/

- `gradle-wrapper.jar` (~11127 tok)
- `gradle-wrapper.properties` (~68 tok)

## plugin/

- `build.gradle.kts` — ", "metrics/**") (~880 tok)

## plugin/src/main/kotlin/com/aicoach/jetbrains/jcef/

- `AssetSchemeHandler.kt` — Serves the webview bundle to JCEF from the plugin JAR under a real origin. (~1721 tok)
- `WebviewBridge.kt` — The per-window JS<->host relay: one bridge per open dashboard tool window. (~2791 tok)

## plugin/src/main/kotlin/com/aicoach/jetbrains/settings/

- `CoachSettings.kt` — Application-level persisted settings. (~433 tok)
- `CoachSettingsConfigurable.kt` — Settings UI for the Node path override. Intentionally a single field: part 3 (~507 tok)

## plugin/src/main/kotlin/com/aicoach/jetbrains/sidecar/

- `NodeDetector.kt` — Locates a usable Node.js (>= 20) for the sidecar. (~2848 tok)
- `SidecarProcess.kt` — The production [SidecarTransport]: a single Node child process plus the NDJSON (~1165 tok)
- `SidecarRuntime.kt` — On-disk layout and lifecycle for the extracted Node runtime. (~2060 tok)
- `SidecarService.kt` — The one application-level sidecar shared by every IDE window (decision D4). (~1290 tok)
- `SidecarSupervisor.kt` — The app-level sidecar's protocol policy, free of any IntelliJ or process (~3900 tok)

## plugin/src/main/kotlin/com/aicoach/jetbrains/theme/

- `ThemeCssProvider.kt` — Derives the 23 webview theme variables from the live IDE theme and serializes (~1554 tok)
- `WebviewThemeSync.kt` — Keeps one open dashboard window's webview in sync with the live IDE theme. (~524 tok)

## plugin/src/main/kotlin/com/aicoach/jetbrains/toolwindow/

- `CoachToolWindowFactory.kt` — The dashboard tool window. Lazy and `DumbAware` so it opens during indexing. (~2045 tok)

## plugin/src/main/kotlin/com/aicoach/jetbrains/trust/

- `LocalRuleWatcher.kt` — Watches the personal and project rule/metric directories for edits so the (~1214 tok)
- `TrustApprovalDialog.kt` — The rule/metric trust review dialog (decision D5). (~1253 tok)
- `TrustGateController.kt` — One trust-pending local rule/metric, as surfaced by the sidecar. (~1780 tok)
- `TrustStoreService.kt` — Host-side persistent store backing the sidecar's `TrustMemento` RPC contract (~779 tok)

## plugin/src/main/resources/META-INF/

- `plugin.xml` (~528 tok)

## plugin/src/main/resources/icons/

- `coach.svg` (~86 tok)

## plugin/src/main/resources/webview/

- `bootstrap.js` — Declares postToHost (~622 tok)
- `index.html` — AI Coach (~1925 tok)

## plugin/src/test/kotlin/com/aicoach/jetbrains/jcef/

- `AssetSchemeHandlerTest.kt` — The pure, platform-free part of the scheme handler: the preamble prepended to (~271 tok)

## plugin/src/test/kotlin/com/aicoach/jetbrains/sidecar/

- `NodeDetectorTest.kt` — Cascade logic for [NodeDetector] with the version probe and filesystem checks (~1580 tok)
- `SidecarSupervisorTest.kt` — Drives [SidecarSupervisor]'s protocol and lifecycle policy with fakes — no (~4020 tok)

## plugin/src/test/kotlin/com/aicoach/jetbrains/theme/

- `ThemeCssProviderTest.kt` — Serialization and mapping logic for [ThemeCssProvider] with the IDE theme (~1380 tok)

## plugin/src/test/kotlin/com/aicoach/jetbrains/trust/

- `TrustGateParsingTest.kt` — Unit tests for [parsePendingRules] — the pure wire-parsing of the sidecar's (~572 tok)
- `TrustStoreServiceTest.kt` — Pure logic for [TrustStoreService]: [TrustStoreService.snapshot], (~905 tok)

## sidecar/

- `esbuild.mjs` — esbuild config for the sidecar bundles. (~1627 tok)
- `package-lock.json` — npm lock file (~22886 tok)
- `package.json` — Node.js package manifest (~223 tok)
- `vitest.config.mts` — : the vendored upstream tests (byte-identical to upstream), (~206 tok)

## sidecar/src/

- `cache-paths.test.ts` (~290 tok)
- `cache-paths.ts` — Env var the vendored cache module reads to locate its directory. (~580 tok)
- `host-shims.test.ts` — API routes: GET (5 endpoints) (~596 tok)
- `host-shims.ts` — A request channel to the IDE host, multiplexed over the sidecar's stdout. (~983 tok)
- `main.ts` — Declares protocolWrite (~694 tok)
- `rpc-handlers.test.ts` — HandlerContext: emptyParseResult, ctx (~1108 tok)
- `rpc-handlers.ts` — Per-request context handed to every handler. (~2836 tok)
- `rpc-server.ts` — Protocol version reported in the `hello` handshake. (~2905 tok)
- `rule-scope.ts` — Trust-pending file as surfaced to the webview (content withheld). (~2095 tok)

## sidecar/test/

- `_probe.test.ts` — Declares root (~344 tok)
- `global-setup.ts` — Exports setup (~295 tok)
- `harness.ts` — Answer a sidecar host-request, mirroring the part-3 bridge's stubbed trust (~1519 tok)
- `host-channel.test.ts` — Declares PERSONAL_RULE (~661 tok)
- `paths.ts` — Repo-relative sidecar dir (`.../sidecar`). (~369 tok)
- `rpc-methods.ts` — All 55 core methods. (~965 tok)
- `sidecar-rpc.test.ts` — "Answered" = a real handler ran, not unknown-method / not-ready. (~2561 tok)
- `trust-gate.test.ts` — Approve every pending file for the given project root, then reload it. (~3204 tok)

## sidecar/test/fixtures/

- `generate-fixtures.mjs` — mulberry32: tiny deterministic PRNG. (~1460 tok)

## sidecar/vendor/core/

- `ai-credits.test.ts` — BASE_TS: req, sess (~7496 tok)
- `analyzer-base.ts` — Total LoC for a request: code-block lines + agent-mode edit lines. (~978 tok)
- `analyzer-config.test.ts` — resolveWorkspaceRootMock: makeSession, makeRequest, makeWorkspace + 3 more (~6936 tok)
- `analyzer-config.ts` — Exports ConfigAnalyzer (~7438 tok)
- `analyzer-consumption.ts` — Per-request billing token attribution. (~15158 tok)
- `analyzer-context.ts` — Infer the model's context window for a session from the largest native (~10894 tok)
- `analyzer-dashboard.test.ts` — makeRequest: makeSession, createAnalyzer (~4294 tok)
- `analyzer-dashboard.ts` — Exports DashboardAnalyzer (~6196 tok)
- `analyzer-flow.test.ts` — Create a session with rapid follow-ups (deep flow) (~2505 tok)
- `analyzer-flow.ts` — Compute flow score for a session based on follow-up latencies and session structure. (~3352 tok)
- `analyzer-images.ts` — Unique key for dedup (requestId) (~3234 tok)
- `analyzer-insights.test.ts` — makeRequest: makeSession, createAnalyzer (~4970 tok)
- `analyzer-insights.ts` — Exports InsightsAnalyzer (~8300 tok)
- `analyzer-patterns.test.ts` — makeRequest: makeSession, createAnalyzer (~3392 tok)
- `analyzer-patterns.ts` — Exports PatternsAnalyzer (~6330 tok)
- `analyzer-production.ts` — Exports ProductionAnalyzer (~1585 tok)
- `analyzer-timeline.test.ts` — makeRequest: makeSession, createAnalyzer (~3410 tok)
- `analyzer-timeline.ts` — Exports TimelineAnalyzer (~3373 tok)
- `analyzer-token-coverage.test.ts` — BASE_TS: req, sess (~6434 tok)
- `analyzer-workflows.test.ts` — makeRequest: makeSession, createAnalyzer (~2314 tok)
- `analyzer-workflows.ts` — Minimum prompt length to consider for clustering (skip trivial messages) (~2767 tok)
- `analyzer.test.ts` — Simulates panel.ts validateDateFilter -- this is the exact logic (~7947 tok)
- `analyzer.ts` — Public access to filtered requests for rule editor preview. (~3460 tok)
- `antipatterns-e2e.test.ts` — End-to-end test for the Anti-Patterns pipeline. (~7189 tok)
- `cache-write-worker.ts` — CacheWriteWorkerData: isCacheWriteWorkerData (~358 tok)
- `cache.test.ts` — API routes: GET (1 endpoints) (~2367 tok)
- `cache.ts` — Fast directory fingerprint. (~4297 tok)
- `config-health-helpers.test.ts` — tempDirs: makeTempDir, writeFile (~3741 tok)
- `config-health-helpers.ts` — Exports resolveWorkspaceRoot, isCloudPath, scanConfigFiles, scanPersonalSkillFiles (~5746 tok)
- `constants.test.ts` — Declares today (~889 tok)
- `constants.ts` — Exports MODEL_MULTIPLIERS, LOC_COST_2010, TokenRate, MODEL_TOKEN_RATES + 39 more (~2337 tok)
- `context-management.test.ts` — Build N requests with linearly increasing promptTokens. (~14068 tok)
- `debug-gaps.test.ts` — Declares allReqs (~839 tok)
- `detector-registry.ts` — Build a weekly histogram with continuous labels (fill gaps with 0). (~2970 tok)
- `detectors.ts` (~145 tok)
- `helpers.test.ts` — Declares ts (~1969 tok)
- `helpers.ts` — decodeURIComponent that returns the input unchanged on malformed sequences (e.g. a literal `%` in a path). (~3511 tok)
- `log.test.ts` (~565 tok)
- `log.ts` — Exports CoreLogLevel, CoreLogEntry, debugCore, infoCore + 2 more (~664 tok)
- `metric-engine.test.ts` — Declares md (~4882 tok)
- `metric-engine.ts` — Metric engine: parses .metric.md files, evaluates metrics via the DSL, (~5426 tok)
- `parse-worker.ts` — LoadProgress: send, parseWorkerRequest, onMessage (~1220 tok)
- `parser-claude.test.ts` — os.tmpdir() on Windows often returns 8.3 short names (e.g. TAMASB~1) (~6618 tok)
- `parser-claude.ts` — Present on `type: 'image'` blocks: the inline screenshot bytes. (~8003 tok)
- `parser-codex-extra.test.ts` — CodexFixture: withCodexRoot, stringifyLines, writeCodexFixture + 4 more (~7142 tok)
- `parser-codex.test.ts` — Declares withCodexFile (~3337 tok)
- `parser-codex.ts` — Tool names (lowercase) that actually write/edit files. (~5297 tok)
- `parser-harnesses.test.ts` — Run `body` with HOME/USERPROFILE pointed at a fresh temp dir, restoring the (~728 tok)
- `parser-harnesses.ts` — Returns true if any external-harness (Claude Code, Codex, OpenCode) session (~1562 tok)
- `parser-main.test.ts` — API routes: GET (2 endpoints) (~4157 tok)
- `parser-opencode.test.ts` — Declares withStorage (~1435 tok)
- `parser-opencode.ts` — Exports findOpenCodeDirs, parseOpenCodeSessions (~3223 tok)
- `parser-shared.test.ts` — Declares makeReq (~2020 tok)
- `parser-shared.ts` — Validates that a file path is within trusted directories and does not (~3827 tok)
- `parser-vscode-cli.ts` — Accumulated state for a single user turn (user.message → next user.message). (~4303 tok)
- `parser-vscode-files.test.ts` — tempDirs: makeTempDir, withTempFile (~3323 tok)
- `parser-vscode-files.ts` — Strip byte-array image data: patterns like "data":[255,216,255,...] (~4303 tok)
- `parser-vscode.test.ts` — withTempFile: withChatSession (~8726 tok)
- `parser-vscode.ts` — Exports harnessFromPath, findVsCodeDirs, scanVsCodeDirs, WorkspaceParseProgress + 2 more (~10546 tok)
- `parser-xcode.test.ts` — tempDirs: makeTempDir (~639 tok)
- `parser-xcode.ts` — Fast Turn query that avoids sqlite3's slow -json serialization. (~3628 tok)
- `parser.bench.ts` — ─── Helpers ──────────────────────────────────────────────────────────────── (~2101 tok)
- `parser.ts` — Running total of AI-generated lines of code discovered so far. (~8293 tok)
- `profanity.test.ts` — Test fixtures for the profanity detector. Inputs are base64-encoded so (~807 tok)
- `profanity.ts` — Profanity detection backed by the `leo-profanity` dictionary, so the (~475 tok)
- `rpc-result.test.ts` (~301 tok)
- `rule-compiler.test.ts` — Declares result (~1608 tok)
- `rule-compiler.ts` — NL Rule Compiler: converts natural-language rule descriptions into DSL (~2905 tok)
- `rule-engine-facade.test.ts` — Declares rules (~876 tok)
- `rule-engine-facade.ts` — RuleEngine facade. (~1128 tok)
- `rule-engine.test.ts` — RuleOptions: makeRuleMarkdown, makeRequest, makeSession, makeAntiPattern, makeEmission (~7111 tok)
- `rule-engine.ts` — Rule engine: loads detection rules from markdown files and bridges them with (~2883 tok)
- `rule-equivalence.test.ts` — Rule regression test. (~2168 tok)
- `rule-loader.test.ts` — TrustGate: makeMetricDefinition, mockDirectories, mockFiles, makeTrustGate, loadRuleLoader (~7183 tok)
- `rule-loader.ts` — Multi-layer rule loader. (~4347 tok)
- `rule-parser.ts` — Rule parser: reads markdown-based rule definitions and produces DetectionRule objects. (~4864 tok)
- `rule-pipeline.ts` — Universal rule pipeline engine. (~3604 tok)
- `rule-trust.test.ts` — TrustMemento: makeFakeMemento (~1030 tok)
- `rule-trust.ts` — Trust gate for locally-authored rule / metric markdown files. (~1724 tok)
- `runtime-debug.test.ts` — Declares p (~1195 tok)
- `runtime-debug.ts` — Exports getRuntimeDebugLogPath, setOutputHook, runtimeDebug, installRuntimeDebugHooks (~1016 tok)
- `schemas.test.ts` — makeRequest: makeSession (~1091 tok)
- `schemas.ts` — Validates parsed sessions and filters out invalid ones. (~1137 tok)
- `summary-export.test.ts` — Declares stats (~1551 tok)
- `summary-export.ts` — Exports SummaryExportInput, SummaryExportAnalyzer, SummaryExportReport, buildSummaryExport + 4 more (~2646 tok)
- `types.ts` (~188 tok)
- `warm-up-worker.ts` — WarmUpWorkerRequest: isWarmUpWorkerRequest (~484 tok)

## sidecar/vendor/core/detectors/

- `scoring.ts` — Exports computeWeeklyTrend, computeWeeklyScores (~1089 tok)

## sidecar/vendor/core/dsl/

- `dsl.test.ts` — Declares tokens (~3242 tok)
- `index.ts` — Public API for the metric expression DSL. (~2121 tok)
- `interpreter.test.ts` — Declares numberNode (~5162 tok)
- `interpreter.ts` — AST interpreter for the metric expression DSL. (~19853 tok)
- `lexer.ts` — Lexer for the metric expression DSL. (~2034 tok)
- `parser.ts` — Recursive-descent parser for the metric expression DSL. (~2032 tok)
- `safe-regex.test.ts` — Declares re (~3242 tok)
- `safe-regex.ts` — Max pattern length. Anything longer is almost certainly a mistake. (~2292 tok)
- `schema.ts` — Field schema for SessionRequest and Session types. (~4164 tok)
- `types.ts` — AST and token types for the metric expression DSL. (~1054 tok)

## sidecar/vendor/core/metrics/

- `agentic-no-tools.metric.md` — Filter (~63 tok)
- `canceled-requests.metric.md` — Filter (~52 tok)
- `capslock-messages.metric.md` — Filter (~56 tok)
- `late-night-requests.metric.md` — Filter (~62 tok)
- `mega-sessions.metric.md` — Filter (~50 tok)
- `no-custom-instructions.metric.md` — Filter (~59 tok)
- `no-file-refs.metric.md` — Filter (~57 tok)
- `short-messages.metric.md` — Filter (~61 tok)
- `slow-responses.metric.md` — Filter (~59 tok)
- `weekend-requests.metric.md` — Filter (~64 tok)

## sidecar/vendor/core/rules/

- `abandon-sessions.md` — Description (~206 tok)
- `agent-mode-for-asks.md` — Description (~503 tok)
- `agentic-no-tools.md` — Description (~203 tok)
- `auto-approve-terminal.md` — Description (~262 tok)
- `auto-avoidance.md` — Description (~342 tok)
- `broken-flow-state.md` — Description (~404 tok)
- `cache-hit-starvation.md` — Description (~404 tok)
- `caps-lock.md` — Description (~216 tok)
- `context-engineering-gaps.md` — Description (~420 tok)
- `copy-paste-blindness.md` — Description (~313 tok)
- `excessive-file-context.md` — Description (~400 tok)
- `frustration-signals.md` — Description (~359 tok)
- `high-cancellation.md` — Description (~187 tok)
- `instruction-bloat.md` — Description (~403 tok)
- `late-night-coding.md` — Description (~222 tok)
- `lazy-prompting.md` — Description (~289 tok)
- `low-constraint-usage.md` — Description (~461 tok)
- `low-markdown-ratio.md` — Description (~401 tok)
- `mcp-tool-bloat.md` — Description (~279 tok)
- `mega-sessions.md` — Description (~202 tok)
- `model-overreliance.md` — Description (~244 tok)
- `no-custom-instructions.md` — Description (~270 tok)
- `no-devcontainer.md` — Description (~357 tok)
- `no-file-context.md` — Description (~212 tok)
- `no-language-exploration.md` — Description (~292 tok)
- `no-plan-mode.md` — Description (~317 tok)
- `no-skills.md` — Description (~200 tok)
- `no-slash-commands.md` — Description (~228 tok)
- `no-spec-driven-development.md` — Description (~658 tok)
- `no-spec-structure.md` — Description (~389 tok)
- `premium-for-lookup-questions.md` — Description (~405 tok)
- `premium-waste.md` — Description (~220 tok)
- `profanity.md` — Description (~215 tok)
- `reasoning-effort-overuse.md` — Description (~396 tok)
- `repeated-prompts.md` — Description (~251 tok)
- `runaway-agent-loops.md` — Description (~267 tok)
- `session-drift.md` — Description (~238 tok)
- `slow-responses.md` — Description (~213 tok)
- `speed-accept.md` — Description (~316 tok)
- `tunnel-vision.md` — Description (~281 tok)
- `verbose-output.md` — Description (~428 tok)
- `verbose-prompt-no-compression.md` — Description (~492 tok)
- `vibe-coding.md` — Description (~397 tok)
- `weekend-overwork.md` — Description (~236 tok)
- `yolo-mode.md` — Description (~253 tok)

## sidecar/vendor/core/types/

- `analytics-types.ts` — 7×24 grid of focus scores (0-100) based on activity density (~6141 tok)
- `catalog-types.ts` — Exports TriageVerdict, TriagedCluster, SkillTriageResult, CatalogItemKind + 3 more (~328 tok)
- `config-types.ts` — Epoch ms of file's last modification time (~773 tok)
- `context-types.ts` — Percentage of estimated context window used on average (0-100) (~2188 tok)
- `insights-types.ts` — Exports SessionIntent, SESSION_INTENTS, INTENT_COLORS, LearningVelocityData + 7 more (~1077 tok)
- `rpc-types.ts` — Canonical error-payload shape returned by RPC handlers that surface a (~2849 tok)
- `rule-types.ts` — Where a rule was loaded from, in order of precedence (lowest to highest): (~2049 tok)
- `session-types.ts` — Authoritative per-model usage totals reported at the session level (~2418 tok)

## sidecar/vendor/webview/

- `app.ts` — Navigation hint: which sub-section to auto-open after navigating (~8447 tok)
- `dsl-cheatsheet.test.ts` (~330 tok)
- `dsl-cheatsheet.ts` — Shared DSL cheat-sheet text used in system prompts for rule generation (~1312 tok)
- `fetch-utils.test.ts` — Declares response (~348 tok)
- `fetch-utils.ts` — API routes: GET (1 endpoints) (~363 tok)
- `html-tag.test.ts` — The `html` tagged template and `rawHtml` marker live in shared.ts which imports (~1035 tok)
- `page-achievements.ts` — Historical daily data for date estimation (~8136 tok)
- `page-antipatterns-editor.test.ts` — Declares sampleMd (~892 tok)
- `page-antipatterns-editor.ts` — Wire the rule editor modal's event handlers. `onSaved` is invoked after a (~5145 tok)
- `page-antipatterns-heatmap.ts` — Render the rule coverage heatmap (rules x workspaces) into `container`. (~1754 tok)
- `page-antipatterns.ts` — Exports renderAntiPatterns (~15156 tok)
- `page-burndown.ts` — Per-model monthly token budgets — persisted to disk via extension globalState. (~7801 tok)
- `page-config.ts` — Active treemap chart reference + workspace data for review highlighting (~13623 tok)
- `page-context-mgmt.ts` — Exports renderContextManagement (~11057 tok)
- `page-dashboard.ts` — Module-level view state — survives filter/harness changes. (~6468 tok)
- `page-data-explorer.ts` — Exports renderDataExplorer (~2166 tok)
- `page-dsl-reference.ts` — Renders DSL Reference content into the given container (async — fetches schema data). (~4012 tok)
- `page-experiments.ts` — Keys of all Level-Up features (~2764 tok)
- `page-image-gallery.ts` — Score a story for interestingness (~5835 tok)
- `page-insights.ts` — Exports renderInsights (~6551 tok)
- `page-learning-snake.ts` — Exports renderSnakeGame (~1418 tok)
- `page-learning-state.ts` — Exports ConceptDef, DEFAULT_CONCEPTS, EXCLUDED_LANGS, normalizeLang + 21 more (~2992 tok)
- `page-learning-templates.test.ts` — Serialize VNodes (or arrays of VNodes) to an HTML string for assertion. (~869 tok)
- `page-learning-templates.ts` — Exports renderResourcesHtml, renderCodeReviewRound, renderDidYouKnowHtml, renderQuiz (~1423 tok)
- `page-learning.ts` — generateQuizCached: updateSidebar, updateStats, buildLearningMarkup (~11753 tok)
- `page-output.ts` — Exports renderOutput (~12365 tok)
- `page-patterns.ts` — Maps a 0-1 intensity to a flame gradient: (~6239 tok)
- `page-peers.ts` — Exports renderShareCard (~4366 tok)
- `page-rule-editor.ts` — Exports renderRuleEditor (~7408 tok)
- `page-rule-playground.ts` — Exports renderRulePlayground (~3347 tok)
- `page-sdlc.ts` — Exports renderSdlc (~3927 tok)
- `page-skills.ts` — Set of cluster IDs the user has dismissed in this session (~5653 tok)
- `page-timeline.ts` — Exports renderTimeline (~4816 tok)
- `page-workflows.ts` — Exports renderWorkflows (~1649 tok)
- `panel-cache.ts` — Exports panelCache (~272 tok)
- `panel-catalog.ts` — Remove HTML tags iteratively until stable (avoids incomplete sanitization). (~906 tok)
- `panel-html.ts` — Exports getDashboardHtml, getErrorHtml (~2037 tok)
- `panel-llm.ts` — Repair JSON that was cut off mid-stream (e.g. when the model hit its output (~4327 tok)
- `panel-request-service.ts` — Exports PanelRequestService (~18382 tok)
- `panel-rpc.test.ts` (~330 tok)
- `panel-rpc.ts` — Pick `reqs` or `sessions` based on scope and return them typed as (~14872 tok)
- `panel-shared.test.ts` — Declares base (~1236 tok)
- `panel-shared.ts` — Build a typed error payload. Use this instead of `{ error: 'msg' }` literals (~1202 tok)
- `panel-sidebar.ts` — Exports DashboardSidebarProvider (~893 tok)
- `panel.ts` — Exports DashboardPanel (~4123 tok)
- `render.ts` — Secure rendering layer using Preact + htm. (~1328 tok)
- `shared.ts` — Send a typed RPC call. Pass the expected result type as the generic, e.g. (~4799 tok)
- `skill-cache.ts` — Store results scoped to the current filter (~458 tok)
- `styles-learning.css` — Styles: 120 rules, 1 animations (~5375 tok)
- `styles-pages.css` — Styles: 130 rules, 1 media queries (~17208 tok)
- `styles-sidebar.css` — Styles: 5 rules (~540 tok)
- `styles-skills.css` — Styles: 61 rules (~2101 tok)
- `styles.css` — Styles: 68 rules, 28 vars (~27362 tok)
- `svg-icons.ts` — Exports SVG (~4747 tok)
- `vibe-roles.ts` — Exports updateVibeRole (~1766 tok)
- `webview-smoke.test.ts` — Declares and (~921 tok)

## tools/

- `sync-upstream.mjs` — Vendoring pipeline for the upstream AI Engineering Coach VS Code extension. (~1732 tok)

## tools/.upstream-cache/.code-review-graph/

- `.gitignore` — Git ignore rules (~38 tok)

## tools/patches/

- `0001-cache-dir-and-atomic-writes.patch` — Exports CacheData (~674 tok)
- `0002-findlogsdirs-drop-vscode-xcode.patch` — Exports findLogsDirs (~493 tok)
- `0003-panel-shared-type-only-vscode.patch` — Exports RequestMessage (~137 tok)
- `README.md` — Project documentation (~723 tok)

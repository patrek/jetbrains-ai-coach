# Architecture Decision Records

Each ADR records one settled decision (D1–D8) from the
[port plan](../plan/2026-06-11-feat-jetbrains-ide-plugin-port-plan.md). Use
[`0000-template.md`](0000-template.md) for new records.

| ADR | Decision | Summary |
| --- | -------- | ------- |
| [0001](0001-cache-isolation.md) | D1 | Isolate the cache from the VS Code extension |
| [0002](0002-stdio-mcp.md) | D2 | MCP server as a standalone stdio entry point |
| [0003](0003-vendoring.md) | D3 | Share upstream code via a vendored snapshot + sync script |
| [0004](0004-app-level-sidecar-singleton.md) | D4 | One application-level sidecar singleton |
| [0005](0005-kotlin-side-trust-store.md) | D5 | Keep the rule trust store on the Kotlin host |
| [0006](0006-getcapabilities-degradation.md) | D6 | Degrade LLM features via a `getCapabilities` RPC |
| [0007](0007-custom-scheme-handler.md) | D7 | Embed the webview via a custom scheme handler |
| [0008](0008-v1-log-sources.md) | D8 | v1 log sources are CLI harnesses only |

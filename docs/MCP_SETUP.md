# MCP setup guide

AI Usage Coach ships a standalone [MCP](https://modelcontextprotocol.io) server
that exposes 12 analytics tools (`aiEngineerCoach_summary`, `_patterns`,
`_credits`, …) to any MCP client — **and it works with the IDE closed**. It reads
the same cache the IDE writes and parses on its own.

## Prerequisites

- Node.js 20 or newer on `PATH`.
- Open the **AI Usage Coach** tool window at least once so the plugin extracts
  its runtime to `~/.ai-coach-jetbrains/runtime/`.

## Register with Claude Code

```bash
claude mcp add aicoach -- node ~/.ai-coach-jetbrains/runtime/current/mcp-main.js
```

The plugin also shows a one-time balloon offering to copy this exact command.

## Register with any JSON-config MCP client

```json
{
  "mcpServers": {
    "aicoach": {
      "command": "node",
      "args": ["~/.ai-coach-jetbrains/runtime/current/mcp-main.js"]
    }
  }
}
```

## Why `runtime/current/`

The `runtime/current/` path is stable: the plugin re-points it at the active
bundle on every update, so your client config keeps working across plugin
upgrades. The tool names are pinned (`aiEngineerCoach_*`) for the same reason
(ADR [0002](ADR/0002-stdio-mcp.md)).

## Scope and limitations

- **Built-in analytics only.** Custom (personal/project) rules require approval
  in the IDE; the headless MCP path leaves unapproved rules pending and serves
  built-in analytics only.
- **No language-model features.** The 12 MCP tools are read-only analytics. The
  JetBrains plugin ships no LLM, so generation features (quizzes, rule
  generation, etc.) are unavailable on this path — ask Claude Code to do those
  directly (ADR [0006](ADR/0006-getcapabilities-degradation.md)).
- **Directory exclusions** set in the IDE apply to the IDE sidecar. The headless
  MCP server is launched by your MCP client, not the plugin, so it honors the
  `AI_COACH_EXCLUDED_DIRS` environment variable only if you set it in that
  client's environment.

## Verify it works

With the server registered, ask your MCP client for the usage summary (e.g.
invoke `aiEngineerCoach_summary`). A first call may return a partial-data note
while the background parse completes; subsequent calls return the full summary.

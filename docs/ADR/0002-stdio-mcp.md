# ADR 0002: MCP server as a standalone stdio entry point

- **Status:** Accepted
- **Date:** 2026-06-11
- **Decision ID:** D2

## Context

The plugin exposes the same analytics as MCP tools (12 tools, from
`src/mcp/tools.ts`) so they're usable from MCP clients such as Claude Code. We
need a transport. Options: an HTTP/SSE server hosted by the plugin, or a
standalone stdio server the client spawns itself.

A defining requirement: the analytics tools should work **with the IDE closed**.

## Decision

Ship a **standalone stdio MCP server** (`sidecar/src/mcp-main.ts`) using the
`@modelcontextprotocol/sdk` stdio transport. The MCP client spawns the server
process directly. It reads the cache, and parses on a cache miss, entirely on
its own — no IDE process required.

Tool names are pinned as `aiEngineerCoach_*` regardless of plugin branding;
renaming would break users' saved client configs.

## Consequences

- Works IDE-closed, which the in-IDE-hosted alternatives cannot do.
- No ports, no authentication surface, no multi-window port-conflict problem.
- Setup is documentation, not a server: users add a `claude mcp add …` command
  pointing at a stable `runtime/current` path that survives plugin updates.
- Approving untrusted rules still requires the IDE; the headless path leaves
  pending rules silently pending (see [ADR 0005](0005-kotlin-side-trust-store.md)).

## Alternatives considered

- **HTTP/SSE server hosted by the plugin** — rejected: dies when the IDE closes,
  adds port management and an auth surface, and conflicts across IDE windows.

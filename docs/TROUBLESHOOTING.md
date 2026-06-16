# Troubleshooting

## Collect troubleshooting info

The fastest way to file a useful bug report:

**Help → Collect AI Usage Coach Troubleshooting Info**

This copies a plain-text report to your clipboard containing the plugin version,
IDE build, OS/Java, Node detection result, runtime/cache paths, your excluded
directories, and the tail of the sidecar log (`~/.ai-coach-jetbrains/logs/sidecar.log`).
Paste it into your issue. It contains no session content.

## Common issues

### "AI Usage Coach needs Node.js 20 or newer"

The detection cascade (PATH, version-manager defaults, well-known locations)
couldn't find a usable Node. Install Node ≥ 20, or set its absolute path under
**Settings → Tools → AI Usage Coach**, then click **Retry** — no IDE restart
needed.

### The dashboard says the embedded browser (JCEF) is unavailable

Your IDE build doesn't bundle JCEF. Use a standard JetBrains distribution (not a
custom/headless build).

### "The AI Usage Coach sidecar crashed repeatedly"

The sidecar exited too many times in a row. Use **Restart sidecar** to clear the
backoff budget, then check the log via *Collect troubleshooting info*. A common
cause is an incompatible Node version.

### The dashboard hangs on "Building Activity Index"

The first parse can take a while on large histories. If it never completes,
collect troubleshooting info and check the log for a parse error.

### Analytics in Claude Code (MCP) are empty or stale

Open the dashboard tool window once so the runtime extracts, then confirm your
client points at `~/.ai-coach-jetbrains/runtime/current/mcp-main.js`. See
[MCP_SETUP.md](MCP_SETUP.md).

## Manual verification matrix (multi-window & lifecycle)

These scenarios exercise the app-level-singleton (D4) and cache-isolation (D1)
designs across windows, products, and lifecycle events. They require a running
IDE and so are verified manually rather than as unit tests (the protocol and
supervision *policy* is unit-tested in `SidecarSupervisorTest`; the JCEF/EDT and
process glue is thin and verified here).

### Multi-window

| Scenario | Expected |
| -------- | -------- |
| Two projects open in one IDE | One shared sidecar; each request is scoped to its own project root (project A's rules never run on project B). |
| Two different JetBrains products open at once | Two independent plugin instances, each with its own app-level sidecar; no port usage to collide (MCP is stdio, D2). |
| Open/close the dashboard repeatedly | Page/filter survive hide/show; reset on full IDE restart (upstream parity — only learning/budgets/experiments/achievements persist). |

### Lifecycle

| Scenario | Expected |
| -------- | -------- |
| Kill the IDE (no clean shutdown) | No orphaned Node process survives; the next launch sweeps the recorded stale pid (`SidecarRuntime.sweepStaleProcess`). |
| Crash mid-parse | Next launch resumes from the cache (`dirMetas`); a corrupted/truncated cache is treated as a miss and re-parsed, never a crash. |
| Update the plugin | Runtime re-extracts (bundle-fingerprint freshness) and `runtime/current/` re-points at the new bundle, so the MCP client config keeps working. |
| Uninstall the plugin | Running processes are killed; the user cache and `~/.ai-coach-jetbrains/` content are left in place. |

### Orphan check (any platform)

After killing the IDE, confirm no leftover sidecar:

```bash
pgrep -af "ai-coach-jetbrains/runtime"
```

It should print nothing once the IDE is gone (or be swept on the next launch).

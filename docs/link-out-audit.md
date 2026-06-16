# Link-out audit

Every dashboard action that, upstream, opened something outside the webview must
map to a JetBrains idiom or be gated — never silently do nothing. This audit
covers the **webview client** (`vendor/webview/app.ts` + `page-*.ts`), which is
the only part that runs in JCEF; the `panel*.ts` files are the VS Code extension
host the Kotlin bridge replaces and never execute in this port.

| Action (webview) | Upstream | JetBrains mapping |
| ---------------- | -------- | ----------------- |
| Social/share links, external URLs (`page-peers.ts`) | `vscode.env.openExternal` | `openExternal` RPC → `BrowserUtil.browse` (bridge) |
| Export dashboard summary (`page-peers.ts`) | VS Code save dialog | `exportSummary` → IntelliJ directory chooser; success offers **Show in Files** (`RevealFileAction`) |
| Review local rules (trust) | `aiEngineerCoach.reviewLocalRules` command | `reviewLocalRules` → `TrustApprovalDialog` (bridge) |

No webview action opens a rule/metric file in the editor: rules are authored
in-place via the in-webview source editor (`getRuleSource` + `saveRule`); the
on-disk paths are shown only as documentation text. So there is no file-open
link-out to map to `OpenFileDescriptor` — the anticipated idiom has no call site.

All remaining `vscode.*` calls in the vendored tree live in the replaced
extension-host files (`panel.ts`, `panel-sidebar.ts`, `panel-rpc.ts`,
`panel-request-service.ts`) and are dead in this port — their methods are either
host-intercepted by the bridge or degrade (LLM), per the disposition table
([ADR 0009](ADR/0009-extension-method-disposition.md)).

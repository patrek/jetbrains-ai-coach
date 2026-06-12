# ADR 0007: Embed the webview via a custom scheme handler

- **Status:** Accepted
- **Date:** 2026-06-11
- **Decision ID:** D7

## Context

The dashboard is a web UI rendered in JCEF (the bundled Chromium). We need to
serve the bundled webview resources (HTML, JS, CSS) into the browser component.
JCEF offers `loadHTML(...)` and a custom `CefSchemeHandlerFactory`.

`loadHTML` proxies content through a `file://`-style origin, which breaks
relative `<script src>` resolution and gives the page no real, stable origin.

## Decision

Serve the webview through a **custom scheme handler** at
`https://aicoach/index.html` (`AssetSchemeHandler.kt`, registered via
`CefSchemeHandlerFactory`). It serves bundled resources directly from the plugin
JAR.

Because a custom scheme has no Content-Security-Policy unless we serve one, the
handler serves a CSP equivalent to upstream `panel-html.ts` (script-src
restricted to the scheme, no remote origins) — the webview renders data derived
from untrusted session logs, so the CSP is load-bearing.

## Consequences

- Relative resource resolution works; the page has a real origin, enabling
  `localStorage` and Trusted Types.
- The serve-time request hook also lets us inline initial state and pre-injected
  theme CSS before first render (the `getState` shim).
- We own the CSP and must keep it in sync with upstream's intent.

## Alternatives considered

- **`loadHTML`** — rejected: breaks relative `<script src>` resolution and
  provides no real origin for `localStorage` / Trusted Types.

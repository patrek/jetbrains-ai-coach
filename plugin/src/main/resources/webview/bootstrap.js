/*
 * acquireVsCodeApi shim for JCEF.
 *
 * This is the byte-for-byte host contract that lets the *unmodified* upstream
 * webview bundle (app.js) run inside a JetBrains tool window — the same trick
 * the upstream Playwright harness uses (tests/e2e/harness.html). It defines
 * window.acquireVsCodeApi BEFORE app.js loads, so shared.ts's module-level
 * `acquireVsCodeApi()` call resolves to this shim.
 *
 * AssetSchemeHandler prepends two things to this file at request time:
 *   - `window.__INITIAL_STATE__` — the persisted webview UI state, read from
 *     PropertiesComponent, so getState() is synchronous (JCEF has no sync
 *     JS->host call);
 *   - the minimal anti-flash theme (editor background + foreground CSS vars),
 *     so the first paint is in the IDE theme, not white. The full 21-variable
 *     theme mapping and live updates are part 4's concern.
 *
 * The host wires `window.__aicoachPost` (a JBCefJSQuery bridge) on load; until
 * then outbound messages queue and flush via `window.__aicoachFlush`.
 */
(function () {
  'use strict';

  var stateCache = window.__INITIAL_STATE__ || {};
  var outbox = [];

  function postToHost(message) {
    if (typeof window.__aicoachPost === 'function') {
      window.__aicoachPost(JSON.stringify(message));
    } else {
      outbox.push(message);
    }
  }

  // The bridge injects __aicoachPost then calls this to drain anything the
  // webview tried to send before the bridge finished wiring.
  window.__aicoachFlush = function () {
    if (typeof window.__aicoachPost !== 'function') return;
    var queued = outbox.splice(0, outbox.length);
    for (var i = 0; i < queued.length; i++) {
      window.__aicoachPost(JSON.stringify(queued[i]));
    }
  };

  window.acquireVsCodeApi = function () {
    return {
      postMessage: function (message) {
        postToHost(message);
      },
      getState: function () {
        return stateCache;
      },
      setState: function (state) {
        stateCache = state;
        // Persist host-side (survives tool-window hide/show and IDE restart).
        postToHost({ type: 'persistState', state: state });
        return state;
      },
    };
  };
})();

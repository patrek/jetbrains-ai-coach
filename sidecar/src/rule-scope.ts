/*
 * Trust-gate installation and per-request project rule scoping.
 *
 * SECURITY PURPOSE
 * ----------------
 * This module is the ONLY enforcement point against arbitrary, user-supplied
 * rule/metric DSL executing inside the sidecar. Personal
 * (`~/.ai-engineer-coach/rules|metrics/`) and project
 * (`<root>/.ai-engineer-coach/rules|metrics/`) markdown files are NOT trusted by
 * default — a malicious repository could drop a `.ai-engineer-coach/rules/`
 * directory whose DSL runs the moment the dashboard opens. The vendored trust
 * gate (`rule-trust.ts`) implements trust-on-first-use: a file is admitted only
 * if its exact content hash was previously approved; everything else is blocked
 * and queued in the in-memory pending list, never executed. We install that gate
 * here and perform every rule/metric (re)load THROUGH it.
 *
 * WHY THE MUTEX
 * -------------
 * The rule/metric engines are PROCESS-GLOBAL singletons, but one shared sidecar
 * serves every IDE window. Two windows on different projects would otherwise race
 * to clear+reload the project layer, so window A could observe window B's project
 * rules (cross-project leakage). `run()` serializes all scoped work through a
 * single promise chain (a mutex): a task reloads the project layer for ITS root
 * only when the currently-loaded root differs, then runs while holding the lock,
 * so no other root's rules can be present concurrently.
 *
 * WHY APPROVAL IS SIDECAR-DRIVEN (TOCTOU)
 * ---------------------------------------
 * Approval records the hash of the AS-LOADED content captured in the pending
 * list, never a fresh re-read of the file. If approval re-read the file, an
 * attacker could swap the file between display and approval (time-of-check /
 * time-of-use) and get malicious content trusted under a benign hash. By
 * approving the pending entry's retained `content`, the hash the user saw is the
 * hash that gets trusted; any later edit changes the hash and re-blocks the file.
 *
 * METRIC-SNAPSHOT WORKAROUND
 * --------------------------
 * The vendored `loadAllMetricLayers()` does `clearMetrics()` then
 * `registerAllBuiltinMetrics()` — but `registerAllBuiltinMetrics()` is guarded by
 * a one-time module flag, so calling `loadAllMetricLayers()` a SECOND time
 * permanently drops the built-in metrics (the guard short-circuits the re-load
 * after the clear). We must reload metrics on every project switch, so we cannot
 * use it. Instead we snapshot the built-in metrics once (the first time the guard
 * lets them register) and re-seed them by hand on every reload, before the gated
 * personal/project layers. Register order is builtin -> personal -> project so a
 * project metric overrides a personal one overrides a built-in one (by id).
 */

import {
  createTrustGate,
  getDefaultTrustStore,
  getPending,
  clearPending,
  approve,
  type PendingEntry,
} from '../vendor/core/rule-trust';
import {
  setDefaultTrustGate,
  registerAllBuiltinRules,
  loadPersonalRules,
  loadProjectRules,
  registerAllBuiltinMetrics,
  loadPersonalMetrics,
  loadProjectMetrics,
} from '../vendor/core/rule-loader';
import { clearLayerRules } from '../vendor/core/rule-engine';
import {
  registerMetric,
  getAllMetrics,
  clearMetrics,
  type MetricDefinition,
} from '../vendor/core/metric-engine';

/** Trust-pending file as surfaced to the webview (content withheld). */
export interface PendingRuleInfo {
  filePath: string;
  layer: 'personal' | 'project';
  kind: 'rule' | 'metric';
  hash: string;
}

function toInfo(entry: PendingEntry): PendingRuleInfo {
  return { filePath: entry.filePath, layer: entry.layer, kind: entry.kind, hash: entry.hash };
}

/**
 * Built-in metrics captured the one time the vendored guard lets them register.
 * Re-seeded by hand on every reload — see the module header for the hazard.
 */
let builtinMetricSnapshot: MetricDefinition[] | null = null;

function reloadMetrics(root: string | undefined): void {
  if (!builtinMetricSnapshot) {
    registerAllBuiltinMetrics();
    builtinMetricSnapshot = getAllMetrics().filter((m) => m.source === 'built-in');
  }
  clearMetrics();
  for (const m of builtinMetricSnapshot) registerMetric(m);
  loadPersonalMetrics();
  if (root) loadProjectMetrics(root);
}

class RuleScope {
  private installed = false;
  /** The project root whose layer is currently loaded. '' means none. */
  private loadedKey = '';
  /** Serializes all scoped work so no two roots are ever loaded concurrently. */
  private chain: Promise<void> = Promise.resolve();

  /**
   * Install the trust gate from the default store and perform the first gated
   * reload (no project, no safe-mode). Idempotent. This replaces the ungated
   * `loadPersonalRules()` that ran at `detector-registry.ts` module load.
   */
  install(): void {
    if (this.installed) return;
    this.installed = true;
    const store = getDefaultTrustStore();
    if (store) setDefaultTrustGate(createTrustGate(store));
    this.reloadCurrent(undefined, false);
  }

  /**
   * Full gated reload, rebuilding the pending list from scratch. Safe-mode or no
   * project => the project layer is dropped entirely (built-in + personal only).
   */
  reloadCurrent(projectRoot: string | undefined, safeMode: boolean): void {
    const root = projectRoot && !safeMode ? projectRoot : undefined;
    clearPending();
    registerAllBuiltinRules();
    loadPersonalRules();
    if (root) loadProjectRules(root);
    else clearLayerRules('project');
    reloadMetrics(root);
    this.loadedKey = root ?? '';
  }

  /**
   * Run `fn` while holding the scope lock, reloading the project layer first if
   * the requested root differs from what is loaded. The ONLY caller is the
   * dispatch layer — handlers already run inside this, so they must use the free
   * functions / `reloadCurrent` directly to avoid deadlocking on the chain.
   */
  run<T>(projectRoot: string | undefined, safeMode: boolean, fn: () => T | Promise<T>): Promise<T> {
    const task = this.chain.then(async () => {
      if (!this.installed) this.install();
      const root = projectRoot && !safeMode ? projectRoot : undefined;
      if ((root ?? '') !== this.loadedKey) this.reloadCurrent(projectRoot, safeMode);
      return fn();
    });
    // Keep the chain alive on both success and failure so one rejected task
    // never wedges every later request.
    this.chain = task.then(() => undefined, () => undefined);
    return task;
  }
}

/** The single shared scope for this sidecar process. */
export const ruleScope = new RuleScope();

/** Snapshot of trust-pending files (content withheld). Runs inside `run`. */
export function currentPending(): PendingRuleInfo[] {
  return getPending().map(toInfo);
}

/**
 * Approve the requested pending files at their AS-LOADED content (TOCTOU guard:
 * never re-read from disk). Files not currently pending are ignored. Runs inside
 * `run`; the caller is responsible for the subsequent reload.
 */
export async function approvePending(filePaths: string[]): Promise<void> {
  const store = getDefaultTrustStore();
  if (!store) return;
  const pendingByPath = new Map(getPending().map((e) => [e.filePath, e] as const));
  for (const filePath of filePaths) {
    const entry = pendingByPath.get(filePath);
    if (entry) await approve(store, filePath, entry.content);
  }
}

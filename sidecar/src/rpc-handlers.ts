/*
 * Sidecar RPC handler resolution.
 *
 * The 55 core methods (`RpcMethodMap`) are answered by REUSING the vendored
 * handler map from `panel-rpc.ts` rather than re-deriving it. That module
 * imports only `../core/*` plus two vscode-free webview helpers, and its five
 * inline `require('vscode')` sites all live in try/catch that degrade. Reuse
 * keeps the port in lockstep with upstream fixes (the project's "minimal
 * divergence" rule) instead of duplicating ~650 lines that would rot on every
 * re-sync.
 *
 * Divergent handlers are overridden here:
 *   - generateRule / compileNlRule / explainOccurrence — the three LLM core
 *     methods degrade to a typed `{ error: 'llm-unavailable' }` so the webview
 *     can gate its UI on it (the LLM lives in the IDE host, not the sidecar).
 *   - saveRule — re-derived to take the per-request project root (the envelope
 *     stamp) instead of a VS Code workspace lookup, preserving personal-layer
 *     auto-approval.
 *   - reviewLocalRules — a host-owned action; the bridge intercepts it, but if
 *     it ever reaches the sidecar we answer with a clean typed error.
 *
 * Four of the five `require('vscode')` sites belong to overridden handlers, so
 * they never run. The fifth lives in the vendored `getRuleEditor` (the
 * workspace-root lookup for its rule-layer list); it is NOT overridden here.
 * That require throws and is caught (upstream's own test-context fallback), so
 * `getRuleEditor` degrades to "no project rule layer" — correct for part 2,
 * where no project is attached. Threading the per-request project root into
 * `getRuleEditor` is wired in part 3, when the bridge stamps scope and the
 * rules-editor UI lands. No `vscode` call ever returns a value or crashes the
 * sidecar.
 *
 * One extension method is ported here: `getWorkspaceDeps` (filesystem-only).
 * The remaining extension methods' dispositions are recorded in
 * `docs/ADR/0009-extension-method-disposition.md`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getRpcHandler, validateDateFilter } from '../vendor/webview/panel-rpc';
import { errorResult, isString, isNumber, isRecord } from '../vendor/webview/panel-shared';
import {
  buildSummaryExportFromAnalyzer,
  getSummaryExportFilenames,
  renderSummaryJson,
  renderSummaryMarkdown,
} from '../vendor/core/summary-export';
import { parseRule } from '../vendor/core/rule-parser';
import { getRule, createRuleFromMarkdown } from '../vendor/core/rule-engine';
import { getPersonalRulesDir, getProjectRulesDir } from '../vendor/core/rule-loader';
import { approve as approveTrust, getDefaultTrustStore } from '../vendor/core/rule-trust';
import { ruleScope, currentPending, approvePending } from './rule-scope';
import { SDLC_CATALOG_HANDLERS } from './sdlc-catalog';
import type { Analyzer } from '../vendor/core/analyzer';
import type { ParseResult } from '../vendor/core/parser';

/** Per-request context handed to every handler. */
export interface HandlerContext {
  analyzer: Analyzer;
  parseResult: ParseResult;
  params: Record<string, unknown>;
  /**
   * The owning IDE window's project root, stamped onto the request envelope by
   * the Kotlin bridge. Per-request (no mutable global scope); `undefined` when
   * no project is attached (e.g. the Part 2 stdio test harness).
   */
  projectRoot?: string;
  /**
   * Whether the owning IDE window is in safe-mode (project rule layer disabled).
   * Stamped onto the request envelope by the Kotlin bridge; `undefined`/false
   * means the project layer is loaded normally.
   */
  safeMode?: boolean;
}

export type SidecarHandler = (ctx: HandlerContext) => unknown | Promise<unknown>;

/* ---- LLM degradation ---- */

/** The three LLM core methods (`generateRule`, `compileNlRule`,
 *  `explainOccurrence`) plus the LLM-backed extension methods. All degrade to
 *  the same typed error; the webview gates on `capabilities.llm === false`.
 *  Exported so the test suite can assert every entry degrades. */
export const LLM_UNAVAILABLE_METHODS: ReadonlySet<string> = new Set<string>([
  'generateRule',
  'compileNlRule',
  'explainOccurrence',
  'createSkill',
  'generateSkillContent',
  'generateLearningQuiz',
  'generateLearningResources',
  'generateCodeComparison',
  'generateDidYouKnow',
  'triageSkills',
  'triageCatalog',
  'reviewContextFiles',
]);

/* ---- saveRule (project-scope re-derivation) ---- */

function isPathUnder(resolved: string, dir: string): boolean {
  const base = path.resolve(dir);
  return resolved === base || resolved.startsWith(base + path.sep);
}

/** `inAllowed` gates the write entirely; `isPersonal` gates auto-trust. Mirrors
 *  `panel-rpc.ts:classifyRuleWritePath` but takes the project root explicitly
 *  instead of reading it from `vscode.workspace`. */
function classifyRuleWritePath(filePath: string, projectRoot?: string): {
  inAllowed: boolean;
  isPersonal: boolean;
} {
  const personalDir = getPersonalRulesDir();
  const allowedDirs = [personalDir, ...(projectRoot ? [getProjectRulesDir(projectRoot)] : [])];
  const resolved = path.resolve(filePath);
  return {
    inAllowed: allowedDirs.some(d => isPathUnder(resolved, d)),
    isPersonal: isPathUnder(resolved, personalDir),
  };
}

function resolveRuleFilePath(parsed: NonNullable<ReturnType<typeof parseRule>>, ruleIdParam: string): string {
  if (ruleIdParam) {
    const existing = getRule(ruleIdParam);
    if (existing?.sourceFilePath && (existing.source === 'personal' || existing.source === 'project')) {
      return existing.sourceFilePath;
    }
  }
  const dir = getPersonalRulesDir();
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  const safeId = parsed.id.replaceAll(/[^a-zA-Z0-9_-]+/g, '-').replaceAll(/^-|-$/g, '') || 'custom-rule';
  return path.join(dir, `${safeId}.md`);
}

const saveRule: SidecarHandler = async (ctx) => {
  const { params } = ctx;
  const markdown = isString(params?.markdown) ? params.markdown : '';
  const ruleIdParam = isString(params?.ruleId) ? params.ruleId : '';
  if (!markdown.trim()) return { ok: false };

  const parsed = parseRule(markdown);
  if (!parsed) return { ok: false };

  const filePath = resolveRuleFilePath(parsed, ruleIdParam);
  const { inAllowed, isPersonal } = classifyRuleWritePath(filePath, ctx.projectRoot);
  if (!inAllowed) return { ok: false, error: 'Refusing to write outside rules directories' };

  try {
    fs.writeFileSync(filePath, markdown, 'utf-8');
  } catch (err) {
    return { ok: false, error: `Failed to write ${filePath}: ${String(err)}` };
  }

  // Personal-layer writes are auto-approved (parity with panel-rpc.ts:870-873):
  // the user authored them this session, so they need no re-trust prompt.
  const store = getDefaultTrustStore();
  if (store && isPersonal) {
    try { await approveTrust(store, filePath, markdown); } catch { /* ignore */ }
  }

  const rule = createRuleFromMarkdown(markdown);
  if (rule) rule.sourceFilePath = filePath;
  return { ok: !!rule, filePath };
};

/* ---- getWorkspaceDeps (ported extension method, filesystem-only) ---- */

const getWorkspaceDeps: SidecarHandler = (ctx) => {
  // Clamp both ends: a negative host-supplied limit would otherwise drop items
  // off the end via slice(0, limit).
  const limit = isNumber(ctx.params?.limit) ? Math.max(0, Math.min(ctx.params.limit, 20)) : 10;

  // Order workspaces by most-recent activity, mirroring panel-request-service.
  const activity = new Map<string, number>();
  for (const s of ctx.parseResult.sessions) {
    const ts = s.lastMessageDate || s.creationDate || 0;
    if (ts > (activity.get(s.workspaceId) || 0)) activity.set(s.workspaceId, ts);
  }

  const workspaces = [...ctx.parseResult.workspaces.values()]
    .sort((a, b) => (activity.get(b.id) || 0) - (activity.get(a.id) || 0))
    .slice(0, limit);

  const deps: { workspace: string; dependencies: string[]; devDependencies: string[] }[] = [];
  for (const ws of workspaces) {
    if (!ws.path) continue;
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(ws.path, 'package.json'), 'utf-8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      deps.push({
        workspace: ws.name,
        dependencies: Object.keys(pkg.dependencies ?? {}),
        devDependencies: Object.keys(pkg.devDependencies ?? {}),
      });
    } catch { /* no readable package.json at this root */ }
  }
  return { deps };
};

/* ---- exportSummary content (host-driven IntelliJ save flow, ADR 0009) ---- */
//
// `exportSummary` itself is host-owned: the Kotlin bridge intercepts the
// webview call, runs the IntelliJ directory chooser, and writes the files. It
// gets the file CONTENT from here via a host-originated `hostCall`. The render
// reuses the vendored core verbatim; only the delivery (chooser vs. VS Code save
// dialog) differs from upstream.

const exportSummaryContent: SidecarHandler = (ctx) => {
  const filter = isRecord(ctx.params?.filter) ? validateDateFilter(ctx.params.filter) : undefined;
  const report = buildSummaryExportFromAnalyzer(ctx.analyzer, filter);
  const names = getSummaryExportFilenames(report.generatedAt);
  return {
    files: [
      { filename: names.markdown, content: renderSummaryMarkdown(report) },
      { filename: names.json, content: renderSummaryJson(report) },
    ],
  };
};

/* ---- Resolution ---- */

/* ---- Trust gate (per-request project rule scoping) ---- */
//
// These three run INSIDE the dispatch-level `ruleScope.run`, so they call the
// free functions / `ruleScope.reloadCurrent` directly. They must NEVER call
// `ruleScope.run` — that would deadlock on the same promise-chain mutex.

const getLocalRulesPending: SidecarHandler = () => ({ pending: currentPending() });

const approveLocalRules: SidecarHandler = async (ctx) => {
  const filePaths = Array.isArray(ctx.params?.filePaths) ? ctx.params.filePaths.filter(isString) : [];
  await approvePending(filePaths);
  ruleScope.reloadCurrent(ctx.projectRoot, ctx.safeMode ?? false);
  return { ok: true, pending: currentPending() };
};

const reloadLocalRules: SidecarHandler = (ctx) => {
  ruleScope.reloadCurrent(ctx.projectRoot, ctx.safeMode ?? false);
  return { pending: currentPending() };
};

const OVERRIDES: Record<string, SidecarHandler> = {
  saveRule,
  getWorkspaceDeps,
  reviewLocalRules: () => ({ ok: false, error: 'reviewLocalRules is handled by the IDE host' }),
  getLocalRulesPending,
  approveLocalRules,
  reloadLocalRules,
  exportSummaryContent,
  // SDLC + community-catalog ports (ADR 0009 "Port (part 6)").
  ...SDLC_CATALOG_HANDLERS,
};

/**
 * Resolve the handler for `method`, or `undefined` if the sidecar does not
 * serve it (the server answers unknown methods with a typed error).
 */
export function resolveHandler(method: string): SidecarHandler | undefined {
  if (LLM_UNAVAILABLE_METHODS.has(method)) return () => errorResult('llm-unavailable');
  if (Object.prototype.hasOwnProperty.call(OVERRIDES, method)) return OVERRIDES[method];

  const vendored = getRpcHandler(method);
  if (vendored) return (ctx) => vendored(ctx.analyzer, ctx.parseResult, ctx.params);

  return undefined;
}

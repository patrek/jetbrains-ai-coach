/*
 * The 55 core RPC methods (`RpcMethodMap` in vendor/core/types/rpc-types.ts),
 * enumerated for the per-method stdio suite. Types are erased at runtime, so
 * this committed list IS the mechanical enumeration — kept in lockstep with
 * the type by the test that asserts every vendored handler is covered.
 *
 * `LLM_METHODS` are the three that degrade to `{ error: 'llm-unavailable' }` in
 * this suite. `compileNlRule` has no backend; `generateRule`/`explainOccurrence`
 * are now wired to a selectable CLI provider (see the cli-provider plan) but the
 * integration harness stamps no provider, so they take the real override's
 * no-provider path and degrade identically — proving a real handler ran.
 * `PORTED_METHODS` must all answer. `PARAMS` supplies the minimal params a few
 * methods need to exercise a real code path instead of an early guard.
 */

/** No backend at all — always degrade to `{ error: 'llm-unavailable' }`. */
export const LLM_DEGRADED_METHODS: readonly string[] = ['compileNlRule'];

/** Wired to a selectable CLI provider; with no provider stamped (this harness)
 *  they reach the real override and degrade by its no-provider/guard path. */
export const PROVIDER_WIRED_METHODS: readonly string[] = ['generateRule', 'explainOccurrence'];

/** The three LLM core methods, for the vendored-handler lockstep check. */
const LLM_METHODS: readonly string[] = [...PROVIDER_WIRED_METHODS, ...LLM_DEGRADED_METHODS];

export const PORTED_METHODS: readonly string[] = [
  'getWorkspaces',
  'getHarnesses',
  'getHarnessBreakdown',
  'getDailyActivity',
  'getWorkspaceBreakdown',
  'getHourlyDistribution',
  'getHeatmap',
  'getCodeProduction',
  'getConsumption',
  'getBurndown',
  'getAiCredits',
  'getAiCreditBurndown',
  'getTokenCoverage',
  'getDayTimeline',
  'getSessions',
  'getSessionDetail',
  'getWorkLifeBalance',
  'getAntiPatterns',
  'getHarnessComparison',
  'getParserCoverage',
  'getParserPreview',
  'getWorkflowOptimization',
  'getStats',
  'getConfigHealth',
  'getInsights',
  'getFlowState',
  'getContextManagement',
  'getWorkspaceContextSessions',
  'getContextRangeAvailability',
  'getCalendarActivity',
  'getProjectOverview',
  'getImageGallery',
  'getSessionImages',
  'getRuleEditor',
  'getRulePreview',
  'getRuleSource',
  'saveRule',
  'updateRuleThreshold',
  'reviewLocalRules',
  'testRuleLive',
  'getRuleCoverage',
  'getFieldSchema',
  'getMetricPrimitives',
  'getFunctionCatalog',
  'getMetricList',
  'evaluateExpression',
  'calibrateRule',
  'runRuleTests',
  'getDataExplorer',
  'getDataExplorerFields',
  'importRegistryRules',
  'getRegistryCatalog',
];

/** All 55 core methods. */
export const ALL_CORE_METHODS: readonly string[] = [...PORTED_METHODS, ...LLM_METHODS];

/**
 * Ported methods gated by `FF_TOKEN_REPORTING_ENABLED` (false by upstream
 * default). They "answer" with a typed gating error rather than analytics, so
 * the per-method suite asserts that specific error to prove the real handler
 * ran (not a stub) instead of accepting any non-unknown response.
 */
export const TOKEN_GATED_METHODS: readonly string[] = [
  'getConsumption',
  'getBurndown',
  'getAiCredits',
  'getAiCreditBurndown',
  'getTokenCoverage',
];

export const TOKEN_GATING_ERROR = 'Token reporting is temporarily disabled';

/* ---- Extension methods (ExtensionMethodMap, 20) — disposition per ADR 0009 ---- */

/** Ported to the sidecar (filesystem/network only) — must resolve to a handler. */
export const EXTENSION_PORT_METHODS: readonly string[] = [
  'getWorkspaceDeps',
  'getSdlcToolAnalysis',
  'getSdlcRepoScan',
  'discoverCatalog',
  'installSkill',
  'installCatalogItem',
];

/** LLM-dependent — must degrade to `{ error: 'llm-unavailable' }`. */
export const EXTENSION_LLM_DEGRADE_METHODS: readonly string[] = [
  'createSkill',
  'generateSkillContent',
  'generateLearningQuiz',
  'generateLearningResources',
  'generateCodeComparison',
  'generateDidYouKnow',
  'triageSkills',
  'triageCatalog',
  'reviewContextFiles',
];

/**
 * Owned by the Kotlin bridge (never forwarded). The sidecar deliberately does
 * NOT serve them, so it answers with the typed `Unknown method` error — that is
 * the safety net, not silence. (`getSdlcGitHubData` degrades to `github:false`;
 * the webview gates on it and never calls it, but the sidecar still answers with
 * a typed error if it ever arrives.)
 */
export const EXTENSION_HOST_OR_DEGRADE_METHODS: readonly string[] = [
  'openExternal',
  'saveModelBudgets',
  'loadModelBudgets',
  'exportSummary',
  'getSdlcGitHubData',
];

/** Every extension method, for the no-method-unmapped completeness assertion. */
export const ALL_EXTENSION_METHODS: readonly string[] = [
  ...EXTENSION_PORT_METHODS,
  ...EXTENSION_LLM_DEGRADE_METHODS,
  ...EXTENSION_HOST_OR_DEGRADE_METHODS,
];

/** Minimal params for methods that guard on a required field. */
export const PARAMS: Record<string, Record<string, unknown>> = {
  getBurndown: { config: { sku: 'pro' } },
  getAiCreditBurndown: { config: { sku: 'pro' } },
  getSessions: { page: 1, pageSize: 10 },
  getSessionDetail: { sessionId: 'nonexistent' },
  getWorkspaceContextSessions: { workspaceId: 'nonexistent' },
  getSessionImages: { sessionId: 'nonexistent', requestId: 'nonexistent' },
  getRuleSource: { ruleId: 'nonexistent' },
  updateRuleThreshold: { ruleId: 'nonexistent', key: 'threshold', value: 1 },
  testRuleLive: { markdown: '' },
  evaluateExpression: { expr: '1', scope: 'requests' },
  calibrateRule: { ruleId: 'nonexistent' },
  runRuleTests: { ruleId: 'nonexistent' },
  getDataExplorer: { field: 'harness' },
  getRuleCoverage: {},
  saveRule: { markdown: '' },
};

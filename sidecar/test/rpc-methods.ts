/*
 * The 55 core RPC methods (`RpcMethodMap` in vendor/core/types/rpc-types.ts),
 * enumerated for the per-method stdio suite. Types are erased at runtime, so
 * this committed list IS the mechanical enumeration — kept in lockstep with
 * the type by the test that asserts every vendored handler is covered.
 *
 * `LLM_METHODS` are the three that must degrade to `{ error: 'llm-unavailable' }`.
 * `PORTED_METHODS` must all answer. `PARAMS` supplies the minimal params a few
 * methods need to exercise a real code path instead of an early guard.
 */

export const LLM_METHODS: readonly string[] = [
  'generateRule',
  'compileNlRule',
  'explainOccurrence',
];

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

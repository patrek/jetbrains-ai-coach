import type { ErrorResult } from '../vendor/core/types';

type HandlerContextLike = { params?: Record<string, unknown> };

type ProviderRun =
  | { ok: true; text: string }
  | { ok: false; error: ErrorResult };

export type LearningRunWithProvider = (ctx: HandlerContextLike, prompt: string) => Promise<ProviderRun>;

type LearningHandler<Ctx extends HandlerContextLike> = (ctx: Ctx) => Promise<unknown>;

type QuizDifficulty = 'easy' | 'medium' | 'hard';

const QUIZ_DIFFICULTIES = new Set<QuizDifficulty>(['easy', 'medium', 'hard']);
const CODE_CATEGORIES = new Set(['performance', 'safety', 'readability', 'correctness', 'security']);
const FACT_CATEGORIES = new Set(['performance', 'api', 'pitfall', 'config', 'debug']);
const JSON_ONLY_NUDGE = 'Respond only with valid JSON, no markdown fences and no commentary.';

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function getStringArray(value: unknown, limit: number): string[] {
  return Array.isArray(value) ? value.filter(isString).slice(0, limit) : [];
}

function toText(value: unknown): string {
  return String(value ?? '');
}

function validDifficulty(value: unknown): value is QuizDifficulty {
  return isString(value) && QUIZ_DIFFICULTIES.has(value as QuizDifficulty);
}

function rootItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Array.isArray((value as { items?: unknown }).items)) {
    return (value as { items: unknown[] }).items;
  }
  return [];
}

function parseLlmJson(text: string): unknown {
  let cleaned = text.trim();
  cleaned = cleaned.replaceAll(/^```(?:json|jsonc|jsonl)?\s*/gm, '').replaceAll(/```\s*$/gm, '').trim();
  cleaned = cleaned.replaceAll(/^\s*\/\/[^\n]*$/gm, '').trim();

  const lines = cleaned.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length > 1 && lines.every((line) => line.startsWith('{') && line.endsWith('}'))) {
    try { return JSON.parse(`[${lines.join(',')}]`); } catch { /* fall through */ }
  }

  const arrStart = cleaned.indexOf('[');
  const objStart = cleaned.indexOf('{');
  if (arrStart === -1 && objStart === -1) throw new Error('No JSON structure found in LLM response');

  const start = arrStart === -1 ? objStart : objStart === -1 ? arrStart : Math.min(arrStart, objStart);
  const openChar = cleaned[start];
  const closeChar = openChar === '[' ? ']' : '}';
  const end = cleaned.lastIndexOf(closeChar);
  cleaned = end > start ? cleaned.slice(start, end + 1) : cleaned.slice(start);

  try { return JSON.parse(cleaned); } catch { /* fall through */ }

  let fixed = cleaned;
  fixed = fixed.replaceAll(/,\s*([}\]])/g, '$1');
  fixed = fixed.replaceAll(/[\u201C\u201D\u2033]/g, '"').replaceAll(/[\u2018\u2019\u2032]/g, "'");
  fixed = fixed.replaceAll(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"');
  // eslint-disable-next-line no-control-regex
  fixed = fixed.replaceAll(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

  try { return JSON.parse(fixed); } catch { /* fall through */ }

  const balanced = balanceTruncatedJson(fixed).replaceAll(/,(\s*[}\]])/g, '$1');
  try { return JSON.parse(balanced); } catch { /* fall through */ }

  throw new Error('Failed to parse JSON from LLM response');
}

function balanceTruncatedJson(input: string): string {
  const closers: string[] = [];
  let inString = false;
  let escaped = false;

  for (const char of input) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') closers.push('}');
    else if (char === '[') closers.push(']');
    else if (char === '}' || char === ']') closers.pop();
  }

  let result = input;
  if (inString) result += '"';
  for (let i = closers.length - 1; i >= 0; i--) result += closers[i];
  return result;
}

async function runJson<Ctx extends HandlerContextLike>(
  runWithProvider: (ctx: Ctx, prompt: string) => Promise<ProviderRun>,
  ctx: Ctx,
  prompt: string,
): Promise<unknown | ErrorResult> {
  const first = await runWithProvider(ctx, prompt);
  if (!first.ok) return first.error;
  try {
    return parseLlmJson(first.text);
  } catch {
    const retry = await runWithProvider(ctx, `${prompt}\n\n${JSON_ONLY_NUDGE}`);
    if (!retry.ok) return retry.error;
    try {
      return parseLlmJson(retry.text);
    } catch {
      return { error: 'llm-unavailable', reason: 'bad-output' };
    }
  }
}

function isErrorResult(value: unknown): value is ErrorResult {
  return !!value && typeof value === 'object' && typeof (value as { error?: unknown }).error === 'string';
}

function quizContext(params: Record<string, unknown>) {
  return {
    languages: getStringArray(params.languages, 10),
    topics: getStringArray(params.topics, 10),
    difficulty: validDifficulty(params.difficulty) ? params.difficulty : 'easy',
    solved: isNumber(params.solved) ? params.solved : 0,
    failed: isNumber(params.failed) ? params.failed : 0,
    solvedSamples: getStringArray(params.solvedSamples, 5),
    failedSamples: getStringArray(params.failedSamples, 5),
    focusSkills: getStringArray(params.focusSkills, 10),
    packageDeps: getStringArray(params.packageDeps, 30),
    customGoals: getStringArray(params.customGoals, 5),
    leitnerBox: isNumber(params.leitnerBox) ? params.leitnerBox : 0,
    reviewTopics: getStringArray(params.reviewTopics, 10),
  };
}

function buildQuizPrompt(context: ReturnType<typeof quizContext>): string {
  const reviewContext = context.leitnerBox > 0
    ? `\nSPACED REPETITION (Leitner Box ${context.leitnerBox}/7):\nCurrent box topics to review: ${context.reviewTopics.join(', ') || 'general'}`
    : '';
  const depsContext = context.packageDeps.length > 0
    ? `\nECOSYSTEM CONTEXT (dependencies from their project):\n${context.packageDeps.join(', ')}`
    : '';
  const goalsContext = context.customGoals.length > 0
    ? `\nUSER'S CUSTOM LEARNING GOALS:\n${context.customGoals.map((goal) => `- ${goal}`).join('\n')}`
    : '';
  const focusContext = context.focusSkills.length > 0
    ? `\nSKILL POINTS INVESTED:\n${context.focusSkills.map((skill) => `- ${skill}`).join('\n')}`
    : '';

  return `You are a senior developer creating realistic coding challenges that test practical knowledge within a specific tech ecosystem.

Generate exactly 3 multiple-choice questions. Each question must have exactly 4 choices with exactly one correct answer.

CRITICAL RULES:
- Questions must present realistic coding scenarios and short code snippets whenever possible.
- Do not ask installing/configuration trivia. Ask about writing code, behavior, bugs, output, or correct implementations.
- Difficulty level: ${context.difficulty}
- Explanations should teach a practical insight in 1-2 sentences.
- The topic field should match one focus skill when possible.
${reviewContext}${depsContext}${goalsContext}${focusContext}

Developer profile:
- Languages: ${context.languages.join(', ') || 'general programming'}
- Topics of interest: ${context.topics.join(', ') || 'general software engineering'}
- Stats: ${context.solved} solved, ${context.failed} failed
- Current difficulty: ${context.difficulty}
${context.solvedSamples.length > 0 ? `Questions they already know:\n${context.solvedSamples.map((sample) => `- ${sample}`).join('\n')}` : ''}
${context.failedSamples.length > 0 ? `Questions they struggled with:\n${context.failedSamples.map((sample) => `- ${sample}`).join('\n')}` : ''}

Respond with a JSON object: {"items":[{"question":"...","choices":["A","B","C","D"],"correctIndex":0,"explanation":"...","difficulty":"easy|medium|hard","topic":"..."}]}`;
}

function normalizeQuiz(response: unknown, fallbackDifficulty: QuizDifficulty) {
  return rootItems(response)
    .filter((question) => {
      const item = question as Record<string, unknown>;
      return typeof item.question === 'string' &&
        Array.isArray(item.choices) && item.choices.length === 4 &&
        typeof item.correctIndex === 'number' && item.correctIndex >= 0 && item.correctIndex < 4 &&
        typeof item.explanation === 'string';
    })
    .slice(0, 3)
    .map((question) => {
      const item = question as Record<string, unknown>;
      return {
        question: item.question as string,
        choices: (item.choices as unknown[]).map(toText),
        correctIndex: item.correctIndex as number,
        explanation: item.explanation as string,
        difficulty: validDifficulty(item.difficulty) ? item.difficulty : fallbackDifficulty,
        topic: toText(item.topic) || 'general',
      };
    });
}

function codeDifficulty(value: unknown): QuizDifficulty {
  return validDifficulty(value) ? value : 'medium';
}

function buildCodeComparisonPrompt(params: Record<string, unknown>, difficulty: QuizDifficulty, languages: string[], packageDeps: string[]) {
  const seenTopics = getStringArray(params.seenTopics, 10);
  const depsContext = packageDeps.length > 0
    ? `\nDEPENDENCIES (use these to write realistic code):\n${packageDeps.join(', ')}`
    : '';

  return `You are a senior code reviewer generating side-by-side code comparisons for a Code Review training game.

Generate exactly 3 code comparison rounds. In each round, present two short snippets (4-12 lines each) that accomplish the same task. One snippet is subtly better.

CRITICAL RULES:
- Both snippets must be plausible working code.
- The difference must be subtle and professional.
- Use real patterns, libraries, and idioms from: ${languages.join(', ') || 'general programming'}${depsContext}
- Vary categories: performance, safety, readability, correctness, security.
- Difficulty: ${difficulty}
${seenTopics.length > 0 ? `Avoid these topics: ${seenTopics.join(', ')}` : ''}

Respond with a JSON object: {"items":[{"snippetA":"code string","snippetB":"code string","betterSnippet":"A or B","title":"short task description","category":"performance|safety|readability|correctness|security","explanation":"2-3 sentences explaining WHY","difficulty":"easy|medium|hard","language":"the language used"}]}`;
}

function normalizeCodeComparison(response: unknown, fallbackDifficulty: QuizDifficulty, fallbackLanguage: string) {
  return rootItems(response)
    .filter((round) => {
      const item = round as Record<string, unknown>;
      return typeof item.snippetA === 'string' && item.snippetA.length > 0 &&
        typeof item.snippetB === 'string' && item.snippetB.length > 0 &&
        (item.betterSnippet === 'A' || item.betterSnippet === 'B') &&
        typeof item.title === 'string' &&
        typeof item.explanation === 'string';
    })
    .slice(0, 3)
    .map((round) => {
      const item = round as Record<string, unknown>;
      return {
        snippetA: item.snippetA as string,
        snippetB: item.snippetB as string,
        betterSnippet: item.betterSnippet as 'A' | 'B',
        title: item.title as string,
        category: isString(item.category) && CODE_CATEGORIES.has(item.category) ? item.category : 'readability',
        explanation: item.explanation as string,
        difficulty: validDifficulty(item.difficulty) ? item.difficulty : fallbackDifficulty,
        language: String(item.language || fallbackLanguage || 'code'),
      };
    });
}

function buildDidYouKnowPrompt(params: Record<string, unknown>) {
  const languages = getStringArray(params.languages, 10);
  const packageDeps = getStringArray(params.packageDeps, 30);
  const workspaces = getStringArray(params.workspaces, 10);
  const seenFacts = getStringArray(params.seenFacts, 20);

  return `You are a senior developer sharing practical "Did you know?" facts tailored to a developer's actual tech stack and projects.

Generate exactly 5 short, useful nuggets. They should be surprising, specific, and actionable.

RULES:
- Each fact must reference a dependency, language feature, or project from the developer's stack.
- Include the project or dependency name that the fact relates to.
- Mix categories: performance, api, pitfall, config, debug.
- Do not be generic.
${seenFacts.length > 0 ? `\nAvoid these already shown facts: ${seenFacts.join(' | ')}` : ''}

Languages: ${languages.join(', ') || 'general'}
Dependencies: ${packageDeps.join(', ') || 'none detected'}
Active projects: ${workspaces.join(', ') || 'none detected'}

Respond with a JSON object: {"items":[{"fact":"...", "project":"...", "category":"performance|api|pitfall|config|debug"}]}`;
}

function normalizeDidYouKnow(response: unknown) {
  return rootItems(response)
    .filter((fact) => {
      const item = fact as Record<string, unknown>;
      return typeof item.fact === 'string' && item.fact.trim().length > 0 && typeof item.project === 'string';
    })
    .slice(0, 5)
    .map((fact) => {
      const item = fact as Record<string, unknown>;
      return {
        fact: item.fact as string,
        project: item.project as string,
        category: isString(item.category) && FACT_CATEGORIES.has(item.category) ? item.category : 'api',
      };
    });
}

function buildResourcesPrompt(params: Record<string, unknown>) {
  const languages = getStringArray(params.languages, 10);
  const gaps = getStringArray(params.gaps, 10);
  const focusConcepts = getStringArray(params.focusConcepts, 10);
  const packageDeps = getStringArray(params.packageDeps, 20);
  const workspaces = getStringArray(params.workspaces, 10);

  return `You are a senior engineering mentor recommending learning resources for a developer.

Generate exactly 6 learning resource recommendations. Each must be a real, verified resource that exists on the internet.

RULES:
- Resources must be personalized to the developer's tech stack and dependencies.
- Prioritize official documentation, well-maintained repos, and reputable tutorial sites.
- Do not invent fake URLs or resources.
- Mix resource types: docs, interactive tutorials, repos, video courses, practice platforms.
- Include a 1-sentence reason explaining relevance.

Developer profile:
- Languages: ${languages.join(', ') || 'general programming'}
- Key dependencies: ${packageDeps.join(', ') || 'none detected'}
- Knowledge gaps: ${gaps.join(', ') || 'none detected'}
- Focus concepts: ${focusConcepts.join(', ') || 'none selected'}
- Active projects: ${workspaces.join(', ') || 'none detected'}

Respond with a JSON object: {"items":[{"title":"...","url":"https://...","type":"Language|Framework|Concept|Practice","reason":"..."}]}`;
}

function normalizeResources(response: unknown) {
  return rootItems(response)
    .filter((resource) => {
      const item = resource as Record<string, unknown>;
      return typeof item.title === 'string' && typeof item.url === 'string' && item.url.startsWith('https://');
    })
    .slice(0, 6)
    .map((resource) => {
      const item = resource as Record<string, unknown>;
      return {
        title: item.title as string,
        url: item.url as string,
        type: String(item.type || 'Resource'),
        reason: String(item.reason || ''),
      };
    });
}

export function createLearningHandlers<Ctx extends HandlerContextLike>(
  runWithProvider: (ctx: Ctx, prompt: string) => Promise<ProviderRun>,
): Record<string, LearningHandler<Ctx>> {
  return {
    generateLearningQuiz: async (ctx) => {
      const params = ctx.params ?? {};
      const context = quizContext(params);
      const response = await runJson(runWithProvider, ctx, buildQuizPrompt(context));
      return isErrorResult(response) ? response : { questions: normalizeQuiz(response, context.difficulty) };
    },
    generateCodeComparison: async (ctx) => {
      const params = ctx.params ?? {};
      const languages = getStringArray(params.languages, 10);
      const packageDeps = getStringArray(params.packageDeps, 30);
      const difficulty = codeDifficulty(params.difficulty);
      const response = await runJson(runWithProvider, ctx, buildCodeComparisonPrompt(params, difficulty, languages, packageDeps));
      return isErrorResult(response) ? response : {
        rounds: normalizeCodeComparison(response, difficulty, languages[0] || 'code'),
      };
    },
    generateDidYouKnow: async (ctx) => {
      const params = ctx.params ?? {};
      const response = await runJson(runWithProvider, ctx, buildDidYouKnowPrompt(params));
      return isErrorResult(response) ? response : { facts: normalizeDidYouKnow(response) };
    },
    generateLearningResources: async (ctx) => {
      const params = ctx.params ?? {};
      const response = await runJson(runWithProvider, ctx, buildResourcesPrompt(params));
      return isErrorResult(response) ? response : { resources: normalizeResources(response) };
    },
  };
}

import { describe, expect, it, vi } from 'vitest';
import { createLearningHandlers, type LearningRunWithProvider } from './learning-provider';

function handlersFor(responses: Array<{ ok: true; text: string } | { ok: false; error: { error: string; reason?: string } }>) {
  const runWithProvider = vi.fn<LearningRunWithProvider>();
  for (const response of responses) runWithProvider.mockResolvedValueOnce(response);
  return { handlers: createLearningHandlers(runWithProvider), runWithProvider };
}

const validQuizItem = {
  question: 'What prints?',
  choices: ['A', 'B', 'C', 'D'],
  correctIndex: 1,
  explanation: 'Because B.',
  difficulty: 'hard',
  topic: 'Async',
};

const validRound = {
  snippetA: 'const ids = rows.map(r => r.id);',
  snippetB: 'const ids = [];\nfor (const row of rows) ids.push(row.id);',
  betterSnippet: 'B',
  title: 'Collect ids',
  category: 'performance',
  explanation: 'The loop avoids callback allocation in a hot path.',
  difficulty: 'hard',
  language: 'TypeScript',
};

const validFact = {
  fact: 'Node can load built-in test runner with node --test.',
  project: 'node',
  category: 'debug',
};

const validResource = {
  title: 'TypeScript Handbook',
  url: 'https://www.typescriptlang.org/docs/',
  type: 'Language',
  reason: 'Covers the project language.',
};

describe('createLearningHandlers JSON parsing', () => {
  it('accepts root arrays and object wrapped items', async () => {
    const { handlers } = handlersFor([
      { ok: true, text: JSON.stringify([validQuizItem]) },
      { ok: true, text: JSON.stringify({ items: [validResource] }) },
    ]);

    await expect(handlers.generateLearningQuiz({ params: { difficulty: 'hard' } })).resolves.toEqual({
      questions: [validQuizItem],
    });
    await expect(handlers.generateLearningResources({ params: {} })).resolves.toEqual({
      resources: [validResource],
    });
  });

  it('strips fences and prose, repairs truncated JSON, trailing commas, curly quotes, single quotes, and JSONL', async () => {
    const { handlers } = handlersFor([
      {
        ok: true,
        text: `Here is JSON:\n\`\`\`json\n{"items":[{'question':'What?', 'choices':['A','B','C','D'], "correctIndex":0, "explanation":"Ok", "difficulty":"weird", "topic":"",},`,
      },
      {
        ok: true,
        text: `{"snippetA":"a","snippetB":"b","betterSnippet":"A","title":"T","category":"nonsense","explanation":"E","difficulty":"wat","language":""}
{"snippetA":"c","snippetB":"d","betterSnippet":"B","title":"T2","category":"security","explanation":"E2","difficulty":"easy","language":"JS"}`,
      },
      {
        ok: true,
        text: `Some prose {“items”:[{“fact”:“Use caches.”,“project”:“api”,“category”:“mystery”,},]} thanks`,
      },
    ]);

    await expect(handlers.generateLearningQuiz({ params: { difficulty: 'medium' } })).resolves.toEqual({
      questions: [{
        question: 'What?',
        choices: ['A', 'B', 'C', 'D'],
        correctIndex: 0,
        explanation: 'Ok',
        difficulty: 'medium',
        topic: 'general',
      }],
    });
    await expect(handlers.generateCodeComparison({ params: { languages: ['TypeScript'], difficulty: 'medium' } })).resolves.toEqual({
      rounds: [
        {
          snippetA: 'a',
          snippetB: 'b',
          betterSnippet: 'A',
          title: 'T',
          category: 'readability',
          explanation: 'E',
          difficulty: 'medium',
          language: 'TypeScript',
        },
        {
          snippetA: 'c',
          snippetB: 'd',
          betterSnippet: 'B',
          title: 'T2',
          category: 'security',
          explanation: 'E2',
          difficulty: 'easy',
          language: 'JS',
        },
      ],
    });
    await expect(handlers.generateDidYouKnow({ params: {} })).resolves.toEqual({
      facts: [{ fact: 'Use caches.', project: 'api', category: 'api' }],
    });
  });

  it('retries malformed output exactly once with a JSON-only nudge', async () => {
    const { handlers, runWithProvider } = handlersFor([
      { ok: true, text: 'not json' },
      { ok: true, text: JSON.stringify({ items: [validFact] }) },
    ]);

    await expect(handlers.generateDidYouKnow({ params: { languages: ['Kotlin'] } })).resolves.toEqual({
      facts: [validFact],
    });
    expect(runWithProvider).toHaveBeenCalledTimes(2);
    expect(runWithProvider.mock.calls[1][1]).toContain('Respond only with valid JSON');
    expect(runWithProvider.mock.calls[1][1]).toContain('no markdown fences');
    expect(runWithProvider.mock.calls[1][1]).toContain('no commentary');
  });

  it('returns bad-output when retry output is still malformed', async () => {
    const { handlers, runWithProvider } = handlersFor([
      { ok: true, text: 'not json' },
      { ok: true, text: 'still not json' },
    ]);

    await expect(handlers.generateLearningResources({ params: {} })).resolves.toEqual({
      error: 'llm-unavailable',
      reason: 'bad-output',
    });
    expect(runWithProvider).toHaveBeenCalledTimes(2);
  });

  it('returns the real provider error unchanged when retry fails', async () => {
    const providerError = { error: 'llm-unavailable', reason: 'timeout' };
    const { handlers } = handlersFor([
      { ok: true, text: 'not json' },
      { ok: false, error: providerError },
    ]);

    await expect(handlers.generateLearningQuiz({ params: {} })).resolves.toBe(providerError);
  });
});

describe('createLearningHandlers validators', () => {
  it('validates quiz questions and preserves an empty success wrapper', async () => {
    const { handlers } = handlersFor([{
      ok: true,
      text: JSON.stringify({
        items: [
          validQuizItem,
          { ...validQuizItem, question: 12 },
          { ...validQuizItem, choices: ['A', 'B', 'C'] },
          { ...validQuizItem, correctIndex: 4 },
          { ...validQuizItem, explanation: null },
          { ...validQuizItem, question: 'Q2', difficulty: 'bogus', topic: '' },
          { ...validQuizItem, question: 'Q3' },
          { ...validQuizItem, question: 'Q4' },
        ],
      }),
    }]);

    await expect(handlers.generateLearningQuiz({ params: { difficulty: 'not-real', topics: [] } })).resolves.toEqual({
      questions: [
        validQuizItem,
        { ...validQuizItem, question: 'Q2', difficulty: 'easy', topic: 'general' },
        { ...validQuizItem, question: 'Q3' },
      ],
    });

    const empty = handlersFor([{ ok: true, text: JSON.stringify({ items: [{ ...validQuizItem, choices: [] }] }) }]);
    await expect(empty.handlers.generateLearningQuiz({ params: {} })).resolves.toEqual({ questions: [] });
  });

  it('validates code comparison rounds and applies fallback fields', async () => {
    const { handlers } = handlersFor([{
      ok: true,
      text: JSON.stringify({
        items: [
          validRound,
          { ...validRound, snippetA: '' },
          { ...validRound, betterSnippet: 'C' },
          { ...validRound, title: 1 },
          { ...validRound, explanation: false },
          { ...validRound, title: 'Fallbacks', category: 'odd', difficulty: 'odd', language: '' },
          { ...validRound, title: 'Third' },
          { ...validRound, title: 'Fourth' },
        ],
      }),
    }]);

    await expect(handlers.generateCodeComparison({ params: { languages: ['Kotlin'], difficulty: 'nope' } })).resolves.toEqual({
      rounds: [
        validRound,
        { ...validRound, title: 'Fallbacks', category: 'readability', difficulty: 'medium', language: 'Kotlin' },
        { ...validRound, title: 'Third' },
      ],
    });

    const empty = handlersFor([{ ok: true, text: JSON.stringify({ items: [{ ...validRound, snippetB: '' }] }) }]);
    await expect(empty.handlers.generateCodeComparison({ params: {} })).resolves.toEqual({ rounds: [] });
  });

  it('validates did-you-know facts', async () => {
    const { handlers } = handlersFor([{
      ok: true,
      text: JSON.stringify({
        items: [
          validFact,
          { ...validFact, fact: '' },
          { ...validFact, project: 1 },
          { ...validFact, fact: 'Fallback category', category: 'unknown' },
          { ...validFact, fact: 'Three' },
          { ...validFact, fact: 'Four' },
          { ...validFact, fact: 'Five' },
          { ...validFact, fact: 'Six' },
        ],
      }),
    }]);

    await expect(handlers.generateDidYouKnow({ params: {} })).resolves.toEqual({
      facts: [
        validFact,
        { ...validFact, fact: 'Fallback category', category: 'api' },
        { ...validFact, fact: 'Three' },
        { ...validFact, fact: 'Four' },
        { ...validFact, fact: 'Five' },
      ],
    });

    const empty = handlersFor([{ ok: true, text: JSON.stringify({ items: [{ ...validFact, fact: '   ' }] }) }]);
    await expect(empty.handlers.generateDidYouKnow({ params: {} })).resolves.toEqual({ facts: [] });
  });

  it('validates learning resources', async () => {
    const { handlers } = handlersFor([{
      ok: true,
      text: JSON.stringify({
        items: [
          validResource,
          { ...validResource, title: 12 },
          { ...validResource, url: 'http://example.com' },
          { ...validResource, title: 'Fallbacks', type: '', reason: '' },
          { ...validResource, title: 'Three' },
          { ...validResource, title: 'Four' },
          { ...validResource, title: 'Five' },
          { ...validResource, title: 'Six' },
          { ...validResource, title: 'Seven' },
        ],
      }),
    }]);

    await expect(handlers.generateLearningResources({ params: {} })).resolves.toEqual({
      resources: [
        validResource,
        { ...validResource, title: 'Fallbacks', type: 'Resource', reason: '' },
        { ...validResource, title: 'Three' },
        { ...validResource, title: 'Four' },
        { ...validResource, title: 'Five' },
        { ...validResource, title: 'Six' },
      ],
    });

    const empty = handlersFor([{ ok: true, text: JSON.stringify({ items: [{ ...validResource, url: 'ftp://example.com' }] }) }]);
    await expect(empty.handlers.generateLearningResources({ params: {} })).resolves.toEqual({ resources: [] });
  });

  it('returns provider failures unchanged on the first attempt', async () => {
    const providerError = { error: 'llm-unavailable', reason: 'cli-error' };
    const { handlers } = handlersFor([{ ok: false, error: providerError }]);

    await expect(handlers.generateCodeComparison({ params: {} })).resolves.toBe(providerError);
  });
});

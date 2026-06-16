import { describe, expect, it } from 'vitest';
import { Analyzer } from '../vendor/core/analyzer';
import { resolveHandler, type HandlerContext } from './rpc-handlers';
import type { ParseResult } from '../vendor/core/parser';

function ctx(params: Record<string, unknown> = {}): HandlerContext {
  const parseResult: ParseResult = { workspaces: new Map(), sessions: [], editLocIndex: new Map(), sessionSourceIndex: new Map() };
  return { analyzer: new Analyzer([]), parseResult, params };
}

describe('exportSummaryContent', () => {
  it('renders a date-stamped markdown + json pair', () => {
    const handler = resolveHandler('exportSummaryContent')!;
    const { files } = handler(ctx()) as { files: Array<{ filename: string; content: string }> };

    expect(files).toHaveLength(2);
    const md = files.find((f) => f.filename.endsWith('.md'))!;
    const jsonFile = files.find((f) => f.filename.endsWith('.json'))!;

    expect(md.filename).toMatch(/^ai-engineer-coach-summary-\d{4}-\d{2}-\d{2}\.md$/);
    expect(jsonFile.filename).toMatch(/^ai-engineer-coach-summary-\d{4}-\d{2}-\d{2}\.json$/);
    expect(md.content).toContain('# AI Engineer Coach Summary');
    expect(() => JSON.parse(jsonFile.content)).not.toThrow();
  });

  it('is registered as a host-driven override', () => {
    expect(resolveHandler('exportSummaryContent')).toBeTypeOf('function');
  });
});

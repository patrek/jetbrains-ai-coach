import { describe, expect, it } from 'vitest';
import { Analyzer } from '../vendor/core/analyzer';
import { CREDITS_DISABLED_MESSAGE, MCP_TOOL_DEFS, partialDataNote, runTool } from './mcp-tools';

/** An empty analyzer is enough: the formatters return zeroed shapes for it. */
const analyzer = new Analyzer([]);

describe('MCP tool table', () => {
  it('exposes exactly the 12 pinned aiEngineerCoach_* tools', () => {
    expect(MCP_TOOL_DEFS).toHaveLength(12);
    for (const def of MCP_TOOL_DEFS) {
      expect(def.name).toMatch(/^aiEngineerCoach_/);
      expect(def.description.length).toBeGreaterThan(0);
      expect(def.inputSchema).toMatchObject({ type: 'object' });
    }
  });

  it('has unique tool names', () => {
    const names = MCP_TOOL_DEFS.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('the sessions tool advertises its paging schema', () => {
    const sessions = MCP_TOOL_DEFS.find((d) => d.name === 'aiEngineerCoach_sessions');
    const props = (sessions?.inputSchema as { properties: Record<string, unknown> }).properties;
    expect(props).toHaveProperty('sessionId');
    expect(props).toHaveProperty('page');
    expect(props).toHaveProperty('pageSize');
    expect(props).toHaveProperty('search');
  });
});

describe('runTool', () => {
  it('returns parseable JSON for an analytics tool', () => {
    const { text, isError } = runTool(analyzer, 'aiEngineerCoach_summary', {});
    expect(isError).toBe(false);
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it('returns every tool answerable without throwing', () => {
    for (const def of MCP_TOOL_DEFS) {
      const { isError } = runTool(analyzer, def.name, {});
      expect(isError).toBe(false);
    }
  });

  it('returns a typed error for an unknown tool, never a throw', () => {
    const { text, isError } = runTool(analyzer, 'aiEngineerCoach_nope', {});
    expect(isError).toBe(true);
    expect(text).toContain('Unknown tool');
  });

  it('relays the credits-disabled message verbatim (token reporting flag off)', () => {
    const { text, isError } = runTool(analyzer, 'aiEngineerCoach_credits', {});
    expect(isError).toBe(false);
    expect(text).toBe(CREDITS_DISABLED_MESSAGE);
  });
});

describe('partialDataNote', () => {
  it('names the cached session count so partial data is never mistaken for complete', () => {
    expect(partialDataNote(7)).toContain('7 cached session');
    expect(partialDataNote(0)).toContain('0 cached session');
  });
});

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { Analyzer } from '../vendor/core/analyzer';
import { createMcpServer, type McpToolSource } from '../src/mcp-server';

/**
 * Drives `createMcpServer` over the SDK's in-memory transport pair — proving the
 * list/call wiring and the partial-data note without spawning a process or the
 * worker-backed parse. The headless bundle (`dist/mcp-main.js`) is exercised
 * end-to-end manually; this keeps the wiring under deterministic CI coverage.
 */
class FakeSource implements McpToolSource {
  constructor(public isParsing: boolean, public currentSessionCount: number) {}
  private readonly analyzer = new Analyzer([]);
  getAnalyzer(): Analyzer {
    return this.analyzer;
  }
}

async function connectClient(source: McpToolSource): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(source);
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe('MCP server (in-memory)', () => {
  let readyClient: Client;

  beforeAll(async () => {
    readyClient = await connectClient(new FakeSource(false, 0));
  });

  it('lists the 12 pinned tools', async () => {
    const { tools } = await readyClient.listTools();
    expect(tools).toHaveLength(12);
    expect(tools.every((t) => t.name.startsWith('aiEngineerCoach_'))).toBe(true);
  });

  it('answers a tool call with a text content block', async () => {
    const result = await readyClient.callTool({ name: 'aiEngineerCoach_summary', arguments: {} });
    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].type).toBe('text');
    expect(() => JSON.parse(content[0].text)).not.toThrow();
  });

  it('flags an unknown tool as an error rather than hanging', async () => {
    const result = await readyClient.callTool({ name: 'aiEngineerCoach_missing', arguments: {} });
    expect(result.isError).toBe(true);
  });

  it('prefixes a partial-data note while the background parse is running', async () => {
    const client = await connectClient(new FakeSource(true, 42));
    const result = await client.callTool({ name: 'aiEngineerCoach_summary', arguments: {} });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('42 cached session');
  });
});

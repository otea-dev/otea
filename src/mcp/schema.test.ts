import type { Tool } from '@modelcontextprotocol/client';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { COMMANDS } from '../cli/commands.ts';
import { cliAt, declareProfiles, type TempRepo, tempGitRepo } from '../cli/testing.ts';
import { AGENT_COMMANDS, createMcpServer, toolName } from './server.ts';

type Schema = {
  required?: string[];
  properties?: Record<
    string,
    { type?: string | string[]; anyOf?: { type?: string }[]; description?: string }
  >;
};

// What an agent reads in tools/list (P8-F5): which parameters it must pass, of what type, and what
// each tool's description says in the words of the tools it has.
describe('mcp tool schemas', () => {
  let repo: TempRepo;
  let bare: Client;
  let named: Client;

  const connect = async (agent?: string) => {
    const server = createMcpServer(COMMANDS, {
      cwd: repo.dir,
      ...(agent === undefined ? {} : { agent }),
      warn: () => {},
    });
    const client = new Client({ name: 'test', version: '0' });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    await client.connect(clientSide);
    return client;
  };

  const toolsOf = async (client: Client) => {
    const { tools } = await client.listTools();
    return new Map(tools.map((tool: Tool) => [tool.name, tool]));
  };

  beforeEach(async () => {
    repo = tempGitRepo();
    await cliAt(repo.dir)('init', '--local', '--template', 'none');
    declareProfiles(repo.dir, 'claude');
    bare = await connect();
    named = await connect('claude');
  });

  afterEach(async () => {
    await bare.close();
    await named.close();
    repo.remove();
  });

  it('requires as in every tool that needs a name, on a server started without one', async () => {
    const tools = await toolsOf(bare);
    const nameless = new Set(['whoami', 'topic_list', 'topic_show']);

    for (const name of AGENT_COMMANDS.map(toolName)) {
      const schema = tools.get(name)?.inputSchema as Schema;
      expect(schema.required?.includes('as') ?? false, name).toBe(!nameless.has(name));
    }
  });

  it('leaves as optional where the server already has the name it was started as', async () => {
    const tools = await toolsOf(named);

    for (const tool of tools.values()) {
      expect((tool.inputSchema as Schema).required ?? [], tool.name).not.toContain('as');
    }
  });

  it('refuses a call without as before it reaches the command', async () => {
    const reply = (await bare.callTool({ name: 'claim', arguments: { id: 'TASKS-1' } })) as {
      isError?: boolean;
      content: { text: string }[];
    };

    expect(reply.isError).toBe(true);
    expect(reply.content[0]?.text).toMatch(/\bas\b/);
  });

  it('types and describes the wait timeout, and takes a number of seconds', async () => {
    const schema = (await toolsOf(bare)).get('wait')?.inputSchema as Schema;
    const timeout = schema.properties?.timeout;

    expect(timeout?.type).toEqual(expect.arrayContaining(['string', 'number']));
    expect(timeout?.description).toContain('seconds');
    const waited = (await bare.callTool({
      name: 'wait',
      arguments: { as: 'claude', turn: 'human', timeout: 1 },
    })) as { isError?: boolean; content: { text: string }[] };
    expect(waited.isError).toBeFalsy();
    expect(waited.content[0]?.text).toContain('within 1s');
  }, 15_000);

  it('gives item ids an example, and relation kinds the kinds there are', async () => {
    const tools = await toolsOf(bare);
    const props = (name: string) =>
      (tools.get(name)?.inputSchema as Schema | undefined)?.properties;
    const id = props('claim')?.id;
    const kind = props('link')?.kind;

    expect(id?.description).toContain('TASKS-1');
    expect(kind?.description).toContain('blocks');
    expect(kind?.description).toContain('duplicates');
  });

  // Harnesses that map tools to functions refuse a hyphen in a parameter.
  it('names no parameter with a hyphen', async () => {
    for (const tool of (await toolsOf(bare)).values()) {
      for (const key of Object.keys((tool.inputSchema as Schema).properties ?? {})) {
        expect(key, `${tool.name}.${key}`).toMatch(/^[A-Za-z0-9_]+$/);
      }
    }
    const list = await bare.callTool({
      name: 'topic_list',
      arguments: { all_projects: true, search: 'x' },
    });
    expect((list as { isError?: boolean }).isError).toBeFalsy();
  });

  it('speaks of parameters in the descriptions, never of command-line flags', async () => {
    for (const tool of (await toolsOf(bare)).values()) {
      expect(tool.description, tool.name).not.toMatch(/(^|[\s(])--[a-z]/);
    }
  });

  it('says what attach takes once, not twice', async () => {
    const description = (await toolsOf(bare)).get('attach')?.description ?? '';

    expect(description.match(/a relative one is resolved against/g)).toHaveLength(1);
    expect(description.match(/picks one when several do/g)?.length ?? 0).toBeLessThanOrEqual(1);
  });

  it('serves the guide as the instructions, in the words of the tools', async () => {
    const instructions = bare.getInstructions() ?? '';

    expect(instructions).toContain('claim { id: "<id>" }');
    expect(instructions).not.toMatch(/otea (next|claim|profile|ask|answer)/);
    expect(instructions).not.toContain('(MCP:');
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AGENTS_BLOCK } from '../app/agents.ts';
import { AGENT_GUIDE } from '../core/agent-guide.ts';
import { SILENT_AFTER_MS } from '../core/agent-status.ts';
import { createMcpServer } from '../mcp/server.ts';
import { mcpWords } from '../mcp/words.ts';
import { COMMANDS } from './commands.ts';
import { type Cli, cliAt, presetCollection, tempGitRepo } from './testing.ts';

// Otea's agent guide is one text, read in three places: the MCP server's instructions, the
// AGENTS.md block and the start of otea board.
describe("Otea's agent guide", () => {
  let repo: ReturnType<typeof tempGitRepo>;
  let otea: Cli;

  beforeEach(async () => {
    repo = tempGitRepo();
    otea = cliAt(repo.dir, { OTEA_AGENT: 'claude' });
    await otea('init', '--local', '--template', 'none');
    presetCollection(repo.dir, 'tasks');
  });

  afterEach(() => repo.remove());

  it('tells agents to follow the board to the letter, each under its own name', () => {
    for (const line of [
      'otea next --claim',
      'claim it again at each new step',
      '"Before you hand it off"',
      'never invent a procedure of your own',
      '"Sent back to you"',
      'the exact command next prints',
      'Never relay a decision on a step you did',
      'nor review it',
      'Never push to a branch',
      'every subagent',
      "never reuse your parent's",
      '--as <name>',
      'otea ask <id> "<short question>" --option "<answer>" (2 to 4) --recommend <n>',
      'always offer options and mark the one you choose',
      // P3C-R3-8: what the session says, never a config file read outside the project.
      'Declare what this session tells you (your instructions, or what the person says)',
      'never open config files outside the project for it. Otherwise declare unknown.',
      'declare unknown. Never guess.',
      'To propose a new board, run otea board draft --new "<name>" --why "<what it is for>"',
      // P4-6: how otea board says to change a published board.
      'to change a published board (a field, a step), --change <board> instead of --new',
      'the person publishes it',
      'asking the person one question at a time',
      // The interview's four outcomes, the same ones the start prompt names.
      'a template as it is, with changes, a board of its own, or Otea is not a fit (draft nothing)',
      '--template <key>',
      'Keep going until the person stops you',
      'otea wait --turn agent --unclaimed',
      'in a background shell, which keeps your chat free',
      'Every request the person makes, in chat too, goes on a board first: otea create it',
      // P8-R3-3: a board request made through otea create, then board draft, became two Pedidos.
      'A new board or a change to one goes through rule 11, never otea create.',
      'A subagent releases what it holds before it ends',
      // P4-R2-2: the person's answer is theirs; one given in the chat goes on the question.
      'answer they give in the chat goes on it: otea answer <id> "<their words>"',
      // P2S-6, P8-R2-13, P8-R2-11: only a running wait hears the desk, and it is stopped safely.
      'Only a running wait hears the desk',
      'after a chat reply, wait again',
      'Stop your wait by ending its shell or with --timeout, never by killing processes by name',
      // P3C-R3-2: «leave it for later» is release --later, and otea wait is the only way to wait.
      // P7-R3-6: it is the person's wish, so it holds for every agent.
      'When the person says to leave an item for later: otea release <id> --later sets it aside for every agent; then keep waiting.',
      'Never write a polling loop of your own: otea wait is how you wait.',
      // 0.8: who the secretary is, and that nobody else talks to the person in its chat.
      "The project's secretary (otea profile --role secretary) alone talks with the person in the Hablar chat",
      'You are not it unless told so: ask on the item (rule 10).',
    ]) {
      expect(AGENT_GUIDE).toContain(line);
    }
  });

  // Cold review G2: the guide is printed to the secretary too, and told it to claim, next and wait
  // for turns; rule 4 named one heading on a board that may use the other; the desk says «sin señal»
  // after SILENT_AFTER_MS, not the 7 minutes the guide said.
  it('tells the secretary which rules are not its own, names both hand-off headings and the real silent time', () => {
    const rule = (n: number) =>
      AGENT_GUIDE.split('\n').find((line) => line.startsWith(`${n}. `)) ?? '';
    expect(rule(13)).toMatch(/If you are it.*skip rules 3, 6 and 12.*otea wait --secretary/);
    expect(rule(4)).toContain('"Before you hand it off" ("Antes de entregarlo" on a Spanish board)');
    expect(rule(3)).toContain(`past ${SILENT_AFTER_MS / 60_000} min`);
    expect(SILENT_AFTER_MS).toBe(7.5 * 60_000);
  });

  // P8-F4: a client that reads only the instructions has no shell to run `otea next --claim` in, so
  // it reads the guide in the words of the tools it has, as the board tool gives it.
  it('is the MCP server instructions, in the words of the tools', async () => {
    const server = createMcpServer(COMMANDS, { cwd: repo.dir, warn: () => {} });
    const client = new Client({ name: 'test', version: '0' });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    await client.connect(clientSide);
    const instructions = client.getInstructions() ?? '';
    expect(instructions).toBe(mcpWords(AGENT_GUIDE, COMMANDS));
    expect(instructions).toContain('claim { id: "<id>" }');
    expect(instructions).toContain('next { claim: true }');
    expect(instructions).not.toContain('otea next');
    expect(instructions).not.toContain('otea claim');
    await client.close();
  });

  // One copy in context: an MCP agent has the instructions, a CLI agent reads otea board. The
  // AGENTS.md block points at both instead of a third copy, which also went stale (MCP-TOKENS).
  it('is not copied into the AGENTS.md block, which says where to read it', async () => {
    await otea('init', '--local', '--agents-md');
    const written = readFileSync(join(repo.dir, 'AGENTS.md'), 'utf8');
    expect(written).toContain(AGENTS_BLOCK);
    expect(AGENTS_BLOCK).not.toContain(AGENT_GUIDE.split('\n')[1]);
    expect(AGENTS_BLOCK).toContain("Over MCP it is the Otea server's instructions");
    expect(AGENTS_BLOCK).toContain('read it first with `otea board`');
  });

  it('opens the board index, and no single board, on the CLI and over MCP', async () => {
    expect((await otea('board')).out).toContain(AGENT_GUIDE);
    expect((await otea('board', 'tasks')).out).not.toContain(AGENT_GUIDE.split('\n')[1]);
    const server = createMcpServer(COMMANDS, { cwd: repo.dir, agent: 'claude', warn: () => {} });
    const client = new Client({ name: 'test', version: '0' });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    await client.connect(clientSide);
    const text = async (args: Record<string, unknown>) =>
      (
        (await client.callTool({ name: 'board', arguments: args })) as {
          content: { text: string }[];
        }
      ).content[0]?.text ?? '';
    expect(await text({})).toContain(AGENT_GUIDE.split('\n')[0]);
    expect(await text({ name: 'tasks' })).not.toContain(AGENT_GUIDE.split('\n')[0]);
    await client.close();
  });

  it('stays out of otea board --json, which scripts read', async () => {
    const { out } = await otea('board', '--json');
    expect(out).not.toContain(AGENT_GUIDE.split('\n')[0]);
  });
});

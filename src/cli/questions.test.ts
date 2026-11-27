import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBoard, publishBoard, saveDraft } from '../app/boards.ts';
import { openProject } from '../app/project.ts';
import { answerQuestion } from '../app/questions.ts';
import { creatures } from '../core/board/testing.ts';
import { createMcpServer } from '../mcp/server.ts';
import { COMMANDS } from './commands.ts';
import { type Cli, cliAt, declareProfiles, seedOnce, type TempRepo } from './testing.ts';

// What wait ends with for claude once it woke.
const AGAIN =
  'Then keep going: otea next --as claude; when it has nothing, otea wait --turn agent --unclaimed --as claude in the background if you can.\n';

// An agent's question to the person: otea ask on the CLI and ask over MCP, what show and next say
// while it waits and once answered, and the wait the answer wakes.
describe('an agent asks the person, on the CLI and over MCP', () => {
  let repo: TempRepo;
  let otea: Cli;

  const answer = (given: string | { option: number }) => {
    const project = openProject(repo.dir);
    try {
      return answerQuestion(project, {
        id: 'CRI-1',
        ...(typeof given === 'string' ? { text: given } : given),
        actor: { kind: 'human', name: 'human' },
        channel: 'ui',
      });
    } finally {
      project.db.close();
    }
  };

  // Seeded once and copied for each test: seeding through the CLI before every one of them took a
  // loaded Windows runner past the hook's 30s.
  const seeded = seedOnce(async (seed, dir) => {
    declareProfiles(dir, 'claude');
    const project = openProject(dir);
    try {
      const record = createBoard(project, { name: 'Criaturas', lang: 'es' });
      saveDraft(project, record.id, { definition: creatures(), baseVersion: null });
      publishBoard(project, record.id, { moves: {}, by: { kind: 'human', name: 'fede' } });
    } finally {
      project.db.close();
    }
    await seed(
      'create',
      '--collection',
      'Criaturas',
      '--title',
      'Tortuga',
      '--field',
      'fdesc=Lenta',
    );
    await seed('claim', 'CRI-1');
  });

  beforeEach(() => {
    ({ repo, otea } = seeded.fresh());
  });

  afterEach(() => repo.remove());

  it('asks, hands the turn to the person, and gives the answer back in the same round', async () => {
    const asked = await otea('ask', 'CRI-1', '¿Caparazón liso o con musgo?');
    expect(asked.code).toBe(0);
    expect(asked.out).toContain('Asked the person on CRI-1: the turn is theirs until they answer');

    const shown = JSON.parse((await otea('show', 'CRI-1', '--json')).out);
    expect(shown.turn).toBe('human');
    expect(shown.asks).toMatchObject({ question: 1, by: 'claude' });
    expect((await otea('show', 'CRI-1')).out).toContain(
      'Waiting for the person to answer your question: "¿Caparazón liso o con musgo?"',
    );
    const handed = await otea('handoff', 'CRI-1');
    expect(handed.code).not.toBe(0);
    expect(handed.err).toContain('waits for their answer');

    answer('Con musgo');

    const waited = await otea('wait', '--turn', 'agent', '--timeout', '5s');
    expect(waited.out).toBe(
      `CRI-1: the person answered your question. Read it: otea show CRI-1\n${AGAIN}`,
    );
    const next = await otea('next');
    expect(next.out).toContain('Concepto, round 1');
    expect(next.out).toContain('You asked the person: "¿Caparazón liso o con musgo?"');
    expect(next.out).toContain('The person answered: "Con musgo"');
  });

  it('keeps a wait for unclaimed work on the question it asked, not on another free item', async () => {
    await otea('create', '--collection', 'Criaturas', '--title', 'Pulpo', '--field', 'fdesc=Ocho');
    await otea('ask', 'CRI-1', '¿Caparazón liso o con musgo?');

    const waited = await otea('wait', '--turn', 'agent', '--unclaimed', '--timeout', '2s');
    expect(waited.out).not.toContain('CRI-2');
    expect(waited.code).toBe(13);
    expect(waited.err).toContain('CRI-1');

    answer('Con musgo');
    const woken = await otea('wait', '--turn', 'agent', '--unclaimed', '--timeout', '5s');
    expect(woken.out).toBe(
      `CRI-1: the person answered your question. Read it: otea show CRI-1\n${AGAIN}`,
    );
  });

  // A pty is no proof a person types: an agent in one must not answer its own question as them.
  it('refuses otea answer without a name at a terminal, leaving the question open', async () => {
    await otea('ask', 'CRI-1', '¿Caparazón liso o con musgo?');
    const terminal = cliAt(
      repo.dir,
      {},
      undefined,
      undefined,
      undefined,
      undefined,
      true,
      {},
      true,
    );

    const refused = await terminal('answer', 'CRI-1', 'Con musgo', '--json');

    expect(JSON.parse(refused.err).error.code).toBe('unnamed_agent');
    expect((await otea('show', 'CRI-1')).out).toContain('Waiting for the person to answer');
  });

  // P4-R2-2: the person answered in the chat, and otea reply could not put it on the question.
  it('notes on the question an answer the person gave in the chat, on the CLI and over MCP', async () => {
    await otea('ask', 'CRI-1', '¿Caparazón liso o con musgo?');
    const noted = await otea('answer', 'CRI-1', 'Con musgo');
    expect(noted.code).toBe(0);
    expect(noted.out).toContain("Noted the person's answer on CRI-1, as given in the chat.");
    // P3C-R3-9: after a chat answer an agent said it left a wait running, and started none.
    expect(noted.out.trimEnd().split('\n').at(-1)).toBe(
      'When you finish and otea next --as claude has nothing: otea wait --turn agent --unclaimed --as claude in the background if you can.',
    );
    expect((await otea('next')).out).toContain('The person answered: "Con musgo"');
    expect((await otea('answer', 'CRI-1', 'Otra')).err).toContain('no question waits');

    await otea('ask', 'CRI-1', '¿Verde o gris?');
    const server = createMcpServer(COMMANDS, {
      json: true,
      cwd: repo.dir,
      agent: 'claude',
      warn: () => {},
    });
    const client = new Client({ name: 'test', version: '0' });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    await client.connect(clientSide);
    const reply = (await client.callTool({
      name: 'answer',
      arguments: { id: 'CRI-1', answer: 'Gris' },
    })) as { isError?: boolean; content: { text: string }[] };
    expect(reply.isError).toBe(false);
    const data = JSON.parse(reply.content[0]?.text ?? 'null');
    expect(data.question.answer).toMatchObject({ text: 'Gris', via: 'claude' });
    await client.close();
  });

  it('refuses a question with no words', async () => {
    const { code, err } = await otea('ask', 'CRI-1', '  ');
    expect(code).toBe(2);
    expect(err).toContain('say your question');
  });

  it('asks over MCP with the ask tool', async () => {
    const server = createMcpServer(COMMANDS, {
      json: true,
      cwd: repo.dir,
      agent: 'claude',
      warn: () => {},
    });
    const client = new Client({ name: 'test', version: '0' });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    await client.connect(clientSide);
    const reply = (await client.callTool({
      name: 'ask',
      arguments: { id: 'CRI-1', question: '¿A o B?' },
    })) as { isError?: boolean; content: { text: string }[] };
    expect(reply.isError).toBe(false);
    const data = JSON.parse(reply.content[0]?.text ?? 'null');
    expect(data.question).toMatchObject({ question: 1, text: '¿A o B?', by: 'claude' });
    expect(data.text).toContain('the turn is theirs');
    await client.close();
  });

  it('asks with options and a recommendation, and gives the pick back, on the CLI', async () => {
    const asked = await otea(
      'ask',
      'CRI-1',
      '¿Caparazón?',
      '--option',
      'Liso',
      '--option',
      'Con musgo',
      '--recommend',
      '2',
    );
    expect(asked.code).toBe(0);
    const shown = JSON.parse((await otea('show', 'CRI-1', '--json')).out);
    expect(shown.asks).toMatchObject({ options: ['Liso', 'Con musgo'], recommended: 2 });
    expect((await otea('show', 'CRI-1')).out).toContain(
      'Options: 1. Liso · 2. Con musgo (recommended)',
    );

    answer({ option: 2 });

    const next = (await otea('next')).out;
    expect(next).toContain('You asked the person: "¿Caparazón?"');
    expect(next).toContain('The person chose option 2: "Con musgo"');
  });

  // Field study 5, V7/V2: «Te escribo las fechas» was sent as it read when tapped, and otea ask had
  // no way to say that option needs the person's words (say has --option-text).
  it('marks the options that need the person’s own words, and refuses one that names no option', async () => {
    const asked = await otea(
      'ask',
      'CRI-1',
      '¿Qué fechas?',
      '--option',
      'Las de siempre',
      '--option',
      'Te escribo las fechas',
      '--option-text',
      '2',
    );
    expect(asked.code, asked.err).toBe(0);
    const shown = JSON.parse((await otea('show', 'CRI-1', '--json')).out);
    expect(shown.asks).toMatchObject({ options: ['Las de siempre', 'Te escribo las fechas'] });
    expect(shown.asks.optionText).toEqual([2]);

    const stray = await otea(
      'ask',
      'CRI-2',
      '¿A?',
      '--option',
      'a',
      '--option',
      'b',
      '--option-text',
      '3',
    );
    expect(stray.code).not.toBe(0);
    expect(stray.err).toContain('--option-text 3 names no option');
  });

  it('refuses options it cannot offer, and a recommendation with none, on the CLI', async () => {
    const one = await otea('ask', 'CRI-1', '¿A?', '--option', 'Solo');
    expect(one.code).not.toBe(0);
    expect(one.err).toContain('2 to 4 options');
    const stray = await otea('ask', 'CRI-1', '¿A?', '--recommend', '1');
    expect(stray.code).not.toBe(0);
    expect(stray.err).toContain('needs options');
    const word = await otea(
      'ask',
      'CRI-1',
      '¿A?',
      '--option',
      'a',
      '--option',
      'b',
      '--recommend',
      'x',
    );
    expect(word.code).not.toBe(0);
    expect(word.err).toContain('--recommend');
    expect(JSON.parse((await otea('show', 'CRI-1', '--json')).out).asks).toBeUndefined();
  });

  it('asks with options over MCP, as options and recommended', async () => {
    const server = createMcpServer(COMMANDS, {
      json: true,
      cwd: repo.dir,
      agent: 'claude',
      warn: () => {},
    });
    const client = new Client({ name: 'test', version: '0' });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    await client.connect(clientSide);
    const tools = await client.listTools();
    const schema = tools.tools.find((tool) => tool.name === 'ask')?.inputSchema.properties;
    expect(Object.keys(schema ?? {})).toEqual(expect.arrayContaining(['options', 'recommended']));
    const reply = (await client.callTool({
      name: 'ask',
      arguments: { id: 'CRI-1', question: '¿A o B?', options: ['A', 'B'], recommended: 1 },
    })) as { isError?: boolean; content: { text: string }[] };
    expect(reply.isError).toBe(false);
    const data = JSON.parse(reply.content[0]?.text ?? 'null');
    expect(data.question).toMatchObject({ options: ['A', 'B'], recommended: 1 });
    await client.close();
  });
});

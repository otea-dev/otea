import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { postPersonMessage } from '../app/conversation.ts';
import { liveBoardOf } from '../app/next.ts';
import { openProject } from '../app/project.ts';
import { stateOf } from '../core/board/engine.ts';
import { createMcpServer } from '../mcp/server.ts';
import { updateItemState } from '../store/queries.ts';
import { COMMANDS } from './commands.ts';
import { type Cli, cliAt, declareProfiles, type TempRepo, tempGitRepo } from './testing.ts';

// U8 (field study 4): `otea relay CAM-5 Dropped --quote "tiralo, no va" --reason ... --as intruso`
// dropped an item that waited for the person's review, with words nobody said, and the desk
// showed «Descartado: lo pidió Rafa». With a secretary, a relay is the secretary's, with the
// person's own message in Hablar; an item in their review leaves it by their tap on a card.
describe('relay attacks, through the command line and MCP', () => {
  let repo: TempRepo;
  let intruso: Cli;
  let sol: Cli;
  let inReview = '';

  const person = (text: string) => {
    const project = openProject(repo.dir);
    try {
      return postPersonMessage(project, { text, files: [] }).message;
    } finally {
      project.db.close();
    }
  };

  const stateOfCam = async () => JSON.parse((await sol('show', 'CAM-1', '--json')).out).state;

  beforeEach(async () => {
    repo = tempGitRepo();
    intruso = cliAt(repo.dir, { OTEA_AGENT: 'intruso' });
    sol = cliAt(repo.dir, { OTEA_AGENT: 'sol' });
    const owner = cliAt(repo.dir);
    await owner('init', '--template', 'none');
    await owner('board', 'add', 'Cambios', '--template', 'changes');
    declareProfiles(repo.dir, 'sol', 'intruso');
    await owner('profile', '--role', 'secretary', '--as', 'sol');
    await sol('create', '--collection', 'Cambios', '--title', 'Regar', '--field', 'Qué quiero=x');
    const project = openProject(repo.dir);
    try {
      const doit = liveBoardOf(project, 'Cambios')?.def.steps.find(
        ({ name }) => name === 'Hacerlo',
      );
      if (!doit) throw new Error('no Hacerlo');
      inReview = stateOf({ step: doit.id, phase: 'review' });
      updateItemState(project.db, 'CAM-1', inReview, '2026-11-27T10:00:00Z');
    } finally {
      project.db.close();
    }
  });

  afterEach(() => repo.remove());

  it('refuses an agent that relays a drop with an invented quote, and the item stays in review', async () => {
    const { code, err } = await intruso(
      'relay',
      'CAM-1',
      'Dropped',
      '--quote',
      'tiralo, no va',
      '--reason',
      'lo pidió Rafa',
      '--motive',
      'Ya no hace falta',
    );

    expect(code).toBe(7);
    expect(err).toContain('only the secretary');
    expect(await stateOfCam()).toBe(inReview);
  });

  it('refuses the secretary with no message of the person, or one that does not say it', async () => {
    const said = person('dejalo, me gusta');

    const none = await sol('relay', 'CAM-1', 'Hacerlo', '--quote', 'dejalo ya', '--reason', 'x');
    const wrong = await sol(
      'relay',
      'CAM-1',
      'Hacerlo',
      '--quote',
      'tiralo ya',
      '--reason',
      'x',
      '--from-message',
      String(said.id),
    );

    expect(none.err).toContain('--from-message');
    expect(wrong.err).toContain('does not contain');
    expect(await stateOfCam()).toBe(inReview);
  });

  it('never takes an item out of the person’s review by a relay, not even a send-back with their words', async () => {
    const said = person('devolvelo, falta el carro');

    const { code, err } = await sol(
      'relay',
      'CAM-1',
      'Hacerlo',
      '--quote',
      'falta el carro',
      '--reason',
      'Falta el carro',
      '--from-message',
      String(said.id),
    );

    expect(code).toBe(7);
    expect(err).toContain('waits for your review');
    expect(err).toContain('--drop CAM-1');
    expect(await stateOfCam()).toBe(inReview);
  });

  it('asks the person to drop it with a card instead, which moves nothing until they tap', async () => {
    const said = await sol(
      'say',
      'Drop CAM-1?',
      '--drop',
      'CAM-1',
      '--note',
      'ya no hace falta',
      '--motive',
      'Ya no hace falta',
      '--option',
      'Drop CAM-1',
      '--option',
      'Leave it',
      '--json',
    );

    expect(said.code, said.err).toBe(0);
    expect(JSON.parse(said.out).message.action).toMatchObject({ kind: 'drop', item: 'CAM-1' });
    expect(await stateOfCam()).toBe(inReview);
  });

  it('serves the same guards as an MCP tool', async () => {
    const said = person('tiralo ya');
    const server = createMcpServer(COMMANDS, { cwd: repo.dir, agent: 'intruso', warn: () => {} });
    const client = new Client({ name: 'test', version: '0' });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    await client.connect(clientSide);
    try {
      const { tools } = await client.listTools();
      const relay = tools.find(({ name }) => name === 'relay');
      expect(Object.keys(relay?.inputSchema.properties ?? {})).toContain('from_message');
      const result = (await client.callTool({
        name: 'relay',
        arguments: {
          id: 'CAM-1',
          state: 'Dropped',
          quote: 'tiralo ya',
          reason: 'x',
          from_message: String(said.id),
        },
      })) as { isError?: boolean; content: { text: string }[] };

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('only the secretary');
    } finally {
      await client.close();
    }
    expect(await stateOfCam()).toBe(inReview);
  });
});

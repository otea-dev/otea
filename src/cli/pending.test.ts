import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureToBandeja } from '../app/bandeja.ts';
import { openProject, type Project } from '../app/project.ts';
import { createMcpServer } from '../mcp/server.ts';
import { COMMANDS } from './commands.ts';
import { type Cli, declareProfiles, presetCollection, seedOnce, type TempRepo } from './testing.ts';

// F4 (field study 3): what waits for the person is Otea's to say, not the secretary's memory
// (`otea pending`), and a worker or a refiner that has something the person must know says it to
// the secretary (`otea escalate`), who relays it in Hablar.
describe('what waits for the person, from the secretary', () => {
  let repo: TempRepo;
  let otea: Cli;

  const seeded = seedOnce(async (_cli, dir) => {
    declareProfiles(dir, 'sol', 'lia', 'worker');
    presetCollection(dir, 'tasks');
  });

  beforeEach(async () => {
    ({ repo, otea } = seeded.fresh());
    await otea('profile', '--role', 'secretary', '--as', 'sol');
  });

  afterEach(() => repo.remove());

  const inProject = <T>(use: (project: Project) => T): T => {
    const project = openProject(repo.dir);
    try {
      return use(project);
    } finally {
      project.db.close();
    }
  };

  const item = async (title = 'Retry with backoff') =>
    JSON.parse(
      (
        await otea(
          'create',
          '--collection',
          'tasks',
          '--title',
          title,
          '--description',
          'D',
          '--as',
          'worker',
          '--json',
        )
      ).out,
    ).id as string;

  const noteWithQuestion = async (text: string, question: string) => {
    inProject((project) => captureToBandeja(project, { text }));
    await otea('bandeja', 'take', 'B-1', '--as', 'lia');
    await otea('ask', 'B-1', question, '--option', 'A', '--option', 'B', '--as', 'lia');
  };

  describe('otea pending', () => {
    it('lists a question on a Bandeja note, which no list of items held', async () => {
      await noteWithQuestion('the Aprobar button is hidden', 'Which screen?');

      const { out, code } = await otea('pending', '--as', 'sol');

      expect(code).toBe(0);
      expect(out).toContain('1 thing waits for the person');
      expect(out).toContain('B-1');
      expect(out).toContain('Which screen?');
      const json = JSON.parse((await otea('pending', '--as', 'sol', '--json')).out);
      expect(json).toMatchObject({
        count: 1,
        entries: [{ kind: 'bandeja', ref: 'B-1', options: ['A', 'B'] }],
      });
    });

    it('lists a review, so the secretary does not tell it from memory', async () => {
      const id = await item('Dark mode');
      await otea('claim', id, '--as', 'worker');
      await otea('handoff', id, '--as', 'worker');

      const { out } = await otea('pending', '--as', 'sol');

      expect(out).toContain('1 thing waits for the person');
      expect(out).toContain(`${id} «Dark mode» waits for their review`);
    });

    it('says plainly when nothing waits', async () => {
      const { out } = await otea('pending', '--as', 'sol');

      expect(out).toContain('Nothing waits for the person');
    });

    it('ends the secretary’s wait and its reading with how many wait, so a notice never rests on memory', async () => {
      await noteWithQuestion('a note', 'Which screen?');
      inProject((project) => captureToBandeja(project, { text: 'another' }));

      const woke = await otea('wait', '--secretary', '--as', 'sol');
      expect(woke.out).toContain('1 thing waits for the person (otea pending');
    });

    it('is a tool of MCP too', async () => {
      const server = createMcpServer(COMMANDS, { cwd: repo.dir, agent: 'sol', warn: () => {} });
      const client = new Client({ name: 'test', version: '0' });
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      await server.connect(serverSide);
      await client.connect(clientSide);
      try {
        const { tools } = await client.listTools();
        expect(tools.map(({ name }) => name)).toEqual(
          expect.arrayContaining(['pending', 'escalate']),
        );
        const read = (await client.callTool({ name: 'pending', arguments: {} })) as {
          content: { text: string }[];
        };
        expect(read.content[0]?.text).toContain('Nothing waits for the person');
      } finally {
        await client.close();
      }
    });
  });

  describe('otea escalate', () => {
    it('wakes the secretary with what a worker says, naming the item and the worker', async () => {
      const id = await item();

      const said = await otea(
        'escalate',
        id,
        'I pushed change/CHA-5-v2 by mistake: it has no item.',
        '--as',
        'worker',
      );
      expect(said.code).toBe(0);
      expect(said.out).toContain('Told sol');

      const woke = JSON.parse((await otea('wait', '--secretary', '--as', 'sol', '--json')).out);
      expect(woke).toMatchObject({ kind: 'escalation', ref: id });
      expect(woke.text).toContain('worker');
      expect(woke.text).toContain('I pushed change/CHA-5-v2 by mistake');
      expect(woke.text).toContain('otea say');
    });

    // F4 review round: an away secretary relays nothing; the person reads it in Te toca and Te
    // espera, and the worker is told so.
    it('tells the worker the person sees it directly when the secretary is offline', async () => {
      const id = await item();
      const longAgo = new Date(Date.now() - 45 * 60_000).toISOString();
      inProject((project) =>
        project.db
          .prepare(
            "UPDATE agents SET last_seen = ?, acted_at = ?, listening_at = NULL WHERE name = 'sol'",
          )
          .run(longAgo, longAgo),
      );

      const said = await otea('escalate', id, 'The push failed twice.', '--as', 'worker');

      expect(said.code).toBe(0);
      expect(said.out).toContain('offline');
      expect(said.out).toContain('the person will see it directly');
      const shown = await otea('pending', '--as', 'worker');
      expect(shown.out).toContain('worker says');
      expect(shown.out).toContain('The push failed twice.');
    });

    it('takes a note of the Bandeja as the place it is about', async () => {
      inProject((project) => captureToBandeja(project, { text: 'a duplicate of CAM-1' }));

      const said = await otea('escalate', 'B-1', 'It is the same as CAM-1.', '--as', 'lia');

      expect(said.code).toBe(0);
      const woke = JSON.parse((await otea('wait', '--secretary', '--as', 'sol', '--json')).out);
      expect(woke).toMatchObject({ kind: 'escalation', ref: 'B-1' });
    });

    it('says what to do instead when the project has no secretary', async () => {
      repo.remove();
      ({ repo, otea } = seeded.fresh());
      const id = await item('x');

      const { code, err } = await otea('escalate', id, 'a problem', '--as', 'worker');

      expect(code).not.toBe(0);
      expect(err).toContain('no secretary');
      expect(err).toContain('otea ask');
    });

    it('is not for the secretary, who speaks with say', async () => {
      const id = await item();

      const { code, err } = await otea('escalate', id, 'x', '--as', 'sol');

      expect(code).not.toBe(0);
      expect(err).toContain('otea say');
    });

    it('needs an item or a note that is there, and some words', async () => {
      const missing = await otea('escalate', 'CAM-99', 'x', '--as', 'worker');
      expect(missing.code).toBe(3);
      expect(missing.err).toContain('CAM-99');
      const id = await item();
      const empty = await otea('escalate', id, '   ', '--as', 'worker');
      expect(empty.code).toBe(2);
      expect(empty.err).toContain('say what the secretary should know');
    });
  });
});

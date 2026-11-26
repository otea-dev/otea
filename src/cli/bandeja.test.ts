import { readFileSync } from 'node:fs';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { answerBandeja, captureToBandeja, listBandeja } from '../app/bandeja.ts';
import { openProject, type Project } from '../app/project.ts';
import { createMcpServer } from '../mcp/server.ts';
import { COMMANDS } from './commands.ts';
import { type Cli, declareProfiles, presetCollection, seedOnce, type TempRepo } from './testing.ts';

// The Bandeja from the agents' side (0.8, M5): `otea bandeja` reads the person's captures, `take`
// holds one for a refiner, `create --from-bandeja` turns it into an item and `ask B-n` asks the
// person what it lacks. The person captures and answers only from the desk's routes: here the test
// calls the app functions those routes call.
describe('the Bandeja from the refiner', () => {
  let repo: TempRepo;
  let otea: Cli;

  const seeded = seedOnce(async (_cli, dir) => {
    declareProfiles(dir, 'sol', 'lia', 'max', 'worker');
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

  // The person captures from the desk.
  const capture = (text: string, files: { filename: string; bytes: Buffer }[] = []) =>
    inProject((project) => captureToBandeja(project, { text, files }).entry);

  const entries = () => inProject((project) => listBandeja(project, { filed: 10 }));

  const refined = (title: string, ...more: string[]) =>
    otea(
      'create',
      '--collection',
      'tasks',
      '--title',
      title,
      '--description',
      'What I want: it visible. How I check it: at 390.',
      ...more,
    );

  describe('reading and taking', () => {
    it('lists what waits, and one entry whole with a path to each file', async () => {
      expect((await otea('bandeja', '--as', 'lia')).out).toContain('The Bandeja is empty');
      const sent = capture('the Aprobar button is hidden on the phone', [
        { filename: 'phone.png', bytes: Buffer.from('png-bytes') },
      ]);

      const list = await otea('bandeja', '--as', 'lia');
      expect(list.out).toContain('B-1');
      expect(list.out).toContain('waiting for a refiner');
      expect(list.out).toContain('"the Aprobar button is hidden on the phone" (+1 file(s))');

      const one = JSON.parse((await otea('bandeja', 'B-1', '--as', 'lia', '--json')).out);
      expect(one).toMatchObject({ id: sent.id, ref: 'B-1', state: 'waiting' });
      expect(readFileSync(one.attachments[0].path, 'utf8')).toBe('png-bytes');
      const text = (await otea('bandeja', 'B-1', '--as', 'lia')).out;
      expect(text).toContain('  the Aprobar button is hidden on the phone');
      expect(text).toContain('attached: phone.png (image, 9 B)');
      expect(text).toContain('otea bandeja take B-1 --as lia');
    });

    it('wakes the secretary’s wait until the entry is taken, then not', async () => {
      capture('an idea');

      const woke = JSON.parse((await otea('wait', '--secretary', '--as', 'sol', '--json')).out);
      expect(woke).toMatchObject({ kind: 'bandeja_item', ref: 'B-1' });

      const taken = await otea('bandeja', 'take', 'B-1', '--as', 'lia');
      expect(taken.code).toBe(0);
      expect(taken.out).toContain('Took B-1 until');
      const idle = await otea('wait', '--secretary', '--as', 'sol', '--timeout', '1');
      expect(idle.code).toBe(13);
    });

    it('is never taken twice: the second refiner is refused, naming the first', async () => {
      capture('an idea');
      await otea('bandeja', 'take', 'B-1', '--as', 'lia');

      const second = await otea('bandeja', 'take', 'B-1', '--as', 'max');

      expect(second.code).toBe(7);
      expect(second.err).toContain('B-1 is held by lia until');
      expect(entries()[0]).toMatchObject({ state: 'refining', claimedBy: 'lia' });
      // The holder taking it again is no refusal.
      const again = await otea('bandeja', 'take', 'B-1', '--as', 'lia');
      expect(again.out).toContain('Still holding B-1');
    });

    it('lets the secretary take it for the refiner it launches, and nobody else', async () => {
      capture('an idea');

      const refused = await otea('bandeja', 'take', 'B-1', '--for', 'lia', '--as', 'max');
      expect(refused.code).toBe(7);
      expect(refused.err).toContain("Only the project's secretary takes an entry for a refiner");

      const done = await otea('bandeja', 'take', 'B-1', '--for', 'lia', '--as', 'sol');
      expect(done.out).toContain('Took B-1 for lia');
      expect(entries()[0]).toMatchObject({ state: 'refining', claimedBy: 'lia' });
      expect((await otea('wait', '--secretary', '--as', 'sol', '--timeout', '1')).code).toBe(13);
    });

    it('makes no entry: nothing on the command line or in MCP captures as the person', async () => {
      const add = await otea('bandeja', 'add', 'file this', '--as', 'sol');
      expect(add.code).not.toBe(0);
      expect(entries()).toEqual([]);

      // The person's name takes nothing, nor is it a refiner the secretary takes for.
      capture('a real capture');
      const forged = await otea('bandeja', 'take', 'B-1', '--as', 'human');
      const forgedFor = await otea('bandeja', 'take', 'B-1', '--for', 'human', '--as', 'sol');
      const stranger = await otea('bandeja', 'take', 'B-1', '--for', 'nobody-yet', '--as', 'sol');
      expect(forged.code).not.toBe(0);
      expect(forgedFor.code).not.toBe(0);
      expect(stranger.code).toBe(7);
      expect(stranger.err).toContain('nobody-yet is not an agent of this project yet');
      expect(entries()).toEqual([expect.objectContaining({ ref: 'B-1', state: 'waiting' })]);

      const server = createMcpServer(COMMANDS, { cwd: repo.dir, agent: 'sol', warn: () => {} });
      const client = new Client({ name: 'test', version: '0' });
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      await server.connect(serverSide);
      await client.connect(clientSide);
      try {
        const { tools } = await client.listTools();
        const names = tools.map(({ name }) => name);
        expect(names).toEqual(expect.arrayContaining(['bandeja', 'bandeja_take']));
        expect(names.filter((name) => /bandeja|capture/.test(name)).sort()).toEqual([
          'bandeja',
          'bandeja_take',
        ]);
      } finally {
        await client.close();
      }
    });
  });

  describe('refining it into an item', () => {
    it('is refused without holding the entry, and makes nothing', async () => {
      capture('an idea');

      const none = await refined('Dark mode', '--from-bandeja', 'B-1', '--as', 'lia');
      expect(none.code).toBe(7);
      expect(none.err).toContain('You do not hold B-1');

      await otea('bandeja', 'take', 'B-1', '--as', 'lia');
      const other = await refined('Dark mode', '--from-bandeja', 'B-1', '--as', 'max');
      expect(other.code).toBe(7);
      expect(other.err).toContain('(lia does)');
      expect(JSON.parse((await otea('list', '--as', 'worker', '--json')).out)).toEqual([]);
    });

    it('makes the item, files the entry under it, and the item says where it came from', async () => {
      capture('the Aprobar button is hidden on the phone');
      await otea('bandeja', 'take', 'B-1', '--as', 'lia');

      const made = await refined(
        'Show the button',
        '--from-bandeja',
        'B-1',
        '--as',
        'lia',
        '--json',
      );

      expect(made.code).toBe(0);
      const item = JSON.parse(made.out) as { id: string; bandeja: string };
      expect(item.bandeja).toBe('B-1');
      expect(entries()[0]).toMatchObject({ state: 'filed', item: item.id, filedBy: 'lia' });

      const shown = await otea('show', item.id, '--as', 'worker');
      expect(shown.out).toContain(
        'Refined from the Bandeja, B-1: "the Aprobar button is hidden on the phone"',
      );
      const json = JSON.parse((await otea('show', item.id, '--as', 'worker', '--json')).out);
      expect(json.fromBandeja).toMatchObject({ ref: 'B-1', snippet: expect.any(String) });
      // Nothing waits for the secretary, and nobody takes it again.
      expect((await otea('wait', '--secretary', '--as', 'sol', '--timeout', '1')).code).toBe(13);
      const again = await otea('bandeja', 'take', 'B-1', '--as', 'max');
      expect(again.code).toBe(4);
      expect(again.err).toContain('filed already');
      const all = await otea('bandeja', '--all', '--as', 'lia');
      expect(all.out).toContain(`filed as ${item.id}`);
    });
  });

  describe('asking the person on an entry', () => {
    it('shows options on the entry, waits for the answer, and wakes the secretary with it', async () => {
      capture('make it better');
      await otea('bandeja', 'take', 'B-1', '--as', 'lia');

      const asked = await otea(
        'ask',
        'B-1',
        'Better how?',
        '--option',
        'Faster',
        '--option',
        'Prettier',
        '--recommend',
        '2',
        '--as',
        'lia',
      );

      expect(asked.code).toBe(0);
      expect(asked.out).toContain('Asked the person on B-1');
      expect(entries()[0]).toMatchObject({
        state: 'asking',
        asking: { text: 'Better how?', options: ['Faster', 'Prettier'], recommended: 2 },
      });
      // Nothing for the secretary until they answer.
      expect((await otea('wait', '--secretary', '--as', 'sol', '--timeout', '1')).code).toBe(13);
      const busy = await otea('bandeja', 'take', 'B-1', '--as', 'max');
      expect(busy.code).toBe(4);

      // The person taps an option on the desk.
      inProject((project) => answerBandeja(project, { id: 1, question: 1, option: 2 }));

      const woke = JSON.parse((await otea('wait', '--secretary', '--as', 'sol', '--json')).out);
      expect(woke).toMatchObject({ kind: 'bandeja_item', ref: 'B-1' });
      await otea('bandeja', 'take', 'B-1', '--for', 'lia', '--as', 'sol');
      const read = await otea('bandeja', 'B-1', '--as', 'lia');
      expect(read.out).toContain(
        'lia asked: "Better how?" Options: 1. Faster · 2. Prettier (recommended)',
      );
      expect(read.out).toContain('The person chose option 2: "Prettier"');

      // Refined with the answer.
      const made = await refined('Prettier look', '--from-bandeja', 'B-1', '--as', 'lia');
      expect(made.code).toBe(0);
      expect(entries()[0]?.state).toBe('filed');
    });

    it('is asked only by the holder, and takes a question that checks', async () => {
      capture('make it better');

      const unheld = await otea('ask', 'B-1', 'Better how?', '--as', 'lia');
      expect(unheld.code).toBe(7);
      expect(unheld.err).toContain('take it first');

      await otea('bandeja', 'take', 'B-1', '--as', 'lia');
      const one = await otea('ask', 'B-1', 'Better how?', '--option', 'Only one', '--as', 'lia');
      expect(one.code).toBe(8);
      expect(one.err).toContain('give 2 to 4 options');
      expect(entries()[0]?.state).toBe('refining');
    });
  });
});

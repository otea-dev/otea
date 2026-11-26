import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureToBandeja, listBandeja, reopenBandeja } from '../app/bandeja.ts';
import { openProject, type Project } from '../app/project.ts';
import { createMcpServer } from '../mcp/server.ts';
import { COMMANDS } from './commands.ts';
import { type Cli, declareProfiles, presetCollection, seedOnce, type TempRepo } from './testing.ts';

// The refiner side of the Bandeja when no refiner is there, or when one refiner does it all (field
// study 3, S4 and S5): close a note with a reason, and take the next one, waiting for it.
describe('the Bandeja: closing, and one refiner taking the next note', () => {
  let repo: TempRepo;
  let otea: Cli;

  const seeded = seedOnce(async (_cli, dir) => {
    declareProfiles(dir, 'sol', 'lia', 'max');
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

  const capture = (text: string) =>
    inProject((project) => captureToBandeja(project, { text }).entry);
  const entries = () => inProject((project) => listBandeja(project, { filed: 10 }));

  describe('close', () => {
    it('closes a duplicate with its reason, which the secretary’s wait and the list then leave alone', async () => {
      capture('the Aprobar button again');

      const closed = await otea(
        'bandeja',
        'close',
        'B-1',
        '--reason',
        'the same as CAM-1',
        '--as',
        'sol',
      );

      expect(closed.code).toBe(0);
      expect(closed.out).toContain('Closed B-1');
      expect(entries()[0]).toMatchObject({
        state: 'closed',
        closedBy: 'sol',
        closeReason: 'the same as CAM-1',
      });
      expect((await otea('wait', '--secretary', '--as', 'sol', '--timeout', '1')).code).toBe(13);
      const all = await otea('bandeja', '--all', '--as', 'lia');
      expect(all.out).toContain('closed by sol: the same as CAM-1');
      expect((await otea('bandeja', '--as', 'lia')).out).toContain('The Bandeja is empty');
    });

    it('wants a reason, and is the secretary’s or the holder’s', async () => {
      capture('a note');

      const bare = await otea('bandeja', 'close', 'B-1', '--as', 'sol');
      expect(bare.code).not.toBe(0);
      expect(entries()[0]?.state).toBe('waiting');

      const stranger = await otea('bandeja', 'close', 'B-1', '--reason', 'no', '--as', 'lia');
      expect(stranger.code).toBe(7);
      expect(stranger.err).toContain("Only the project's secretary");

      await otea('bandeja', 'take', 'B-1', '--as', 'lia');
      const holder = await otea('bandeja', 'close', 'B-1', '--reason', 'not a task', '--as', 'lia');
      expect(holder.code).toBe(0);
      expect(entries()[0]).toMatchObject({ state: 'closed', claimedBy: null });
    });

    it('is reopened by the person, and the secretary hears of it again', async () => {
      capture('a note');
      await otea('bandeja', 'close', 'B-1', '--reason', 'dup', '--as', 'sol');

      inProject((project) => reopenBandeja(project, { id: 1 }));

      const woke = JSON.parse((await otea('wait', '--secretary', '--as', 'sol', '--json')).out);
      expect(woke).toMatchObject({ kind: 'bandeja_item', ref: 'B-1' });
    });

    it('is an MCP tool of the agents', async () => {
      const server = createMcpServer(COMMANDS, { cwd: repo.dir, agent: 'sol', warn: () => {} });
      const client = new Client({ name: 'test', version: '0' });
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      await server.connect(serverSide);
      await client.connect(clientSide);
      try {
        const { tools } = await client.listTools();
        expect(tools.map(({ name }) => name)).toContain('bandeja_close');
      } finally {
        await client.close();
      }
    });
  });

  describe('take --next', () => {
    it('takes the oldest note nobody holds, and says so plainly when none waits', async () => {
      const none = await otea('bandeja', 'take', '--next', '--as', 'lia');
      expect(none.code).toBe(0);
      expect(none.out).toContain('No note waits');

      capture('first');
      capture('second');
      const one = await otea('bandeja', 'take', '--next', '--as', 'lia');
      expect(one.out).toContain('Took B-1 until');
      expect(one.out).toContain('first');
      // The same refiner asking again gets the note it holds, not a second one.
      expect((await otea('bandeja', 'take', '--next', '--as', 'lia')).out).toContain(
        'Still holding B-1',
      );
      // Another refiner gets the next.
      expect((await otea('bandeja', 'take', '--next', '--as', 'max')).out).toContain('Took B-2');
      expect((await otea('bandeja', 'take', '--next', '--as', 'sol')).out).toContain(
        'No note waits',
      );
    });

    it('takes no id with --next, and no --next with --wait missing it', async () => {
      capture('first');

      const both = await otea('bandeja', 'take', 'B-1', '--next', '--as', 'lia');
      expect(both.code).not.toBe(0);
      const neither = await otea('bandeja', 'take', '--as', 'lia');
      expect(neither.code).not.toBe(0);
      const waitOnly = await otea('bandeja', 'take', 'B-1', '--wait', '--as', 'lia');
      expect(waitOnly.code).not.toBe(0);
      expect(entries()[0]?.state).toBe('waiting');
    });

    it('waits for a note that arrives, takes it, and times out calmly when none does', async () => {
      const waiting = otea('bandeja', 'take', '--next', '--wait', '--as', 'lia', '--json');
      await new Promise((resolve) => setTimeout(resolve, 600));
      capture('a late note');

      const got = await waiting;

      expect(got.code).toBe(0);
      expect(JSON.parse(got.out)).toMatchObject({ held: 'lia', entry: { ref: 'B-1' } });

      const idle = await otea(
        'bandeja',
        'take',
        '--next',
        '--wait',
        '--timeout',
        '1',
        '--as',
        'max',
      );
      expect(idle.code).toBe(13);
      expect(idle.err).toContain('keep waiting');
      expect(idle.err).toContain('otea bandeja take --next --wait');
    });
  });
});

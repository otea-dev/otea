import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureToBandeja, listBandeja } from '../app/bandeja.ts';
import { openProject } from '../app/project.ts';
import { type Cli, declareProfiles, presetCollection, seedOnce, type TempRepo } from './testing.ts';

// After the item is made, the refiner's hold on the note runs out (the clock jumps past its lease):
// the note can no longer be filed. The item must not stay behind, or a retry makes a second one.
const jump = vi.hoisted(() => ({ armed: false, to: 0 }));

vi.mock('../app/items.ts', async (importOriginal) => {
  const items = await importOriginal<typeof import('../app/items.ts')>();
  return {
    ...items,
    createItem: (...args: Parameters<typeof items.createItem>) => {
      const made = items.createItem(...args);
      if (jump.armed) {
        jump.armed = false;
        vi.setSystemTime(jump.to);
      }
      return made;
    },
  };
});

describe('create --from-bandeja', () => {
  let repo: TempRepo;
  let otea: Cli;
  const seeded = seedOnce(async (_cli, dir) => {
    declareProfiles(dir, 'sol', 'lia');
    presetCollection(dir, 'tasks');
  });

  beforeEach(async () => {
    ({ repo, otea } = seeded.fresh());
    await otea('profile', '--role', 'assistant', '--as', 'sol');
  });

  afterEach(() => {
    vi.useRealTimers();
    repo.remove();
  });

  const items = async () =>
    JSON.parse((await otea('list', '--as', 'sol', '--json')).out) as { id: string }[];

  const create = () =>
    otea(
      'create',
      '--collection',
      'tasks',
      '--title',
      'Dark mode',
      '--description',
      'What I want: it dark. How I check it: at 390.',
      '--from-bandeja',
      'B-1',
      '--as',
      'lia',
    );

  it('makes the item and files the note together: a note that cannot be filed leaves no item to duplicate on retry', async () => {
    const project = openProject(repo.dir);
    try {
      captureToBandeja(project, { text: 'make it dark' });
    } finally {
      project.db.close();
    }
    expect((await otea('bandeja', 'take', 'B-1', '--as', 'lia')).code).toBe(0);
    const now = Date.now();
    vi.useFakeTimers({ toFake: ['Date'], now });
    jump.armed = true;
    jump.to = now + 31 * 60_000;

    const failed = await create();

    expect(failed.code).not.toBe(0);
    vi.setSystemTime(now);
    expect(await items()).toEqual([]);

    // The hold is still the refiner's: the retry makes the one item and files the note.
    const again = await create();
    expect(again.code, again.err).toBe(0);
    expect(await items()).toHaveLength(1);
    const reopened = openProject(repo.dir);
    try {
      expect(listBandeja(reopened, { filed: 10 })).toEqual([
        expect.objectContaining({ ref: 'B-1', state: 'filed' }),
      ]);
    } finally {
      reopened.db.close();
    }
  });
});

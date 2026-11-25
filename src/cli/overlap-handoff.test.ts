import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { liveBoardOf } from '../app/next.ts';
import { openProject } from '../app/project.ts';
import { stateOf } from '../core/board/engine.ts';
import { updateItemState } from '../store/queries.ts';
import {
  type Cli,
  cliAt,
  declareProfiles,
  SEED_TIMEOUT_MS,
  type SeededRepo,
  seededLocalRepo,
  type TempRepo,
} from './testing.ts';

// Two items that change the same files conflict when the second lands, and each conflict was
// another review round (field study: one item took five). The handoff says which open item's
// pushed branch changes the same files, to the agent in its reply, and `show` says it again to
// whoever reads the item (the desk has it too, src/server/overlap.test.ts).
describe('a handoff of a branch that shares files with another open item', () => {
  let seeded: SeededRepo;
  let repo: TempRepo;
  let otea: Cli;
  const gitAt =
    (dir: string) =>
    (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
        cwd: dir,
        stdio: 'pipe',
        encoding: 'utf8',
      }).trim();
  const changeAt = (dir: string) => (file: string, text: string) => {
    writeFileSync(join(dir, file), text);
    gitAt(dir)('add', file);
    gitAt(dir)('commit', '-q', '-m', file);
  };
  const BRANCH = 'cambio/1-regar';
  const OTHER = 'cambio/2-podar';
  const shared = 'CAM-1 touches the same files as CAM-2 (shared.txt)';

  // CAM-1 claimed in Hacerlo on BRANCH with its diff attached; CAM-2 on OTHER, pushed; both change
  // shared.txt. Seeded once, each test gets its own copy.
  beforeAll(async () => {
    seeded = await seededLocalRepo(async (dir) => {
      const agent = cliAt(dir, { OTEA_AGENT: 'quill' });
      const person = cliAt(dir);
      const git = gitAt(dir);
      const change = changeAt(dir);
      await person('init', '--local', '--template', 'none');
      await person('board', 'add', 'Cambios', '--template', 'changes');
      declareProfiles(dir, 'quill');
      for (const [title, branch] of [
        ['Regar', BRANCH],
        ['Podar', OTHER],
      ] as const) {
        await agent(
          'create',
          '--collection',
          'Cambios',
          '--title',
          title,
          '--field',
          'Qué quiero=x',
          '--field',
          `Rama=${branch}`,
        );
      }
      change('a.txt', 'root\n');
      git('branch', '-M', 'main');
      git('update-ref', 'refs/remotes/origin/main', 'main');
      git('checkout', '-q', '-b', OTHER);
      change('shared.txt', 'podar\n');
      git('update-ref', `refs/remotes/origin/${OTHER}`, OTHER);
      git('checkout', '-q', 'main');
      git('checkout', '-q', '-b', BRANCH);
      change('shared.txt', 'regar\n');
      change('b.txt', 'regar\n');
      git('update-ref', `refs/remotes/origin/${BRANCH}`, BRANCH);
      const project = openProject(dir);
      try {
        const doit = liveBoardOf(project, 'Cambios')?.def.steps.find(
          ({ name }) => name === 'Hacerlo',
        );
        if (!doit) throw new Error('no Hacerlo');
        updateItemState(
          project.db,
          'CAM-1',
          stateOf({ step: doit.id, phase: 'doing' }),
          '2026-11-19T10:00:00Z',
        );
      } finally {
        project.db.close();
      }
      writeFileSync(join(dir, 'regar.diff'), 'diff --git a/b.txt b/b.txt\n+regar\n');
      expect((await agent('claim', 'CAM-1')).code).toBe(0);
      expect((await agent('attach', 'CAM-1', 'regar.diff')).code).toBe(0);
    });
  }, SEED_TIMEOUT_MS);

  afterAll(() => seeded.remove());

  beforeEach(() => {
    repo = seeded.fresh();
    otea = cliAt(repo.dir, { OTEA_AGENT: 'quill' });
  });

  afterEach(() => repo.remove());

  const onLandStep = (id: string) => {
    const project = openProject(repo.dir);
    try {
      const land = liveBoardOf(project, 'Cambios')?.def.steps.find(
        ({ name }) => name === 'Integrar',
      );
      if (!land) throw new Error('no Integrar');
      updateItemState(
        project.db,
        id,
        stateOf({ step: land.id, phase: 'doing' }),
        '2026-11-19T11:00:00Z',
      );
    } finally {
      project.db.close();
    }
  };

  it('says in the reply that the other one is open too, then that it lands first', async () => {
    const handed = await otea('handoff', 'CAM-1', '--note', 'regar');

    expect(handed.code, handed.err).toBe(0);
    expect(handed.out).toContain(
      `Note: ${shared}, which is open too: whichever lands second must merge main first and may meet a conflict.`,
    );
  });

  it('says it lands first when the other one is on its land step', async () => {
    onLandStep('CAM-2');

    const handed = await otea('handoff', 'CAM-1', '--note', 'regar');

    expect(handed.code, handed.err).toBe(0);
    expect(handed.out).toContain(`Note: ${shared}, which lands first`);
  });

  it('says nothing when the other branch changes other files', async () => {
    gitAt(repo.dir)('update-ref', `refs/remotes/origin/${OTHER}`, 'main');

    const handed = await otea('handoff', 'CAM-1', '--note', 'regar');

    expect(handed.code, handed.err).toBe(0);
    expect(handed.out).not.toContain('touches the same files');
  });

  it('is said again by show, with the files as data', async () => {
    const shown = await otea('show', 'CAM-1');
    expect(shown.out).toContain(`${shared}, which is open too`);

    const data = await otea('show', 'CAM-1', '--json');
    expect(JSON.parse(data.out).overlaps).toEqual([
      { id: 'CAM-2', title: 'Podar', files: ['shared.txt'], landing: false },
    ]);
  });
});

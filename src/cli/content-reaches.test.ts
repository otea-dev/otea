import { mkdirSync } from 'node:fs';
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

// U3 (field study 4, wave 2b): six of six pieces of a content board closed as Done while the text sat
// on a side branch under .otea/worktrees and never reached the person's folder; «Publicado en»
// even said «todavía no está en tu carpeta». A piece whose last step says where it lives is Done
// only when what it names is there: a web address, or a file in the project's own folder.
describe('a content piece is Done only when its text reached the person', () => {
  let seeded: SeededRepo;
  let repo: TempRepo;
  let otea: Cli;
  let partName = '';

  beforeAll(async () => {
    seeded = await seededLocalRepo(async (dir) => {
      const person = cliAt(dir);
      await person('init', '--local', '--template', 'none');
      await person('board', 'add', 'Contenido', '--template', 'content');
      declareProfiles(dir, 'quill');
      const otea = cliAt(dir, { OTEA_AGENT: 'quill' });
      const created = await otea(
        'create',
        '--collection',
        'Contenido',
        '--title',
        'Primer día',
        '--field',
        'Planteamiento=La guía del primer día',
      );
      if (created.code !== 0) throw new Error(created.err);
      // The piece is at its last step, Go live, as a worker holds it after the approvals.
      const project = openProject(dir);
      try {
        const def = liveBoardOf(project, 'Contenido')?.def;
        const golive = def?.steps.at(-1);
        if (!def || !golive) throw new Error('no board');
        updateItemState(
          project.db,
          'PIE-1',
          stateOf({ step: golive.id, phase: 'doing' }),
          '2026-11-27T10:00:00Z',
        );
        partName = Object.values(def.parts).find((part) => part.kind === 'url')?.name ?? '';
      } finally {
        project.db.close();
      }
      const claimed = await otea('claim', 'PIE-1');
      expect(claimed.code, claimed.err).toBe(0);
    });
  }, SEED_TIMEOUT_MS);

  afterAll(() => seeded.remove());

  beforeEach(() => {
    repo = seeded.fresh();
    otea = cliAt(repo.dir, { OTEA_AGENT: 'quill' });
  });

  afterEach(() => repo.remove());

  const says = (where: string) => otea('update', 'PIE-1', '--field', `${partName}=${where}`);
  const handoff = () => otea('handoff', 'PIE-1');

  it('refuses a file that is not in the project folder, and closes once it is there', async () => {
    expect((await says('guia/primer-dia.md')).code).toBe(0);

    const refused = await handoff();
    expect(refused.code).toBe(8);
    expect(refused.err).toContain('PIE-1 not handed off');
    expect(refused.err).toContain('guia/primer-dia.md');

    repo.write('guia/primer-dia.md', '# Primer día\n');
    const handed = await handoff();
    expect(handed.code, handed.err).toBe(0);
    expect(handed.out).not.toContain('not handed off');
  });

  it('refuses a file only a worktree has, and a note instead of a place', async () => {
    mkdirSync(join(repo.dir, '.otea', 'worktrees', 'PIE-1', 'guia'), { recursive: true });
    repo.write('.otea/worktrees/PIE-1/guia/primer-dia.md', '# Primer día\n');
    expect((await says('.otea/worktrees/PIE-1/guia/primer-dia.md')).code).toBe(0);
    expect((await handoff()).code).toBe(8);

    expect((await says('(todavía no está en tu carpeta)')).code).toBe(0);
    expect((await handoff()).code).toBe(8);
  });

  it('takes a web address where it went live', async () => {
    expect((await says('https://example.com/blog/primer-dia')).code).toBe(0);
    const handed = await handoff();
    expect(handed.code, handed.err).toBe(0);
  });
});

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { liveBoardOf } from '../app/next.ts';
import { openProject } from '../app/project.ts';
import { publishAs } from '../app/testing.ts';
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

// The same rule for a board the person made: a text field whose name says a file or a path, handed in
// by its last step, names a file the person can read, in the project's folder (not under .otea or
// .git). A text field that says nothing of a place is no place, and its board is left alone.
describe('a piece whose last step hands in a file or path field', () => {
  let seeded: SeededRepo;
  let repo: TempRepo;
  let otea: Cli;
  // The id of the piece each board got.
  const pieces: Record<string, string> = {};

  beforeAll(async () => {
    seeded = await seededLocalRepo(async (dir) => {
      const person = cliAt(dir);
      await person('init', '--local', '--template', 'none');
      await person('board', 'add', 'Contenido', '--template', 'content');
      const project = openProject(dir);
      try {
        const live = liveBoardOf(project, 'Contenido')?.def;
        const url = live && Object.values(live.parts).find((part) => part.kind === 'url');
        if (!live || !url) throw new Error('no board');
        // The Go live step hands in the field; here it is a text field of the given name.
        const made = (name: string, field: string, id: string) =>
          publishAs(
            project,
            {
              ...live,
              name,
              parts: { ...live.parts, [url.id]: { ...url, kind: 'text', name: field } },
            },
            id,
          );
        made('Documentos', 'Archivo del texto', 'docs');
        made('Apuntes', 'Comentario', 'notes');
        for (const board of ['Documentos', 'Apuntes'] as const) {
          const def = liveBoardOf(project, board)?.def;
          const golive = def?.steps.at(-1);
          if (!def || !golive) throw new Error(`no board ${board}`);
          const created = await cliAt(dir, { OTEA_AGENT: 'quill' })(
            'create',
            '--collection',
            board,
            '--title',
            'Primer día',
            '--field',
            'Planteamiento=La guía del primer día',
          );
          if (created.code !== 0) throw new Error(created.err);
          const id = /\b([A-Z]+\d*-\d+)\b/.exec(created.out)?.[1];
          if (!id) throw new Error(`no id in ${created.out}`);
          pieces[board] = id;
          updateItemState(
            project.db,
            id,
            stateOf({ step: golive.id, phase: 'doing' }),
            '2026-11-27T10:00:00Z',
          );
        }
      } finally {
        project.db.close();
      }
      declareProfiles(dir, 'quill');
      for (const id of Object.values(pieces)) {
        const claimed = await cliAt(dir, { OTEA_AGENT: 'quill' })('claim', id);
        expect(claimed.code, claimed.err).toBe(0);
      }
    });
  }, SEED_TIMEOUT_MS);

  afterAll(() => seeded.remove());

  beforeEach(() => {
    repo = seeded.fresh();
    otea = cliAt(repo.dir, { OTEA_AGENT: 'quill' });
  });

  afterEach(() => repo.remove());

  const field = (id: string | undefined, name: string, value: string) =>
    otea('update', id ?? '', '--field', `${name}=${value}`);

  it('refuses a path that is not a file in the project folder, and closes once it is there', async () => {
    const id = pieces.Documentos;
    expect((await field(id, 'Archivo del texto', 'guia/primer-dia.md')).code).toBe(0);

    const refused = await otea('handoff', id ?? '');
    expect(refused.code).toBe(8);
    expect(refused.err).toContain(`${id} not handed off`);
    expect(refused.err).toContain('guia/primer-dia.md');

    repo.write('guia/primer-dia.md', '# Primer día\n');
    const handed = await otea('handoff', id ?? '');
    expect(handed.code, handed.err).toBe(0);
  });

  it('refuses a path under .otea', async () => {
    const id = pieces.Documentos;
    repo.write('.otea/worktrees/x/primer-dia.md', '# Primer día\n');
    expect((await field(id, 'Archivo del texto', '.otea/worktrees/x/primer-dia.md')).code).toBe(0);
    expect((await otea('handoff', id ?? '')).code).toBe(8);
  });

  it('leaves a board with no such field alone', async () => {
    const id = pieces.Apuntes;
    expect((await field(id, 'Comentario', 'guia/que-no-existe.md')).code).toBe(0);
    const handed = await otea('handoff', id ?? '');
    expect(handed.code, handed.err).toBe(0);
  });
});

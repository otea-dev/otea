import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Cli, cliAt, tempGitRepo, type TempRepo } from './testing.ts';

// A board says its values in its own language wherever an agent reads them, and takes the value as
// the board says it or as it is stored (P1-F5): `Impacto=baja` and `Impacto=low` are the same
// value, and `Impacto: baja` is how it reads back, never `Impacto: low`.
describe('values in the board language', () => {
  let repo: TempRepo;
  let otea: Cli;

  beforeEach(async () => {
    repo = tempGitRepo();
    const person = cliAt(repo.dir);
    otea = cliAt(repo.dir, { OTEA_AGENT: 'claude' });
    await person('init', '--local');
    await person('board', 'add', 'Cambios', '--template', 'changes');
    await otea('profile', '--model', 'unknown', '--effort', 'unknown', '--harness', 'test');
  }, 60_000);

  afterEach(() => repo.remove());

  const create = (title: string, ...fields: string[]) =>
    otea(
      'create',
      '--collection',
      'Cambios',
      '--title',
      title,
      '--field',
      'Qué quiero=x',
      ...fields.flatMap((field) => ['--field', field]),
    );

  it.each(['Impacto=baja', 'Impacto=low', 'Impacto=BAJA'])(
    'takes %s and reads it back as baja on next and show',
    async (given) => {
      expect((await create('A', given)).code).toBe(0);

      const next = (await otea('next')).out;
      expect(next).toContain('Impacto: baja');
      expect(next).not.toContain('Impacto: low');
      const shown = (await otea('show', 'CAM-1')).out;
      expect(shown).toContain('Impacto: baja');
      expect(shown).not.toContain('Impacto: low');
    },
  );

  it('reads a level in next as the board says it after an update, too', async () => {
    await create('A', 'Impacto=baja');
    expect((await otea('update', 'CAM-1', '--field', 'Impacto=critical')).code).toBe(0);

    const next = (await otea('next')).out;
    expect(next).toContain('Impacto: crítica');
    expect(next).not.toContain('Impacto: critical');
  });

  it('takes a choice by its key as well as by its name', async () => {
    const made = await create('A', 'Esfuerzo=s');

    expect(made.code).toBe(0);
    expect((await otea('show', 'CAM-1')).out).toContain('Esfuerzo: Pequeño');
  });
});

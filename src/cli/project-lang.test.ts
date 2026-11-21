import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listBoardSummaries } from '../app/boards.ts';
import { openProject } from '../app/project.ts';
import { type Cli, cliAt, tempGitRepo } from './testing.ts';

// A project's words come in one language: the one it was started in. Without --lang that stays
// Spanish, the owner's; an English project never makes a Spanish board by leaving --lang out.
describe('the project language', () => {
  let repo: ReturnType<typeof tempGitRepo>;
  let person: Cli;

  const boardNames = () => {
    const project = openProject(repo.dir);
    try {
      return listBoardSummaries(project).map(({ name }) => name);
    } finally {
      project.db.close();
    }
  };

  beforeEach(() => {
    repo = tempGitRepo();
    person = cliAt(repo.dir);
  });

  afterEach(() => repo.remove());

  it('names the template boards of init in the language it was given', async () => {
    const { code } = await person('init', '--local', '--lang', 'en', '--template', 'changes');

    expect(code).toBe(0);
    expect(boardNames()).toContain('Changes');
    expect(boardNames()).not.toContain('Cambios');
  });

  it('keeps it for later boards and for the built-in Requests board', async () => {
    await person('init', '--local', '--lang', 'en');

    expect((await person('board', 'add', 'Bugs', '--template', 'bugs')).code).toBe(0);

    expect(boardNames()).toContain('Requests');
    expect(boardNames()).not.toContain('Pedidos');
    const bugs = (await person('board', 'Bugs')).out;
    expect(bugs).toContain('Bugs: steps for each Bug');
    expect(bugs).not.toContain('Completar');
  });

  it('lets --lang on a board override it, and starts in Spanish without any', async () => {
    await person('init', '--local', '--lang', 'en');
    await person('board', 'add', 'Cosas', '--template', 'changes', '--lang', 'es');
    await person('board', 'add', 'Notes', '--template', 'decisions');

    expect(boardNames()).toEqual(expect.arrayContaining(['Cosas', 'Notes']));
    expect((await person('board', 'Cosas')).out).toContain('Cosas: steps for each');

    const fresh = tempGitRepo();
    try {
      await cliAt(fresh.dir)('init', '--local', '--template', 'changes');
      const project = openProject(fresh.dir);
      try {
        expect(listBoardSummaries(project).map(({ name }) => name)).toContain('Cambios');
      } finally {
        project.db.close();
      }
    } finally {
      fresh.remove();
    }
  });

  it('is set on a project that exists with otea init --lang, for the boards made next', async () => {
    await person('init', '--local');
    expect((await person('init', '--lang', 'en')).code).toBe(0);

    await person('board', 'add', 'Changes', '--template', 'changes');

    expect(boardNames()).toContain('Changes');
  });

  it('refuses a language it does not speak', async () => {
    const { code, err } = await person('init', '--local', '--lang', 'fr');

    expect(code).not.toBe(0);
    expect(err).toContain('en|es');
  });
});

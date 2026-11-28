import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getBoardRecord, listBoardSummaries, publishBoard, saveDraft } from '../app/boards.ts';
import { rememberLanguage } from '../app/language.ts';
import { withMachine } from '../app/machine.ts';
import { openProject } from '../app/project.ts';
import { startProject } from '../app/start.ts';
import { clone } from '../core/board/model.ts';
import { listBoards } from '../store/boards.ts';
import { type Cli, cliAt, tempGitRepo } from './testing.ts';

// An English user on a computer in Spanish gets a Spanish project the first time (nothing told
// otea otherwise), and then says English: with `otea start --lang en` or `otea projects lang en`.
// The project, its boards and what its agents are told then speak English, not only what is made
// afterwards (field study s-real, D-867c82: four English users kept a Spanish board, Spanish role
// texts and Spanish questions from their agents).
describe('saying the project is in another language', () => {
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

  const spanishProject = async () => {
    withMachine(process.env, (machine) => rememberLanguage(machine, 'es'));
    await person('init', '--local', '--template', 'changes');
    expect(boardNames()).toEqual(expect.arrayContaining(['Cambios', 'Pedidos']));
  };

  beforeEach(() => {
    repo = tempGitRepo();
    person = cliAt(repo.dir);
  });

  afterEach(() => {
    withMachine(process.env, (machine) => rememberLanguage(machine, 'en'));
    repo.remove();
  });

  it('makes the boards and the text for the worker English when otea start --lang en runs on a Spanish project', async () => {
    await spanishProject();

    const report = await startProject(repo.dir, { lang: 'en' });

    expect(report.lang).toBe('en');
    expect((await person('projects', 'lang')).out).toContain('English (en)');
    expect(boardNames()).toEqual(expect.arrayContaining(['Changes', 'Requests']));
    expect(boardNames()).not.toContain('Cambios');
    expect(boardNames()).not.toContain('Pedidos');
    const worker = (await person('prompt', '--role', 'worker', '--board', 'Changes')).out;
    expect(worker).not.toMatch(/Hecho|Aclarar|Cambios/);
    expect((await person('board', 'Changes')).out).not.toMatch(/Hecho|Aclarar|Cambios/);
  });

  it('does the same with otea projects lang en, in both directions', async () => {
    await spanishProject();

    expect((await person('projects', 'lang', 'en')).code).toBe(0);
    expect(boardNames()).toEqual(expect.arrayContaining(['Changes', 'Requests']));

    expect((await person('projects', 'lang', 'es')).code).toBe(0);
    expect(boardNames()).toEqual(expect.arrayContaining(['Cambios', 'Pedidos']));
    expect((await person('board', 'Cambios')).out).toContain('Aclarar');
  });

  it('keeps a name and an instruction the person wrote, and moves the rest', async () => {
    await spanishProject();
    await person('board', 'add', 'Cosas', '--template', 'changes');
    const own = 'Siempre pregunta antes de tocar el contrato';
    const project = openProject(repo.dir);
    try {
      const board = listBoards(project.db).find(({ collection }) => collection === 'Cosas');
      const live = getBoardRecord(project, board?.id ?? '').live?.definition;
      if (!board || !live) throw new Error('the board was not made');
      const definition = clone(live);
      const first = definition.steps[0];
      if (!first) throw new Error('a board with no step');
      first.instructions.take = own;
      saveDraft(project, board.id, { definition, baseVersion: board.liveVersion });
      publishBoard(project, board.id, { moves: {}, by: { kind: 'human', name: 'human' } });
    } finally {
      project.db.close();
    }

    await person('projects', 'lang', 'en');

    expect(boardNames()).toContain('Cosas');
    const shown = (await person('board', 'Cosas')).out;
    expect(shown).toContain(own);
    expect(shown).not.toContain('Aclarar');
  });
});

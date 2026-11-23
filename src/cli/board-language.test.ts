import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rememberLanguage } from '../app/language.ts';
import { withMachine } from '../app/machine.ts';
import { cliAt, tempGitRepo } from './testing.ts';

// A board the CLI makes for the person (otea init --template, otea start --template) is in the
// language they use: the one their desk last used, whatever this shell's locale says (P4-F5, P5-F4).
describe('the language of a board made from the command line', () => {
  let repo: ReturnType<typeof tempGitRepo>;

  beforeEach(() => {
    repo = tempGitRepo();
  });

  afterEach(() => {
    withMachine(process.env, (machine) => rememberLanguage(machine, 'en'));
    repo.remove();
  });

  const boards = async (...argv: string[]) => {
    const { out } = await cliAt(repo.dir)('init', '--local', '--json', ...argv);
    return (JSON.parse(out) as { boards: { name: string }[] }).boards.map(({ name }) => name);
  };

  it('follows the desk when it is Spanish', async () => {
    withMachine(process.env, (machine) => rememberLanguage(machine, 'es'));

    expect(await boards('--template', 'todos')).toEqual(['Pendientes']);
  });

  it('is the one --lang names, over the desk', async () => {
    withMachine(process.env, (machine) => rememberLanguage(machine, 'es'));

    expect(await boards('--template', 'todos', '--lang', 'en')).toEqual(['To-dos']);
  });
});
